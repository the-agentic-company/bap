import type { RuntimeHarnessClient } from "../../../sandbox/core/types";
import { conversationRuntimeService } from "../../conversation-runtime-service";
import type { GenerationInterruptRecord } from "../../generation-interrupt-service";
import { saveConversationSessionSnapshot } from "../../opencode-session-snapshot-service";
import type { GenerationContext, GenerationEvent, GenerationStatus } from "../types";
import type { GenerationLifecycleStore } from "./lifecycle-store";

const RUN_DEADLINE_ABORT_TIMEOUT_MS = 5_000;
const RUN_DEADLINE_SNAPSHOT_TIMEOUT_MS = 15_000;

export class GenerationSuspendedError extends Error {
  constructor(
    readonly interruptId: string,
    readonly kind: "approval" | "auth",
  ) {
    super(`Generation suspended for ${kind} interrupt ${interruptId}`);
    this.name = "GenerationSuspendedError";
  }
}

type TurnSuspenderDependencies = {
  lifecycleStore: GenerationLifecycleStore;
  refreshRemainingRunBudget(ctx: GenerationContext, now?: Date): number;
  setCompletionReason(ctx: GenerationContext, reason: "run_deadline"): void;
  stopExternalInterruptPolling(ctx: GenerationContext): void;
  saveProgress(ctx: GenerationContext): Promise<void>;
  releaseSandboxSlotLease(ctx: GenerationContext): Promise<void>;
  evictActiveGenerationContext(generationId: string): void;
  broadcast(ctx: GenerationContext, event: GenerationEvent): void;
};

async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ type: "resolved"; value: T } | { type: "timed_out" }> {
  if (timeoutMs <= 0) {
    return { type: "timed_out" };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ type: "resolved" as const, value })),
      new Promise<{ type: "timed_out" }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ type: "timed_out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function saveSessionSnapshot(
  ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
): Promise<void> {
  if (!ctx.sessionId || !ctx.sandbox) {
    throw new Error(`Cannot snapshot conversation ${ctx.conversationId}: missing runtime session`);
  }

  await saveConversationSessionSnapshot({
    conversationId: ctx.conversationId,
    sessionId: ctx.sessionId,
    sandbox: {
      exec: (command, opts) =>
        ctx.sandbox!.execute(command, {
          timeout: opts?.timeoutMs,
          env: opts?.env,
        }),
      writeFile: (path, content) =>
        ctx.sandbox!.writeFile(
          path,
          typeof content === "string" ? content : new Uint8Array(content),
        ),
    },
  });
}

export class GenerationTurnSuspender {
  constructor(private readonly deps: TurnSuspenderDependencies) {}

  async saveSessionSnapshotIfPossible(
    ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
    reason: string,
  ): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      return;
    }

    try {
      await saveSessionSnapshot(ctx);
    } catch (error) {
      console.error(
        `[GenerationManager] Failed to save session snapshot (${reason}) for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  async parkGenerationForRunDeadline(
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ): Promise<void> {
    const now = new Date();
    const releasedSandboxId = ctx.sandboxId;
    const remainingRunMs = this.deps.refreshRemainingRunBudget(ctx, now);

    ctx.status = "paused";
    ctx.suspendedAt = now;
    this.deps.setCompletionReason(ctx, "run_deadline");
    ctx.pendingApproval = null;
    ctx.pendingAuth = null;
    ctx.currentInterruptId = undefined;
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.deps.stopExternalInterruptPolling(ctx);

    await this.abortRuntimeForRunDeadlinePark(ctx, runtimeClient);
    await this.saveSessionSnapshotForPark(ctx, "run deadline");
    await this.deps.saveProgress(ctx);

    await this.deps.lifecycleStore.pauseForRunDeadline({
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      coworkerRunId: ctx.coworkerRunId,
      contentParts: ctx.contentParts,
      remainingRunMs,
      suspendedAt: now,
      lastRuntimeEventAt: ctx.lastRuntimeEventAt,
    });

    this.deps.broadcast(ctx, {
      type: "status_change",
      status: "run_deadline_parked",
      metadata: {
        runtimeId: ctx.runtimeId,
        sandboxProvider: ctx.sandboxProviderOverride,
        sandboxId: releasedSandboxId,
        releasedSandboxId,
      },
    });

    try {
      await ctx.sandbox?.teardown();
    } catch (error) {
      console.warn("[GenerationManager] Failed to teardown sandbox during run deadline park", {
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: ctx.runtimeId,
        sandboxId: ctx.sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.releaseRuntimeAndSandbox(ctx);
    }
  }

  async suspendGenerationForInterrupt(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<never> {
    const now = new Date();
    const remainingRunMs = this.deps.refreshRemainingRunBudget(ctx, now);
    const nextStatus: GenerationStatus =
      interrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";

    ctx.status = nextStatus;
    ctx.currentInterruptId = interrupt.id;
    ctx.suspendedAt = now;
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.deps.stopExternalInterruptPolling(ctx);

    await this.saveSessionSnapshotForPark(ctx, "interrupt");
    await this.deps.saveProgress(ctx);

    await this.deps.lifecycleStore.suspendForInterrupt({
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      coworkerRunId: ctx.coworkerRunId,
      status: nextStatus,
      contentParts: ctx.contentParts,
      remainingRunMs,
      suspendedAt: now,
      lastRuntimeEventAt: ctx.lastRuntimeEventAt,
    });

    try {
      await ctx.sandbox?.teardown();
    } catch (error) {
      console.warn("[GenerationManager] Failed to teardown sandbox during interrupt park", {
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: ctx.runtimeId,
        sandboxId: ctx.sandboxId,
        interruptId: interrupt.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.releaseRuntimeAndSandbox(ctx);
    }

    throw new GenerationSuspendedError(
      interrupt.id,
      interrupt.kind === "auth" ? "auth" : "approval",
    );
  }

  private async abortRuntimeForRunDeadlinePark(
    ctx: Pick<GenerationContext, "id" | "conversationId" | "sessionId">,
    runtimeClient?: RuntimeHarnessClient,
  ): Promise<void> {
    if (!runtimeClient || !ctx.sessionId) {
      return;
    }

    try {
      const abortOutcome = await awaitWithTimeout(
        runtimeClient.abort({ sessionID: ctx.sessionId }),
        RUN_DEADLINE_ABORT_TIMEOUT_MS,
      );
      if (abortOutcome.type === "timed_out") {
        console.warn(
          `[GenerationManager] Timed out aborting session ${ctx.sessionId} before deadline park for generation ${ctx.id}`,
        );
      }
    } catch (error) {
      console.warn(
        `[GenerationManager] Failed to abort session ${ctx.sessionId} before deadline park for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async saveSessionSnapshotForPark(
    ctx: GenerationContext,
    reason: "run deadline" | "interrupt",
  ): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      return;
    }

    try {
      const snapshotOutcome = await awaitWithTimeout(
        saveSessionSnapshot(ctx),
        RUN_DEADLINE_SNAPSHOT_TIMEOUT_MS,
      );
      if (snapshotOutcome.type === "timed_out") {
        console.error(
          `[GenerationManager] Timed out saving session snapshot before ${reason} park for conversation ${ctx.conversationId}`,
        );
      }
    } catch (error) {
      console.error(
        `[GenerationManager] Failed to save session snapshot before ${reason} park for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async releaseRuntimeAndSandbox(ctx: GenerationContext): Promise<void> {
    if (ctx.runtimeId) {
      await conversationRuntimeService.suspendRuntime(ctx.runtimeId);
    }
    ctx.sandbox = undefined;
    ctx.sandboxId = undefined;
    ctx.sessionId = undefined;
    await this.deps.releaseSandboxSlotLease(ctx);
    this.deps.evictActiveGenerationContext(ctx.id);
  }
}
