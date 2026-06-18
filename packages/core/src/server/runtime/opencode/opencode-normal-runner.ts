import {
  isOpaqueDiagnosticMessage,
  resolveOpenCodePromptCompletion,
  waitForOpenCodeTerminalStateAfterEarlyStreamEnd,
} from "./opencode-runtime-driver";
import { logger } from "../../utils/observability";
import { GenerationSuspendedError } from "../../services/generation/core/turn-suspension";
import type { GenerationContext } from "../../services/generation/types";
import type { NormalRunnerCallbacks } from "./opencode-runner-types";
import {
  OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS,
  OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS,
  OPENCODE_STATUS_POLL_INTERVAL_MS,
  formatErrorMessage,
  isBootstrapTimeoutError,
  resolveRuntimeNoProgressTimeoutMs,
} from "./opencode-runner-support";
import { runNormalRunnerBootstrap } from "./opencode-runner-bootstrap";
import { RuntimeNoProgressWatchdog } from "./opencode-runner-watchdog";

export type { NormalRunnerCallbacks } from "./opencode-runner-types";

export class OpenCodeNormalRunner {
  constructor(private readonly callbacks: NormalRunnerCallbacks) {}

  async run(ctx: GenerationContext): Promise<void> {
    let promptTimeoutTriggered = false;
    let clearPromptTimeout: (() => void) | undefined;
    let watchdog: RuntimeNoProgressWatchdog | undefined;
    let client: import("../../sandbox/core/types").RuntimeHarnessClient | undefined;
    try {
      if (await this.callbacks.refreshCancellationSignal(ctx, { force: true })) {
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      const bootstrap = await runNormalRunnerBootstrap(ctx, this.callbacks);
      const {
        runtimeClient,
        activeSessionId,
        runtimeSandbox,
        promptSpec,
        modelConfig,
        promptParts,
        eventStream,
        promptTimeoutController,
        verboseOpenCodeEventLogs,
        stagedUploadCount,
        startPostPromptCacheWrite,
      } = bootstrap;
      client = runtimeClient;

      let lastExternalInterruptPollAt = 0;
      let reconciledTerminalIdle = false;

      // Send the prompt to OpenCode
      logger.info({
        event: "OPENCODE_PROMPT_SENT",
        ...{
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId: activeSessionId,
        },
      });
      if (ctx.remoteIntegrationSource) {
        this.callbacks.recordRemoteRunPhase(ctx, "prompt_sent");
      }
      this.callbacks.markPhase(ctx, "prompt_sent");
      if (startPostPromptCacheWrite !== null) {
        void (startPostPromptCacheWrite as () => Promise<void>)().catch((error) => {
          console.error("[GenerationManager] Failed to write post-prompt cache:", error);
        });
      }
      const promptSentAtMs = Date.now();
      const remainingRunTimeMs = this.callbacks.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const runtimeNoProgressTimeoutMs = resolveRuntimeNoProgressTimeoutMs(ctx);
      const forceRuntimeNoProgress =
        ctx.executionPolicy.debugForceRuntimeNoProgressAfterPrompt === true;
      const promptTimeoutId = setTimeout(() => {
        promptTimeoutTriggered = true;
        promptTimeoutController.abort();
        logger.error({
          event: "OPENCODE_PROMPT_TIMEOUT",
          ...{
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
          ...{ timeoutMs: remainingRunTimeMs },
        });
        void runtimeClient.abort({ sessionID: activeSessionId }).catch((err) => {
          console.error("[GenerationManager] Failed to abort timed out OpenCode session:", err);
        });
      }, remainingRunTimeMs);
      clearPromptTimeout = () => {
        clearTimeout(promptTimeoutId);
        clearPromptTimeout = undefined;
      };
      const promptResultPromise = runtimeClient
        .prompt({
          sessionID: activeSessionId,
          parts: promptParts,
          agent: promptSpec.agentId,
          tools: { "*": true },
          system: promptSpec.systemPrompt,
          model: modelConfig,
        })
        .then(
          (data) => {
            return { ok: true as const, data };
          },
          (error) => {
            return { ok: false as const, error };
          },
        );
      this.callbacks.startExternalInterruptPolling(ctx);

      const eventLoop = this.callbacks.opencodeTurnEvents.createEventLoop({
        ctx,
        client: runtimeClient,
        mode: "normal",
        verboseEventLogs: verboseOpenCodeEventLogs,
        pollExternalInterruptAndSuspendIfNeeded: async () => {
          if (Date.now() - lastExternalInterruptPollAt >= 1_000) {
            lastExternalInterruptPollAt = Date.now();
            await this.callbacks.pollExternalInterruptAndSuspendIfNeeded(ctx);
          }
        },
        onIdle: () => {
          this.callbacks.markPhase(ctx, "session_idle");
          console.log("[GenerationManager] Session idle - generation complete");
        },
        onSessionError: (errorMessage) => {
          logger.error({
            event: "OPENCODE_SESSION_ERROR",
            ...{
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
            ...{
              errorMessage,
            },
          });
          if (ctx.remoteIntegrationSource) {
            this.callbacks.recordRemoteRunPhase(ctx, "session_error", {
              sessionErrorMessage: errorMessage,
            });
          }
        },
      });

      watchdog = new RuntimeNoProgressWatchdog({
        ctx,
        callbacks: this.callbacks,
        runtimeClient,
        runtimeSandbox,
        sessionId: activeSessionId,
        promptSentAtMs,
        remainingRunTimeMs,
        runtimeNoProgressTimeoutMs,
        forceRuntimeNoProgress,
        promptTimeoutController,
        snapshot: () => eventLoop.snapshot(),
        finishGeneration: (c, status) => this.callbacks.finishGeneration(c, status),
        clearPromptTimeout: () => clearPromptTimeout?.(),
      });
      const runtimeNoProgressPromise = watchdog.promise;
      watchdog.start();

      // Process SSE events, but do not let an open transport-only stream mask
      // the post-prompt no-progress watchdog.
      const eventLoopConsumePromise = eventLoop.consume(eventStream).then(
        (value) => ({ type: "event_loop" as const, value }),
        (error) => ({ type: "event_loop_error" as const, error }),
      );
      const eventLoopConsumeOutcome = await Promise.race([
        eventLoopConsumePromise,
        runtimeNoProgressPromise,
      ]);
      let deferredSessionError: Error | null = null;
      if (
        eventLoopConsumeOutcome.type === "event_loop_error" &&
        !watchdog.wasTriggered
      ) {
        const sessionErrorMessage = eventLoop.snapshot().sessionErrorMessage;
        if (sessionErrorMessage && !ctx.abortController.signal.aborted && !promptTimeoutTriggered) {
          deferredSessionError =
            eventLoopConsumeOutcome.error instanceof Error
              ? eventLoopConsumeOutcome.error
              : new Error(sessionErrorMessage);
        } else {
          throw eventLoopConsumeOutcome.error;
        }
      }

      if (watchdog.wasTriggered) {
        await watchdog.finishFailure(
          watchdog.triggeredReason ?? "runtime_no_progress_after_prompt",
        );
        return;
      }

      if (
        !eventLoop.snapshot().sawSessionIdle &&
        !eventLoop.snapshot().sessionErrorMessage &&
        !ctx.abortController.signal.aborted &&
        !promptTimeoutTriggered
      ) {
        const terminalOutcomeResult = await Promise.race([
          waitForOpenCodeTerminalStateAfterEarlyStreamEnd({
            runtimeClient,
            sessionId: activeSessionId,
            maxReattachAttempts: OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS,
            reattachWaitMs: OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS,
            statusPollIntervalMs: OPENCODE_STATUS_POLL_INTERVAL_MS,
            getRemainingRunTimeMs: () => this.callbacks.getRemainingRunTimeMs(ctx),
            isAbortRequested: () =>
              ctx.abortController.signal.aborted ||
              (watchdog?.wasTriggered ?? false) ||
              promptTimeoutTriggered,
            refreshCancellationSignal: () => this.callbacks.refreshCancellationSignal(ctx),
            pollExternalInterruptAndSuspendIfNeeded: () =>
              this.callbacks.pollExternalInterruptAndSuspendIfNeeded(ctx),
            onEvent: (rawEvent) => eventLoop.process(rawEvent),
            logReattachFailure: (attempt, error) => {
              console.warn(
                `[GenerationManager] OpenCode terminal reattach failed attempt=${attempt} generationId=${ctx.id}:`,
                error,
              );
            },
            logStatusPollError: (error) => {
              console.warn("[GenerationManager] OpenCode status poll returned an error:", error);
            },
            logStatusReconciliationFailure: (error) => {
              console.warn("[GenerationManager] OpenCode status reconciliation failed:", error);
            },
          }).then((value) => ({ type: "terminal" as const, value })),
          runtimeNoProgressPromise,
        ]);
        if (terminalOutcomeResult.type === "runtime_no_progress") {
          await watchdog.finishFailure(terminalOutcomeResult.reason);
          return;
        }
        const terminalOutcome = terminalOutcomeResult.value;
        if (terminalOutcome === "idle") {
          reconciledTerminalIdle = true;
          if (!ctx.phaseMarks?.session_idle) {
            this.callbacks.markPhase(ctx, "session_idle");
          }
        } else if (terminalOutcome === "timed_out") {
          await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
          return;
        } else if (terminalOutcome === "aborted") {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.callbacks.finishGeneration(ctx, "cancelled");
          return;
        }
        if (terminalOutcome !== "unknown") {
          console.info(
            `[GenerationManager] OpenCode early stream reconciliation outcome=${terminalOutcome} generationId=${ctx.id} conversationId=${ctx.conversationId}`,
          );
        }
      }

      const promptResultOutcome = await Promise.race([
        this.callbacks.awaitPromiseUntilRunDeadline(ctx, promptResultPromise),
        runtimeNoProgressPromise,
      ]);
      this.callbacks.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      watchdog.clear();
      if (promptResultOutcome.type === "runtime_no_progress") {
        await watchdog.finishFailure(promptResultOutcome.reason);
        return;
      }
      if (promptResultOutcome.type === "timed_out" || promptTimeoutTriggered) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const promptResultEnvelope = promptResultOutcome.value;
      const observedTerminalIdle = eventLoop.snapshot().sawSessionIdle || reconciledTerminalIdle;
      const sessionErrorMessage = eventLoop.snapshot().sessionErrorMessage;
      if (sessionErrorMessage) {
        throw deferredSessionError ?? new Error(sessionErrorMessage);
      }
      const promptElapsedMs = Date.now() - promptSentAtMs;
      if (promptElapsedMs >= remainingRunTimeMs) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      ctx.lastRuntimeProgressAt = new Date();
      ctx.lastRuntimeProgressKind = "prompt_completed";
      this.callbacks.markPhase(ctx, "prompt_completed");

      const completionResolution = await resolveOpenCodePromptCompletion({
        promptResultEnvelope,
        runtimeClient,
        sessionId: activeSessionId,
        sandbox: ctx.sandbox,
        needsAssistantText: !ctx.assistantContent.trim(),
        observedTerminalIdle,
        logPromptTransportErrorAfterIdle: (error) => {
          console.warn(
            "[GenerationManager] Ignoring prompt transport error after session idle:",
            error,
          );
        },
        logOpaquePromptResultError: (error) => {
          console.warn(
            "[GenerationManager] Treating opaque prompt result error as empty completion:",
            error,
          );
        },
        logFallbackMessagesError: (error) => {
          console.warn("[GenerationManager] Failed fallback session.messages fetch:", error);
        },
      });

      if (!ctx.assistantContent.trim() && completionResolution.assistantText) {
        if (!ctx.phaseMarks?.first_visible_output_emitted) {
          this.callbacks.markPhase(ctx, "first_visible_output_emitted");
        }
        if (!ctx.phaseMarks?.first_token_emitted) {
          this.callbacks.markPhase(ctx, "first_token_emitted");
        }
        ctx.assistantContent = completionResolution.assistantText;
        ctx.contentParts.push({
          type: "text",
          text: completionResolution.assistantText,
        });
        this.callbacks.broadcast(ctx, {
          type: "text",
          content: completionResolution.assistantText,
        });
        this.callbacks.scheduleSave(ctx);
        logger.info({
          event:
            completionResolution.assistantTextSource === "session_messages"
              ? "OPENCODE_FALLBACK_ASSISTANT_APPLIED"
              : "OPENCODE_PROMPT_RESULT_ASSISTANT_APPLIED",
          ...{
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
          ...{ chars: completionResolution.assistantText.length },
        });
      }

      if (!ctx.assistantContent.trim()) {
        await this.callbacks.refreshCancellationSignal(ctx, { force: true });
        if (ctx.abortController.signal.aborted) {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.callbacks.finishGeneration(ctx, "cancelled");
          return;
        }

        if (!ctx.assistantContent.trim() && !observedTerminalIdle) {
          const emptyCompletionDiagnostics = completionResolution.emptyCompletionDiagnostics;
          if (!emptyCompletionDiagnostics) {
            throw new Error("OpenCode empty-completion diagnostics were not collected.");
          }
          const bestTranscriptError = completionResolution.bestTranscriptError;
          this.callbacks.setCompletionReason(ctx, "runtime_error");
          ctx.errorMessage = !isOpaqueDiagnosticMessage(bestTranscriptError)
            ? `The sandbox run finished without producing any assistant output. Loading the runtime transcript also failed: ${bestTranscriptError}`
            : "The sandbox run finished without producing any assistant output. The runtime produced no assistant text, no terminal event, and the transcript endpoint returned no usable error details.";
          this.callbacks.captureOriginalError(
            ctx,
            new Error(
              !isOpaqueDiagnosticMessage(bestTranscriptError)
                ? `OpenCode transcript fetch failed after empty completion: ${bestTranscriptError}`
                : "OpenCode returned no assistant text or transcript after prompt completion.",
            ),
            {
              phase: "prompt_completed",
            },
          );
          logger.error({
            event: "OPENCODE_EMPTY_COMPLETION",
            ...{
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
            ...{
              sessionIdleObserved: observedTerminalIdle,
              fallbackMessagesError: completionResolution.fallbackMessagesError,
              fallbackMessagesErrorDetail: completionResolution.fallbackMessagesErrorDetail,
              fallbackMessagesPayloadShape: completionResolution.fallbackMessagesPayloadShape,
              promptResultDataShape: completionResolution.promptResultDataShape,
              sessionGetError: emptyCompletionDiagnostics.sessionGetError,
              sessionGetErrorDetail: emptyCompletionDiagnostics.sessionGetErrorDetail,
              sessionGetDataShape: emptyCompletionDiagnostics.sessionGetDataShape,
              sessionGetDataDetail: emptyCompletionDiagnostics.sessionGetDataDetail,
              opencodeLogTail: emptyCompletionDiagnostics.opencodeLogTail,
              opencodeLogReadError: emptyCompletionDiagnostics.opencodeLogReadError,
            },
          });
          await this.callbacks.finishGeneration(ctx, "error");
          return;
        }
      }

      await this.callbacks.refreshCancellationSignal(ctx, { force: true });
      this.callbacks.markPhase(ctx, "post_processing_started");

      if (ctx.sandbox) {
        try {
          await this.callbacks.importIntegrationSkillDraftsFromSandbox(ctx);
        } catch (error) {
          console.error("[GenerationManager] Failed to import integration skill drafts:", error);
        }
      }

      // Collect new files created in the sandbox during generation
      let uploadedSandboxFileCount = 0;
      const { stats: opencodeStats } = eventLoop.snapshot();
      const shouldCollectSandboxFiles = opencodeStats.toolCallCount > 0 || stagedUploadCount > 0;
      if (ctx.sandbox && ctx.generationMarkerTime && shouldCollectSandboxFiles) {
        uploadedSandboxFileCount =
          await this.callbacks.turnFinalizer.collectAndExposeMentionedSandboxFiles(ctx, {
            summaryMessage: ({ discoveredCount, exposedCount }) =>
              `[GenerationManager] Found ${discoveredCount} new files in E2B sandbox; exposing ${exposedCount} based on final-answer mentions`,
            collectionErrorMessage: "[GenerationManager] Failed to collect sandbox files:",
            uploadErrorMessage: (filePath) =>
              `[GenerationManager] Failed to upload sandbox file ${filePath}:`,
          });
      }
      this.callbacks.markPhase(ctx, "post_processing_completed");
      await this.callbacks.captureUsageFromRuntimeSession(ctx, runtimeClient, activeSessionId);

      // Check if aborted
      if (ctx.abortController.signal.aborted) {
        if (ctx.abortForInterruptPark) {
          return;
        }
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
        );
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      // Complete the generation
      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
      );
      await this.callbacks.finishGeneration(ctx, "completed");
    } catch (error) {
      this.callbacks.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      watchdog?.clear();
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
      if (isBootstrapTimeoutError(error)) {
        this.callbacks.captureOriginalError(ctx, error, {
          phase: this.callbacks.getCurrentPhase(ctx) ?? "agent_init_failed",
        });
        this.callbacks.setCompletionReason(ctx, "bootstrap_timeout");
        ctx.errorMessage = error instanceof Error ? error.message : formatErrorMessage(error);
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }
      if (promptTimeoutTriggered) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, client);
        return;
      }
      console.error("[GenerationManager] Error:", error);
      const runtimeFailure = await this.callbacks.resolveRuntimeFailure(ctx, client);
      this.callbacks.captureOriginalError(ctx, error, { runtimeFailure });
      if (runtimeFailure === "recoverable_live_runtime") {
        this.callbacks.scheduleRecoveryReattach(ctx);
        return;
      }
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
        if (client && ctx.sessionId) {
          await this.callbacks.captureUsageFromRuntimeSession(ctx, client, ctx.sessionId);
        }
        await this.callbacks.finishGeneration(ctx, "completed");
        return;
      }
      console.info(
        `[GenerationManager][SUMMARY] status=error generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} error=${JSON.stringify(ctx.errorMessage)}`,
      );
      await this.callbacks.finishGeneration(ctx, "error");
    }
  }
}
