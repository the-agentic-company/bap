import type { GenerationDebugInfo, GenerationContext, RemoteRunDebugPhase } from "../types";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type {
  RuntimeFailureClassification,
  GenerationCompletionReason,
  RuntimeProgressKind,
} from "../../lifecycle-policy";
import { logger } from "../../../utils/observability";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import { createSandboxBackend } from "../../../execution/sandbox-backend-adapter";
import { resolveRuntimeEnvironmentForTurn } from "../../../execution/runtime-env";
import type { getOrCreateConversationRuntime } from "../../../sandbox/core/orchestrator";
import type { ExecutionEnvironment } from "../../../execution/execution-environment";

type GenerationContextStateDependencies = {
  lifecycleStore: GenerationLifecycleStore;
  scheduleSave(ctx: GenerationContext): void;
  formatErrorMessage(error: unknown): string;
};

export class GenerationContextState {
  constructor(private readonly deps: GenerationContextStateDependencies) {}

  markRuntimeProgress(ctx: GenerationContext, kind: RuntimeProgressKind, at = new Date()): void {
    ctx.lastRuntimeProgressAt = at;
    ctx.lastRuntimeProgressKind = kind;
  }

  setCompletionReason(
    ctx: GenerationContext,
    reason: GenerationCompletionReason | null | undefined,
  ): void {
    ctx.completionReason = reason ?? null;
  }

  getCurrentPhase(ctx: GenerationContext): string | null {
    const latestPhase = ctx.phaseTimeline?.[ctx.phaseTimeline.length - 1];
    return latestPhase?.phase ?? null;
  }

  markPhase(ctx: GenerationContext, phase: string): void {
    const now = Date.now();
    const startedAtMs = ctx.startedAt.getTime();
    if (!ctx.phaseMarks) {
      ctx.phaseMarks = {};
    }
    if (!ctx.phaseTimeline) {
      ctx.phaseTimeline = [];
    }
    if (ctx.phaseMarks[phase] === undefined) {
      ctx.phaseMarks[phase] = now;
    }
    ctx.phaseTimeline.push({
      phase,
      atMs: now,
      elapsedMs: Math.max(0, now - startedAtMs),
    });
  }

  updateDebugInfo(ctx: GenerationContext, patch: Partial<GenerationDebugInfo>): void {
    const existing = ctx.debugInfo ?? {};
    const remoteRunPatch = patch.remoteRun;

    ctx.debugInfo = {
      ...existing,
      ...patch,
      remoteRun:
        remoteRunPatch === undefined
          ? existing.remoteRun
          : {
              ...(existing.remoteRun ?? {}),
              ...remoteRunPatch,
              phases: {
                ...(existing.remoteRun?.phases ?? {}),
                ...(remoteRunPatch?.phases ?? {}),
              },
            },
    };
  }

  ensureRemoteRunDebugInfo(ctx: GenerationContext): void {
    if (!ctx.remoteIntegrationSource) {
      return;
    }

    this.updateDebugInfo(ctx, {
      remoteRun: {
        targetEnv: ctx.remoteIntegrationSource.targetEnv,
        remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
        remoteUserEmail: ctx.remoteIntegrationSource.remoteUserEmail ?? null,
        allowedIntegrations: ctx.allowedIntegrations ? [...ctx.allowedIntegrations] : undefined,
      },
    });
  }

  recordRemoteRunPhase(
    ctx: GenerationContext,
    phase: RemoteRunDebugPhase,
    extra?: Partial<NonNullable<GenerationDebugInfo["remoteRun"]>>,
  ): void {
    if (!ctx.remoteIntegrationSource) {
      return;
    }

    this.ensureRemoteRunDebugInfo(ctx);
    this.updateDebugInfo(ctx, {
      remoteRun: {
        ...extra,
        phases: {
          [phase]: new Date().toISOString(),
        },
      },
    });
    this.deps.scheduleSave(ctx);

    logger.info({
      event: "REMOTE_RUN_PHASE",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
      ...{
        phase,
        targetEnv: ctx.remoteIntegrationSource.targetEnv,
        remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
        allowedIntegrations: ctx.allowedIntegrations ?? null,
        attachedTokenEnvVarNames: extra?.attachedTokenEnvVarNames ?? null,
        sessionErrorMessage: extra?.sessionErrorMessage ?? null,
      },
    });
  }

  captureOriginalError(
    ctx: GenerationContext,
    error: unknown,
    options?: {
      phase?: string | null;
      runtimeFailure?: RuntimeFailureClassification | null;
    },
  ): void {
    const phase = options?.phase ?? this.getCurrentPhase(ctx);
    const formatted = this.deps.formatErrorMessage(error);
    const capturedAt = new Date().toISOString();

    if (!ctx.debugInfo?.originalErrorMessage) {
      this.updateDebugInfo(ctx, {
        originalErrorMessage: formatted,
        originalErrorName: error instanceof Error ? error.name : null,
        originalErrorPhase: phase,
        originalErrorAt: capturedAt,
      });
    }
    if (options?.runtimeFailure !== undefined) {
      this.updateDebugInfo(ctx, {
        runtimeFailure: options.runtimeFailure,
      });
    }
    this.deps.scheduleSave(ctx);

    logger.error({
      event: "GENERATION_CAUGHT_ERROR",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
      ...{
        phase,
        originalErrorAt: capturedAt,
        runtimeFailure: options?.runtimeFailure ?? null,
        originalErrorMessage: formatted,
        originalErrorName: error instanceof Error ? error.name : null,
      },
    });
  }

  getRemainingRunTimeMs(ctx: Pick<GenerationContext, "deadlineAt">): number {
    return Math.max(0, ctx.deadlineAt.getTime() - Date.now());
  }

  refreshRemainingRunBudget(ctx: GenerationContext, now = new Date()): number {
    const remainingRunMs = Math.max(0, ctx.deadlineAt.getTime() - now.getTime());
    ctx.remainingRunMs = remainingRunMs;
    return remainingRunMs;
  }

  resumeDeadlineFromRemainingBudget(ctx: GenerationContext, now = new Date()): Date {
    const remainingRunMs =
      ctx.remainingRunMs && ctx.remainingRunMs > 0
        ? ctx.remainingRunMs
        : generationLifecyclePolicy.runDeadlineMs;
    ctx.deadlineAt = new Date(now.getTime() + remainingRunMs);
    return ctx.deadlineAt;
  }

  getApprovalHotWaitMs(ctx: Pick<GenerationContext, "approvalHotWaitMs">): number {
    return Math.max(1_000, ctx.approvalHotWaitMs);
  }

  async resolveSandboxRuntimeEnvForContext(
    ctx: GenerationContext,
  ): Promise<Record<string, string | null | undefined>> {
    const resolution = await resolveRuntimeEnvironmentForTurn({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      allowedIntegrations: ctx.allowedIntegrations,
      remoteIntegrationSource: ctx.remoteIntegrationSource,
    });
    return resolution.sandboxRuntimeEnv;
  }

  async bindRuntimeSandboxToContext(
    ctx: GenerationContext,
    params: {
      runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"];
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
      executionEnvironment?: ExecutionEnvironment;
    },
  ): Promise<void> {
    ctx.sandboxId = params.runtimeSandbox.sandboxId;
    ctx.executionEnvironment = params.executionEnvironment;
    ctx.runtimeHarness = params.runtimeMetadata?.runtimeHarness ?? null;
    ctx.runtimeProtocolVersion = params.runtimeMetadata?.runtimeProtocolVersion ?? null;

    await this.deps.lifecycleStore.bindRuntimeSandbox({
      generationId: ctx.id,
      runtimeId: ctx.runtimeId,
      sandboxId: params.runtimeSandbox.sandboxId,
      sessionId: ctx.sessionId ?? null,
      runtimeMetadata: params.runtimeMetadata,
    });

    ctx.sandbox = createSandboxBackend(params.runtimeSandbox);
  }

  async bindRuntimeSessionToContext(
    ctx: GenerationContext,
    params: {
      runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"];
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
      executionEnvironment?: ExecutionEnvironment;
      sessionId: string;
    },
  ): Promise<void> {
    ctx.sessionId = params.sessionId;
    await this.bindRuntimeSandboxToContext(ctx, params);
  }

  async persistRuntimeSessionBinding(
    ctx: GenerationContext,
    params: {
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
      sessionId: string;
    },
  ): Promise<void> {
    ctx.sessionId = params.sessionId;

    if (!ctx.runtimeId) {
      return;
    }

    await this.deps.lifecycleStore.bindRuntimeSession({
      runtimeId: ctx.runtimeId,
      sandboxId: ctx.sandboxId ?? null,
      sessionId: params.sessionId,
      runtimeMetadata: params.runtimeMetadata,
    });
  }
}
