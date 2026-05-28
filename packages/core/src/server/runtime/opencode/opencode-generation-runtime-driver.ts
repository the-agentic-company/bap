import type {
  RuntimeHarnessClient,
  RuntimePromptPart,
} from "../../sandbox/core/types";
import {
  captureOpenCodeUsageFromSession,
  updateOpenCodeToolPart,
} from "./opencode-runtime-driver";
import { sendOpenCodeRuntimeDecision } from "./opencode-runtime-actions";
import { inspectOpenCodeRuntimeFailureState } from "./opencode-reattach";
import type {
  RuntimeAbortTurnInput,
  RuntimeActionableEvent,
  RuntimeApplyDecisionInput,
  RuntimeApprovalRequest,
  RuntimeCompletion,
  RuntimeDriver,
  RuntimeReattachTurnInput,
  RuntimeResumeTurnInput,
  RuntimeStartTurnInput,
  RuntimeTurn,
  RuntimeToolRef,
  RuntimeUsage,
  RuntimeUsageInput,
} from "../runtime-driver";
import { generationInterruptService } from "../../services/generation-interrupt-service";
import {
  generationLifecyclePolicy,
  type GenerationCompletionReason,
  type RuntimeFailureClassification,
} from "../../services/lifecycle-policy";
import { OpenCodeNormalRunner } from "./opencode-normal-runner";
import { OpenCodeRecoveryRunner } from "./opencode-recovery-runner";
import { OpenCodeTurnEventBridge } from "./opencode-turn-events";
import type { GenerationTurnFinalizer } from "../../services/generation/core/turn-finalizer";
import type { DecisionFlow, InterruptParking } from "../../services/generation/decisions/decision-flow";
import type { GenerationContextState } from "../../services/generation/runtime/generation-context-state";
import type {
  GenerationContext,
  GenerationEvent,
  GenerationStatus,
  RemoteRunDebugPhase,
} from "../../services/generation/types";

type TerminalGenerationStatus = Extract<
  GenerationStatus,
  "completed" | "cancelled" | "error"
>;

export type RuntimeRecoveryReattachOptions = {
  allowSnapshotRestore?: boolean;
  requireLiveSession?: boolean;
  resumeInterruptId?: string;
  modeLabel?: string;
  onRuntimeAttached?: (
    runtimeClient: RuntimeHarnessClient,
  ) => Promise<RuntimePromptPart[] | void>;
  completeAfterRuntimeAttached?: boolean;
  skipUsageCaptureAfterRuntimeAttached?: boolean;
};

export type OpenCodeGenerationRuntimeDriverDependencies = {
  bootstrapTimeoutMs: number;
  contextState: GenerationContextState;
  decisionFlow: DecisionFlow;
  interruptParking: InterruptParking;
  turnFinalizer: GenerationTurnFinalizer;
  refreshCancellationSignal: (
    ctx: GenerationContext,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  finishGeneration: (
    ctx: GenerationContext,
    status: TerminalGenerationStatus,
  ) => Promise<void>;
  setSnapshotRestoreAllowance: (
    ctx: Pick<GenerationContext, "id" | "executionPolicy">,
    allowed: boolean,
  ) => Promise<void>;
  parkGenerationForRunDeadline: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<void>;
  awaitPromiseUntilRunDeadline: <T>(
    ctx: Pick<GenerationContext, "deadlineAt">,
    promise: Promise<T>,
  ) => Promise<{ type: "resolved"; value: T } | { type: "timed_out" }>;
  importIntegrationSkillDraftsFromSandbox: (
    ctx: GenerationContext,
  ) => Promise<void>;
  scheduleRecoveryReattach: (ctx: GenerationContext) => void;
  recordRecoveryAttempt: (ctx: GenerationContext) => Promise<void>;
  saveProgress: (ctx: GenerationContext) => Promise<void>;
  scheduleSave: (ctx: GenerationContext) => void;
  broadcast: (ctx: GenerationContext, event: GenerationEvent) => void;
  getActiveContext: (generationId: string) => GenerationContext | undefined;
};

export class OpenCodeGenerationRuntimeDriver implements RuntimeDriver {
  private readonly turnEvents: OpenCodeTurnEventBridge;
  private readonly normalRunner: OpenCodeNormalRunner;
  private readonly recoveryRunner: OpenCodeRecoveryRunner;
  private readonly boundContexts = new Map<string, GenerationContext>();
  private runtimeFailureResolver:
    | ((
        ctx: GenerationContext,
        runtimeClient?: RuntimeHarnessClient,
      ) => Promise<RuntimeFailureClassification>)
    | undefined;

  constructor(private readonly deps: OpenCodeGenerationRuntimeDriverDependencies) {
    this.turnEvents = new OpenCodeTurnEventBridge({
      markPhase: (ctx, phase) => this.deps.contextState.markPhase(ctx, phase),
      broadcast: (ctx, event) => this.deps.broadcast(ctx, event),
      scheduleSave: (ctx) => this.deps.scheduleSave(ctx),
      saveProgress: (ctx) => this.deps.saveProgress(ctx),
      markRuntimeProgress: (ctx, kind) =>
        this.deps.contextState.markRuntimeProgress(ctx, kind),
      refreshCancellationSignal: (ctx) =>
        this.deps.refreshCancellationSignal(ctx),
      handleActionableEvent: (ctx, event, sendRuntimeDecision) =>
        this.handleRuntimeActionableEvent(ctx, event, sendRuntimeDecision),
    });

    this.normalRunner = new OpenCodeNormalRunner({
      bootstrapTimeoutMs: this.deps.bootstrapTimeoutMs,
      opencodeTurnEvents: this.turnEvents,
      refreshCancellationSignal: (ctx, options) =>
        this.deps.refreshCancellationSignal(ctx, options),
      finishGeneration: (ctx, status) =>
        this.deps.finishGeneration(ctx, status),
      setCompletionReason: (ctx, reason) =>
        this.deps.contextState.setCompletionReason(ctx, reason),
      ensureRemoteRunDebugInfo: (ctx) =>
        this.deps.contextState.ensureRemoteRunDebugInfo(ctx),
      recordRemoteRunPhase: (ctx, phase, patch) =>
        this.deps.contextState.recordRemoteRunPhase(
          ctx,
          phase as RemoteRunDebugPhase,
          patch,
        ),
      markPhase: (ctx, phase) => this.deps.contextState.markPhase(ctx, phase),
      broadcast: (ctx, event) => this.deps.broadcast(ctx, event),
      bindRuntimeSandboxToContext: (ctx, input) =>
        this.deps.contextState.bindRuntimeSandboxToContext(ctx, input),
      bindRuntimeSessionToContext: (ctx, input) =>
        this.deps.contextState.bindRuntimeSessionToContext(ctx, input),
      persistRuntimeSessionBinding: (ctx, input) =>
        this.deps.contextState.persistRuntimeSessionBinding(ctx, input),
      setSnapshotRestoreAllowance: (ctx, allowed) =>
        this.deps.setSnapshotRestoreAllowance(ctx, allowed),
      getRemainingRunTimeMs: (ctx) =>
        this.deps.contextState.getRemainingRunTimeMs(ctx),
      parkGenerationForRunDeadline: (ctx, runtimeClient) =>
        this.deps.parkGenerationForRunDeadline(ctx, runtimeClient),
      startExternalInterruptPolling: (ctx) =>
        this.deps.interruptParking.startExternalInterruptPolling(ctx),
      stopExternalInterruptPolling: (ctx) =>
        this.deps.interruptParking.stopExternalInterruptPolling(ctx),
      pollExternalInterruptAndSuspendIfNeeded: (ctx) =>
        this.deps.interruptParking.pollExternalInterruptAndSuspendIfNeeded(ctx),
      awaitPromiseUntilRunDeadline: (ctx, promise) =>
        this.deps.awaitPromiseUntilRunDeadline(ctx, promise),
      scheduleSave: (ctx) => this.deps.scheduleSave(ctx),
      importIntegrationSkillDraftsFromSandbox: (ctx) =>
        this.deps.importIntegrationSkillDraftsFromSandbox(ctx),
      captureUsageFromRuntimeSession: (ctx, runtimeClient, sessionId) =>
        this.captureUsageFromRuntimeSession(ctx, runtimeClient, sessionId),
      captureOriginalError: (ctx, error, input) =>
        this.deps.contextState.captureOriginalError(ctx, error, input),
      getCurrentPhase: (ctx) => this.deps.contextState.getCurrentPhase(ctx),
      resolveRuntimeFailure: (ctx, runtimeClient) =>
        this.resolveRuntimeFailureForCallback(ctx, runtimeClient),
      scheduleRecoveryReattach: (ctx) =>
        this.deps.scheduleRecoveryReattach(ctx),
      turnFinalizer: this.deps.turnFinalizer,
    });

    this.recoveryRunner = new OpenCodeRecoveryRunner({
      bootstrapTimeoutMs: this.deps.bootstrapTimeoutMs,
      turnEvents: this.turnEvents,
      refreshCancellationSignal: (ctx, options) =>
        this.deps.refreshCancellationSignal(ctx, options),
      finishGeneration: (ctx, status) =>
        this.deps.finishGeneration(ctx, status),
      setCompletionReason: (ctx, reason) =>
        this.deps.contextState.setCompletionReason(ctx, reason),
      bindRuntimeSessionToContext: (ctx, input) =>
        this.deps.contextState.bindRuntimeSessionToContext(ctx, input),
      broadcast: (ctx, event) => this.deps.broadcast(ctx, event),
      resolveSandboxRuntimeEnvForContext: (ctx) =>
        this.deps.contextState.resolveSandboxRuntimeEnvForContext(ctx),
      applyResolvedInterruptToRuntime: (ctx, interruptId, runtimeClient) =>
        this.applyResolvedInterruptToRuntime(ctx, interruptId, runtimeClient),
      setSnapshotRestoreAllowance: (ctx, allowed) =>
        this.deps.setSnapshotRestoreAllowance(ctx, allowed),
      getRemainingRunTimeMs: (ctx) =>
        this.deps.contextState.getRemainingRunTimeMs(ctx),
      parkGenerationForRunDeadline: (ctx, runtimeClient) =>
        this.deps.parkGenerationForRunDeadline(ctx, runtimeClient),
      awaitPromiseUntilRunDeadline: (ctx, promise) =>
        this.deps.awaitPromiseUntilRunDeadline(ctx, promise),
      captureUsageFromRuntimeSession: (ctx, runtimeClient, sessionId) =>
        this.captureUsageFromRuntimeSession(ctx, runtimeClient, sessionId),
      importIntegrationSkillDraftsFromSandbox: (ctx) =>
        this.deps.importIntegrationSkillDraftsFromSandbox(ctx),
      resolveRuntimeFailure: (ctx, runtimeClient) =>
        this.resolveRuntimeFailureForCallback(ctx, runtimeClient),
      captureOriginalError: (ctx, error, input) =>
        this.deps.contextState.captureOriginalError(ctx, error, input),
    });
  }

  async runNormal(ctx: GenerationContext): Promise<void> {
    await this.normalRunner.run(ctx);
  }

  bindGenerationContext(ctx: GenerationContext): void {
    this.boundContexts.set(ctx.id, ctx);
  }

  setRuntimeFailureResolver(
    resolver: (
      ctx: GenerationContext,
      runtimeClient?: RuntimeHarnessClient,
    ) => Promise<RuntimeFailureClassification>,
  ): void {
    this.runtimeFailureResolver = resolver;
  }

  async runRecoveryReattach(
    ctx: GenerationContext,
    options?: RuntimeRecoveryReattachOptions,
  ): Promise<void> {
    await this.recoveryRunner.run(ctx, options);
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<RuntimeTurn> {
    const ctx = this.requireContext(input.generationId);
    return this.toRuntimeTurn(ctx, this.runNormal(ctx));
  }

  async resumeTurn(input: RuntimeResumeTurnInput): Promise<RuntimeTurn> {
    const ctx = this.requireContext(input.generationId);
    return this.toRuntimeTurn(ctx, this.runNormal(ctx));
  }

  async reattachTurn(input: RuntimeReattachTurnInput): Promise<RuntimeTurn> {
    const ctx = this.requireContext(input.generationId);
    const recovery = (input as RuntimeReattachTurnInput & {
      recovery?: RuntimeRecoveryReattachOptions;
    }).recovery;
    return this.toRuntimeTurn(
      ctx,
      this.runRecoveryReattach(ctx, {
        allowSnapshotRestore: input.allowSnapshotRestore,
        requireLiveSession: input.requireLiveSession,
        ...recovery,
      }),
    );
  }

  async applyDecision(_input: RuntimeApplyDecisionInput): Promise<void> {
    // OpenCode decisions are applied by the live event bridge or recovery
    // reattach callback while the runtime client is active.
  }

  async abortTurn(_input: RuntimeAbortTurnInput): Promise<void> {
    // The current OpenCode harness abort path is still owned by the active
    // generation abort controller. Keeping this explicit operation on the
    // adapter prevents generation modules from importing OpenCode abort helpers.
  }

  async captureUsage(_input: RuntimeUsageInput): Promise<RuntimeUsage> {
    return { inputTokens: 0, outputTokens: 0 };
  }

  async updateRuntimeToolPart(
    runtimeClient: RuntimeHarnessClient,
    runtimeTool: RuntimeToolRef,
    patch:
      | { status: "completed"; input: Record<string, unknown>; output: string }
      | { status: "error"; input: Record<string, unknown>; error: string },
  ): Promise<void> {
    await updateOpenCodeToolPart(runtimeClient, runtimeTool, patch);
  }

  private async captureUsageFromRuntimeSession(
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ): Promise<void> {
    try {
      const usage = await captureOpenCodeUsageFromSession(
        runtimeClient,
        sessionId,
      );
      if (!usage) {
        return;
      }
      ctx.usage = {
        ...ctx.usage,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    } catch (error) {
      console.warn(
        "[OpenCodeGenerationRuntimeDriver] Failed to capture usage from runtime session:",
        error,
      );
    }
  }

  async resolveRuntimeFailure(
    ctx: GenerationContext,
    client?: RuntimeHarnessClient,
  ): Promise<RuntimeFailureClassification> {
    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(ctx.id);
    const inspected = await inspectOpenCodeRuntimeFailureState({
      sessionId: ctx.sessionId,
      client,
      sandbox: ctx.sandbox,
      pendingInterruptKind: pendingInterrupt
        ? pendingInterrupt.kind === "auth"
          ? "auth"
          : "approval"
        : null,
      canRecover:
        generationLifecyclePolicy.maxRecoveryAttempts >
        (ctx.recoveryAttempts ?? 0),
    });
    if (inspected.classification !== "recoverable_live_runtime") {
      return inspected.classification;
    }

    await this.deps.recordRecoveryAttempt(ctx);
    return inspected.classification;
  }

  private async resolveRuntimeFailureForCallback(
    ctx: GenerationContext,
    client?: RuntimeHarnessClient,
  ): Promise<RuntimeFailureClassification> {
    if (this.runtimeFailureResolver) {
      return await this.runtimeFailureResolver(ctx, client);
    }
    return await this.resolveRuntimeFailure(ctx, client);
  }

  private requireContext(generationId: string): GenerationContext {
    const ctx =
      this.deps.getActiveContext(generationId) ??
      this.boundContexts.get(generationId);
    if (!ctx) {
      throw new Error(`No active generation context for runtime turn ${generationId}`);
    }
    return ctx;
  }

  private toRuntimeTurn(
    ctx: GenerationContext,
    completionPromise: Promise<void>,
  ): RuntimeTurn {
    return {
      session: {
        runtimeId: ctx.runtimeId ?? "",
        turnSeq: ctx.runtimeTurnSeq ?? 0,
        sessionId: ctx.sessionId ?? "",
      },
      events: this.emptyRuntimeEvents(),
      completion: (async (): Promise<RuntimeCompletion> => {
        try {
          await completionPromise;
          return { status: "completed", assistantText: ctx.assistantContent };
        } catch (error) {
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            recoverable: false,
          };
        }
      })(),
    };
  }

  private async *emptyRuntimeEvents(): AsyncIterable<never> {}

  async handleRuntimeActionableEvent(
    ctx: GenerationContext,
    event: RuntimeActionableEvent,
    sendRuntimeDecision: (request: RuntimeApprovalRequest) => Promise<void>,
  ): Promise<{ type: "none" | "permission" | "question" }> {
    return this.deps.decisionFlow.handleRuntimeActionableEvent({
      ctx,
      event,
      sendRuntimeDecision,
      hotWaitMs: this.deps.contextState.getApprovalHotWaitMs(ctx),
      timeoutMs: generationLifecyclePolicy.approvalTimeoutMs,
      saveProgress: () => this.deps.saveProgress(ctx),
      broadcast: (generationEvent) => this.deps.broadcast(ctx, generationEvent),
      parkForInterrupt: (interrupt) =>
        this.deps.interruptParking.parkGenerationForInterrupt(ctx, interrupt),
    });
  }

  private async applyResolvedInterruptToRuntime(
    ctx: GenerationContext,
    interruptId: string,
    runtimeClient: RuntimeHarnessClient,
  ): Promise<void> {
    await this.deps.decisionFlow.applyResolvedInterruptToRuntime({
      ctx,
      interruptId,
      sendRuntimeDecision: (request) =>
        sendOpenCodeRuntimeDecision(runtimeClient, request),
      broadcastResolvedEvent: (event) => this.deps.broadcast(ctx, event),
    });
  }
}
