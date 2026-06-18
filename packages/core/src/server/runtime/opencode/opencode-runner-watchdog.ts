import type { RuntimeHarnessClient, SandboxHandle } from "../../sandbox/core/types";
import type { GenerationContext } from "../../services/generation/types";
import { captureRuntimeNoProgressDiagnosticSnapshot } from "../../services/runtime-diagnostic-snapshot-service";
import { logger } from "../../utils/observability";
import type { OpenCodeRuntimeEventLoopSnapshot } from "./opencode-runtime-driver";
import type { NormalRunnerCallbacks, TerminalGenerationStatus } from "./opencode-runner-types";
import {
  RUNTIME_NO_PROGRESS_USER_MESSAGE,
  RUNTIME_PROGRESS_STALLED_USER_MESSAGE,
  probeOpenCodeAssistantMessageError,
} from "./opencode-runner-support";

export type RuntimeWatchdogReason =
  | "runtime_no_progress_after_prompt"
  | "runtime_progress_stalled";

export type RuntimeNoProgressOutcome = {
  type: "runtime_no_progress";
  reason: RuntimeWatchdogReason;
};

// The runtime no-progress watchdog: the policy that decides a turn has stalled
// (no events after the prompt, or progress that went quiet) and tears it down
// with a diagnostic snapshot. It owns the polling interval, the abort that
// cancels the live stream, and the terminal "watchdog failure" finalization.
// The runner drives it through a tiny interface — {promise, start, clear,
// finishFailure} — and never sees the interval bookkeeping.
export class RuntimeNoProgressWatchdog {
  private triggered = false;
  private reason: RuntimeWatchdogReason | null = null;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private resolveNoProgress:
    | ((value: RuntimeNoProgressOutcome) => void)
    | undefined;
  readonly promise: Promise<RuntimeNoProgressOutcome>;

  constructor(
    private readonly deps: {
      ctx: GenerationContext;
      callbacks: NormalRunnerCallbacks;
      runtimeClient: RuntimeHarnessClient;
      runtimeSandbox: SandboxHandle;
      sessionId: string;
      promptSentAtMs: number;
      remainingRunTimeMs: number;
      runtimeNoProgressTimeoutMs: number;
      forceRuntimeNoProgress: boolean;
      promptTimeoutController: AbortController;
      snapshot: () => OpenCodeRuntimeEventLoopSnapshot;
      finishGeneration: (
        ctx: GenerationContext,
        status: TerminalGenerationStatus,
      ) => Promise<void>;
      clearPromptTimeout: () => void;
    },
  ) {
    this.promise = new Promise<RuntimeNoProgressOutcome>((resolve) => {
      this.resolveNoProgress = resolve;
    });
  }

  get wasTriggered(): boolean {
    return this.triggered;
  }

  get triggeredReason(): RuntimeWatchdogReason | null {
    return this.reason;
  }

  start(): void {
    const { ctx } = this.deps;
    if (this.deps.remainingRunTimeMs <= this.deps.runtimeNoProgressTimeoutMs) {
      return;
    }
    this.intervalId = setInterval(
      () => {
        const snapshot = this.deps.snapshot();
        if (snapshot.sawSessionIdle) {
          return;
        }
        if (snapshot.sessionErrorMessage) {
          return;
        }
        if (ctx.abortController.signal.aborted) {
          return;
        }

        const now = Date.now();
        const promptElapsedMs = now - this.deps.promptSentAtMs;
        const stalledMs = now - ctx.lastRuntimeProgressAt.getTime();
        let reason: RuntimeWatchdogReason | null = null;

        if (
          this.deps.forceRuntimeNoProgress ||
          (snapshot.stats.progressEventCount === 0 &&
            promptElapsedMs >= this.deps.runtimeNoProgressTimeoutMs)
        ) {
          reason = "runtime_no_progress_after_prompt";
        } else if (
          snapshot.stats.progressEventCount > 0 &&
          stalledMs >= this.deps.runtimeNoProgressTimeoutMs
        ) {
          reason = "runtime_progress_stalled";
        }

        if (!reason) {
          return;
        }

        this.triggered = true;
        this.reason = reason;
        this.deps.promptTimeoutController.abort();
        logger.error({
          event:
            reason === "runtime_progress_stalled"
              ? "OPENCODE_RUNTIME_PROGRESS_STALLED"
              : "OPENCODE_RUNTIME_NO_PROGRESS_AFTER_PROMPT",
          ...{
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: this.deps.sessionId,
          },
          ...{
            timeoutMs: this.deps.runtimeNoProgressTimeoutMs,
            stalledMs: reason === "runtime_progress_stalled" ? stalledMs : undefined,
            lastRuntimeProgressAt:
              reason === "runtime_progress_stalled"
                ? ctx.lastRuntimeProgressAt.toISOString()
                : undefined,
            lastRuntimeProgressKind:
              reason === "runtime_progress_stalled"
                ? (ctx.lastRuntimeProgressKind ?? "unknown")
                : undefined,
            eventStats: snapshot.stats,
          },
        });
        this.resolveNoProgress?.({ type: "runtime_no_progress", reason });
        void this.deps.runtimeClient
          .abort({ sessionID: this.deps.sessionId })
          .catch((err) => {
            console.error(
              "[GenerationManager] Failed to abort no-progress OpenCode session:",
              err,
            );
          });
      },
      Math.min(1_000, this.deps.runtimeNoProgressTimeoutMs),
    );
  }

  clear(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  async finishFailure(reason: RuntimeWatchdogReason): Promise<void> {
    const { ctx, callbacks } = this.deps;
    this.deps.clearPromptTimeout();
    this.clear();
    const diagnosticSnapshot = await captureRuntimeNoProgressDiagnosticSnapshot({
      ctx,
      runtimeClient: this.deps.runtimeClient,
      sandbox: this.deps.runtimeSandbox,
      sandboxProvider: this.deps.runtimeSandbox.provider,
      sessionId: this.deps.sessionId,
      reason,
      timeoutMs: this.deps.runtimeNoProgressTimeoutMs,
      stalledMs:
        reason === "runtime_progress_stalled"
          ? Math.max(0, Date.now() - ctx.lastRuntimeProgressAt.getTime())
          : undefined,
      lastRuntimeProgressAt:
        reason === "runtime_progress_stalled" ? ctx.lastRuntimeProgressAt : undefined,
      lastRuntimeProgressKind:
        reason === "runtime_progress_stalled"
          ? (ctx.lastRuntimeProgressKind ?? null)
          : undefined,
      promptSentAtMs: this.deps.promptSentAtMs,
      eventLoopSnapshot: this.deps.snapshot(),
    });
    ctx.debugInfo = {
      ...(ctx.debugInfo ?? {}),
      runtimeDiagnosticSnapshot: diagnosticSnapshot,
    };

    const assistantMessageError =
      reason === "runtime_no_progress_after_prompt"
        ? await probeOpenCodeAssistantMessageError({
            runtimeClient: this.deps.runtimeClient,
            sessionId: this.deps.sessionId,
          })
        : null;

    if (assistantMessageError) {
      callbacks.setCompletionReason(ctx, "runtime_error");
      callbacks.markPhase(ctx, "runtime_error");
      ctx.errorMessage = assistantMessageError;
      callbacks.captureOriginalError(
        ctx,
        new Error(`OpenCode assistant message failed after prompt: ${assistantMessageError}`),
        { phase: "prompt_sent" },
      );
      logger.error({
        event: "OPENCODE_ASSISTANT_MESSAGE_ERROR_AFTER_PROMPT",
        ...{
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId: this.deps.sessionId,
        },
        ...{
          originalWatchdogReason: reason,
          timeoutMs: this.deps.runtimeNoProgressTimeoutMs,
          eventStats: this.deps.snapshot().stats,
          errorMessage: assistantMessageError,
        },
      });
      callbacks.scheduleSave(ctx);
      await this.deps.finishGeneration(ctx, "error");
      return;
    }

    callbacks.setCompletionReason(ctx, reason);
    callbacks.markPhase(ctx, reason);
    ctx.errorMessage =
      reason === "runtime_progress_stalled"
        ? RUNTIME_PROGRESS_STALLED_USER_MESSAGE
        : RUNTIME_NO_PROGRESS_USER_MESSAGE;
    callbacks.scheduleSave(ctx);
    await this.deps.finishGeneration(ctx, "error");
  }
}
