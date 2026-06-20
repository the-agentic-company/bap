import { db } from "@bap/db/client";
import { conversation } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { env } from "../../../env";
import type {
  RuntimeHarnessClient,
  RuntimePromptPart,
  RuntimeSelection,
  SandboxHandle,
} from "../../sandbox/core/types";
import type { ExecutionEnvironmentSession } from "../../execution/execution-environment";
import { getOrCreateConversationRuntime } from "../../sandbox/core/orchestrator";
import { logger } from "../../utils/observability";
import {
  writeRuntimeContextToSandbox,
  writeRuntimeEnvToSandbox,
} from "../../execution/runtime-context";
import type {
  GenerationCompletionReason,
  RuntimeFailureClassification,
} from "../../services/lifecycle-policy";
import { GenerationSuspendedError } from "../../services/generation/core/turn-suspension";
import { composeContinuationPromptSpec } from "../../services/generation/prompts/opencode-prompt-context";
import type {
  GenerationContext,
  GenerationEvent,
  GenerationStatus,
} from "../../services/generation/types";
import { OpenCodeTurnEventBridge } from "./opencode-turn-events";
import { buildOpenCodeRuntimeModelConfig } from "./model-config";

export type OpenCodeRecoveryReattachOptions = {
  allowSnapshotRestore?: boolean;
  requireLiveSession?: boolean;
  resumeInterruptId?: string;
  modeLabel?: string;
  onRuntimeAttached?: (runtimeClient: RuntimeHarnessClient) => Promise<RuntimePromptPart[] | void>;
  completeAfterRuntimeAttached?: boolean;
  skipUsageCaptureAfterRuntimeAttached?: boolean;
};

type OpenCodeRecoveryRunnerCallbacks = {
  bootstrapTimeoutMs: number;
  turnEvents: OpenCodeTurnEventBridge;
  refreshCancellationSignal: (
    ctx: GenerationContext,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  finishGeneration: (
    ctx: GenerationContext,
    status: Extract<GenerationStatus, "completed" | "cancelled" | "error">,
  ) => Promise<void>;
  setCompletionReason: (
    ctx: GenerationContext,
    reason: GenerationCompletionReason | null | undefined,
  ) => void;
  bindRuntimeSessionToContext: (
    ctx: GenerationContext,
    input: {
      runtimeSandbox: SandboxHandle;
      runtimeMetadata: RuntimeSelection;
      executionEnvironment?: ExecutionEnvironmentSession["environment"];
      sessionId: string;
    },
  ) => Promise<void>;
  broadcast: (ctx: GenerationContext, event: GenerationEvent) => void;
  resolveSandboxRuntimeEnvForContext: (
    ctx: GenerationContext,
  ) => Promise<Record<string, string | null | undefined>>;
  applyResolvedInterruptToRuntime: (
    ctx: GenerationContext,
    interruptId: string,
    runtimeClient: RuntimeHarnessClient,
  ) => Promise<void>;
  setSnapshotRestoreAllowance: (ctx: GenerationContext, allowed: boolean) => Promise<void>;
  getRemainingRunTimeMs: (ctx: GenerationContext) => number;
  parkGenerationForRunDeadline: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<void>;
  awaitPromiseUntilRunDeadline: <T>(
    ctx: GenerationContext,
    promise: Promise<T>,
  ) => Promise<{ type: "resolved"; value: T } | { type: "timed_out" }>;
  captureUsageFromRuntimeSession: (
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ) => Promise<void>;
  importIntegrationSkillDraftsFromSandbox: (ctx: GenerationContext) => Promise<void>;
  resolveRuntimeFailure: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<RuntimeFailureClassification>;
  captureOriginalError: (
    ctx: GenerationContext,
    error: unknown,
    input: { runtimeFailure?: RuntimeFailureClassification },
  ) => void;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class OpenCodeRecoveryRunner {
  constructor(private readonly callbacks: OpenCodeRecoveryRunnerCallbacks) {}

  async run(ctx: GenerationContext, options?: OpenCodeRecoveryReattachOptions): Promise<void> {
    const requireLiveSession = options?.requireLiveSession ?? true;
    const modeLabel = options?.modeLabel ?? "recovery_reattach";
    let reattachTimeoutTriggered = false;
    let clearReattachTimeout: (() => void) | undefined;
    let runtimeClient: RuntimeHarnessClient | undefined;

    try {
      if (await this.callbacks.refreshCancellationSignal(ctx, { force: true })) {
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      if (requireLiveSession && !ctx.sessionId) {
        this.callbacks.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because the session ID was missing.";
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }

      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });

      const session = await withTimeout(
        getOrCreateConversationRuntime(
          {
            conversationId: ctx.conversationId,
            generationId: ctx.id,
            userId: ctx.userId,
            model: ctx.model,
            openAIAuthSource: ctx.authSource,
            anthropicApiKey: env.ANTHROPIC_API_KEY || "",
            integrationEnvs: {},
          },
          {
            sandboxProviderOverride: ctx.sandboxProviderOverride,
            title: conv?.title || "Conversation",
            replayHistory: false,
            allowSnapshotRestore: options?.allowSnapshotRestore ?? false,
            telemetry: {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
            },
          },
        ),
        this.callbacks.bootstrapTimeoutMs,
        `Agent preparation timed out after ${Math.round(this.callbacks.bootstrapTimeoutMs / 1000)} seconds.`,
      );

      runtimeClient = session.harnessClient;
      const createdFreshResumeSession = session.sessionSource === "created_session";

      if (
        createdFreshResumeSession &&
        (requireLiveSession || !options?.resumeInterruptId || !options.onRuntimeAttached)
      ) {
        this.callbacks.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage = requireLiveSession
          ? "The live runtime could not be reattached because the original sandbox was no longer available."
          : "The suspended runtime could not be resumed because no session snapshot was restored.";
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }

      if (requireLiveSession && session.sessionSource !== "live_session") {
        this.callbacks.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because only a snapshot restore was available.";
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }

      if (ctx.sessionId && session.session.id !== ctx.sessionId) {
        this.callbacks.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because the session no longer matched the active generation.";
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }

      await this.callbacks.bindRuntimeSessionToContext(ctx, {
        runtimeSandbox: session.sandbox,
        runtimeMetadata: session.metadata as RuntimeSelection,
        executionEnvironment: undefined,
        sessionId: session.session.id,
      });
      this.callbacks.broadcast(ctx, {
        type: "status_change",
        status: `${modeLabel}_attached`,
        metadata: {
          runtimeId: ctx.runtimeId,
          sandboxProvider: session.metadata.sandboxProvider,
          runtimeHarness: session.metadata.runtimeHarness,
          runtimeProtocolVersion: session.metadata.runtimeProtocolVersion,
          sandboxId: session.sandbox.sandboxId,
          sessionId: session.session.id,
        },
      });
      if (ctx.runtimeId && ctx.runtimeCallbackToken && ctx.runtimeTurnSeq) {
        await writeRuntimeContextToSandbox(session.sandbox, {
          runtimeId: ctx.runtimeId,
          turnSeq: ctx.runtimeTurnSeq,
          callbackToken: ctx.runtimeCallbackToken,
          updatedAt: new Date().toISOString(),
        });
      }
      await writeRuntimeEnvToSandbox(
        session.sandbox,
        await this.callbacks.resolveSandboxRuntimeEnvForContext(ctx),
      );
      if (options?.resumeInterruptId && !createdFreshResumeSession) {
        logger.info({
          event: "GENERATION_RECOVERY_APPLY_RESOLVED_INTERRUPT",
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          interruptId: options.resumeInterruptId,
          mode: modeLabel,
          sessionSource: session.sessionSource,
          sessionId: session.session.id,
          runtimeHarness: session.metadata.runtimeHarness,
          runtimeProtocolVersion: session.metadata.runtimeProtocolVersion,
        });
        await this.callbacks.applyResolvedInterruptToRuntime(
          ctx,
          options.resumeInterruptId,
          runtimeClient,
        );
      }
      const continuationPromptParts = await options?.onRuntimeAttached?.(runtimeClient);
      if (
        createdFreshResumeSession &&
        (!continuationPromptParts || continuationPromptParts.length === 0)
      ) {
        this.callbacks.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage =
          "The suspended runtime could not be resumed because no session snapshot was restored.";
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }
      await this.callbacks.setSnapshotRestoreAllowance(ctx, false);

      if (options?.completeAfterRuntimeAttached) {
        if (!options.skipUsageCaptureAfterRuntimeAttached) {
          await this.callbacks.captureUsageFromRuntimeSession(
            ctx,
            runtimeClient,
            session.session.id,
          );
        }
        await this.callbacks.finishGeneration(ctx, "completed");
        return;
      }

      const remainingRunTimeMs = this.callbacks.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }

      const subscribeController = new AbortController();
      const eventResult = await runtimeClient.subscribe(
        {},
        {
          signal: subscribeController.signal,
        },
      );
      const eventStream = eventResult.stream;
      const modelConfig = buildOpenCodeRuntimeModelConfig(ctx.model);
      let continuationPromptPromise: Promise<
        { ok: true } | { ok: false; error: unknown }
      > = Promise.resolve({ ok: true });
      if (continuationPromptParts && continuationPromptParts.length > 0 && ctx.sessionId) {
        const continuationPromptSpec = await composeContinuationPromptSpec(ctx);
        logger.info({
          event: "GENERATION_RECOVERY_CONTINUATION_PROMPT_REQUESTED",
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          mode: modeLabel,
          resumeInterruptId: options?.resumeInterruptId ?? null,
          sessionSource: session.sessionSource,
          sessionId: ctx.sessionId,
          modelReference: ctx.model,
          modelProviderID: modelConfig.providerID,
          modelID: modelConfig.modelID,
          continuationPartCount: continuationPromptParts.length,
          agentId: continuationPromptSpec.agentId,
        });
        continuationPromptPromise = runtimeClient
          .prompt({
            sessionID: ctx.sessionId,
            parts: continuationPromptParts,
            agent: continuationPromptSpec.agentId,
            system: continuationPromptSpec.systemPrompt,
            model: modelConfig,
          })
          .then(
            () => ({ ok: true as const }),
            (error) => ({ ok: false as const, error }),
          );
      }
      const reattachTimeoutId = setTimeout(() => {
        reattachTimeoutTriggered = true;
        subscribeController.abort();
      }, remainingRunTimeMs);
      clearReattachTimeout = () => {
        clearTimeout(reattachTimeoutId);
        clearReattachTimeout = undefined;
      };

      const eventLoop = this.callbacks.turnEvents.createEventLoop({
        ctx,
        client: runtimeClient,
        mode: "recovery_reattach",
      });

      await eventLoop.consume(eventStream);

      const continuationPromptOutcome = await this.callbacks.awaitPromiseUntilRunDeadline(
        ctx,
        continuationPromptPromise,
      );
      clearReattachTimeout?.();
      if (reattachTimeoutTriggered || continuationPromptOutcome.type === "timed_out") {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const continuationPromptResult = continuationPromptOutcome.value;
      if (!continuationPromptResult.ok) {
        throw continuationPromptResult.error;
      }

      if (!eventLoop.snapshot().sawSessionIdle && !ctx.abortController.signal.aborted) {
        throw new Error(
          "Live recovery reattach ended before the runtime reached a terminal state.",
        );
      }

      await this.callbacks.captureUsageFromRuntimeSession(ctx, runtimeClient, session.session.id);

      if (ctx.sandbox) {
        try {
          await this.callbacks.importIntegrationSkillDraftsFromSandbox(ctx);
        } catch (error) {
          console.error("[GenerationManager] Failed to import integration skill drafts:", error);
        }
      }

      if (ctx.abortController.signal.aborted) {
        if (ctx.abortForInterruptPark) {
          return;
        }
        const { stats: opencodeStats } = eventLoop.snapshot();
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} mode=${modeLabel} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount}`,
        );
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      const { stats: opencodeStats } = eventLoop.snapshot();
      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} mode=${modeLabel} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount}`,
      );
      await this.callbacks.finishGeneration(ctx, "completed");
    } catch (error) {
      clearReattachTimeout?.();
      if (reattachTimeoutTriggered) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      if (error instanceof GenerationSuspendedError) {
        logger.info({
          event: "GENERATION_SUSPENDED_FOR_INTERRUPT",
          ...{
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
          ...{
            interruptId: error.interruptId,
            interruptKind: error.kind,
            remainingRunMs: ctx.remainingRunMs,
          },
        });
        return;
      }
      console.error("[GenerationManager] Recovery reattach error:", error);
      const runtimeFailure = await this.callbacks.resolveRuntimeFailure(ctx, runtimeClient);
      this.callbacks.captureOriginalError(ctx, error, { runtimeFailure });
      if (runtimeFailure === "waiting_approval" || runtimeFailure === "waiting_auth") {
        return;
      }
      if (runtimeFailure === "sandbox_missing") {
        this.callbacks.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage =
          "The sandbox stopped while this run was still active. Retry the task to continue.";
      } else if (runtimeFailure === "broken_runtime_state") {
        this.callbacks.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The runtime ended in a non-terminal state and could not be recovered. Retry the task to continue.";
      } else if (runtimeFailure === "terminal_failed") {
        this.callbacks.setCompletionReason(ctx, "runtime_error");
      } else if (runtimeFailure === "terminal_completed") {
        this.callbacks.setCompletionReason(ctx, "completed");
      } else if (!ctx.completionReason) {
        this.callbacks.setCompletionReason(ctx, "infra_disconnect");
      }
      if (!ctx.errorMessage && runtimeFailure !== "terminal_completed") {
        ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      }
      if (runtimeFailure === "terminal_completed") {
        if (runtimeClient && ctx.sessionId) {
          await this.callbacks.captureUsageFromRuntimeSession(ctx, runtimeClient, ctx.sessionId);
        }
        await this.callbacks.finishGeneration(ctx, "completed");
        return;
      }
      await this.callbacks.finishGeneration(ctx, "error");
    }
  }
}
