import type { ExecutionEnvironmentSession } from "../../execution/execution-environment";
import type {
  RuntimeHarnessClient,
  RuntimeSelection,
  SandboxHandle,
} from "../../sandbox/core/types";
import type {
  GenerationCompletionReason,
  RuntimeFailureClassification,
} from "../../services/lifecycle-policy";
import type {
  GenerationContext,
  GenerationEvent,
  GenerationStatus,
  RemoteRunDebugPhase,
} from "../../services/generation/types";

export type TerminalGenerationStatus = Extract<
  GenerationStatus,
  "completed" | "cancelled" | "error"
>;

export type NormalRunnerCallbacks = {
  bootstrapTimeoutMs: number;
  opencodeTurnEvents: import("./opencode-turn-events").OpenCodeTurnEventBridge;
  refreshCancellationSignal: (
    ctx: GenerationContext,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  finishGeneration: (ctx: GenerationContext, status: TerminalGenerationStatus) => Promise<void>;
  setCompletionReason: (
    ctx: GenerationContext,
    reason: GenerationCompletionReason | null | undefined,
  ) => void;
  ensureRemoteRunDebugInfo: (ctx: GenerationContext) => void;
  recordRemoteRunPhase: (
    ctx: GenerationContext,
    phase: RemoteRunDebugPhase,
    patch?: Record<string, unknown>,
  ) => void;
  markPhase: (ctx: GenerationContext, phase: string) => void;
  broadcast: (ctx: GenerationContext, event: GenerationEvent) => void;
  bindRuntimeSandboxToContext: (
    ctx: GenerationContext,
    input: {
      runtimeSandbox: SandboxHandle;
      runtimeMetadata?: RuntimeSelection;
      executionEnvironment?: ExecutionEnvironmentSession["environment"];
    },
  ) => Promise<void>;
  bindRuntimeSessionToContext: (
    ctx: GenerationContext,
    input: {
      runtimeSandbox: SandboxHandle;
      runtimeMetadata?: RuntimeSelection;
      executionEnvironment?: ExecutionEnvironmentSession["environment"];
      sessionId: string;
    },
  ) => Promise<void>;
  persistRuntimeSessionBinding: (
    ctx: GenerationContext,
    input: {
      runtimeMetadata?: RuntimeSelection;
      sessionId: string;
    },
  ) => Promise<void>;
  setSnapshotRestoreAllowance: (ctx: GenerationContext, allowed: boolean) => Promise<void>;
  getRemainingRunTimeMs: (ctx: Pick<GenerationContext, "deadlineAt">) => number;
  parkGenerationForRunDeadline: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<void>;
  startExternalInterruptPolling: (ctx: GenerationContext) => void;
  stopExternalInterruptPolling: (ctx: GenerationContext) => void;
  pollExternalInterruptAndSuspendIfNeeded: (ctx: GenerationContext) => Promise<void>;
  awaitPromiseUntilRunDeadline: <T>(
    ctx: Pick<GenerationContext, "deadlineAt">,
    promise: Promise<T>,
  ) => Promise<{ type: "resolved"; value: T } | { type: "timed_out" }>;
  scheduleSave: (ctx: GenerationContext) => void;
  saveProgress: (ctx: GenerationContext) => Promise<void>;
  importIntegrationSkillDraftsFromSandbox: (ctx: GenerationContext) => Promise<void>;
  captureUsageFromRuntimeSession: (
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ) => Promise<void>;
  captureOriginalError: (
    ctx: GenerationContext,
    error: unknown,
    input: { phase?: string; runtimeFailure?: RuntimeFailureClassification },
  ) => void;
  getCurrentPhase: (ctx: GenerationContext) => string | null;
  resolveRuntimeFailure: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<RuntimeFailureClassification>;
  scheduleRecoveryReattach: (ctx: GenerationContext) => void;
  turnFinalizer: {
    collectAndExposeMentionedSandboxFiles: (
      ctx: GenerationContext,
      input: {
        summaryMessage: (input: { discoveredCount: number; exposedCount: number }) => string;
        collectionErrorMessage: string;
        uploadErrorMessage: (filePath: string) => string;
      },
    ) => Promise<number>;
  };
};
