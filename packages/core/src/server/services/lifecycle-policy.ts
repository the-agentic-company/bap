export const generationLifecyclePolicy = {
  bootstrapTimeoutMs: 90_000,
  runtimeProgressStallMs: 3 * 60 * 1000,
  runDeadlineMs: 15 * 60 * 1000,
  activeSandboxTimeoutMs: 20 * 60 * 1000,
  approvalHotWaitMs: 60_000,
  approvalTimeoutMs: 5 * 60 * 1000,
  authTimeoutMs: 10 * 60 * 1000,
  idleReusableSandboxTtlMs: 5 * 60 * 1000,
  explicitPauseRetentionMs: 24 * 60 * 60 * 1000,
  recoveryObserveWindowMs: 10_000,
  maxRecoveryAttempts: 1,
} as const;

export type GenerationCompletionReason =
  | "completed"
  | "user_cancel"
  | "run_deadline"
  | "bootstrap_timeout"
  | "approval_timeout"
  | "auth_timeout"
  | "runtime_no_progress_after_prompt"
  | "runtime_progress_stalled"
  | "infra_disconnect"
  | "sandbox_missing"
  | "broken_runtime_state"
  | "runtime_error"
  | "runner_declared_failure";

export type RuntimeProgressKind =
  | "text_delta"
  | "reasoning_delta"
  | "tool_use"
  | "tool_result"
  | "permission"
  | "question"
  | "session_idle"
  | "session_error"
  | "prompt_completed";

type DateLike = Date | string | number | null | undefined;

export type RuntimeExportState =
  | "terminal_completed"
  | "terminal_failed"
  | "waiting_approval"
  | "waiting_auth"
  | "non_terminal"
  | "broken";

export type RuntimeFailureClassification =
  | "terminal_completed"
  | "terminal_failed"
  | "waiting_approval"
  | "waiting_auth"
  | "recoverable_live_runtime"
  | "sandbox_missing"
  | "broken_runtime_state";

export function createGenerationLifecycle(now = new Date()): {
  deadlineAt: Date;
  lastRuntimeProgressAt: Date;
  recoveryAttempts: number;
  completionReason: null;
} {
  return {
    deadlineAt: new Date(now.getTime() + generationLifecyclePolicy.runDeadlineMs),
    lastRuntimeProgressAt: now,
    recoveryAttempts: 0,
    completionReason: null,
  };
}

function toDate(value: DateLike): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export function resolveGenerationDeadlineAt(input: {
  startedAt: DateLike;
  deadlineAt?: DateLike;
}): Date {
  const explicitDeadline = toDate(input.deadlineAt);
  if (explicitDeadline) {
    return explicitDeadline;
  }
  const startedAt = toDate(input.startedAt) ?? new Date();
  return new Date(startedAt.getTime() + generationLifecyclePolicy.runDeadlineMs);
}

export function isRunExpired(
  input: {
    startedAt: DateLike;
    deadlineAt?: DateLike;
  },
  now = new Date(),
): boolean {
  return resolveGenerationDeadlineAt(input).getTime() <= now.getTime();
}

export function isApprovalExpired(
  interrupt: {
    requestedAt?: DateLike;
    expiresAt?: DateLike;
  },
  now = new Date(),
): boolean {
  const expiresAt = toDate(interrupt.expiresAt);
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime();
}

export function isAuthExpired(
  interrupt: {
    requestedAt?: DateLike;
    expiresAt?: DateLike;
  },
  now = new Date(),
): boolean {
  const expiresAt = toDate(interrupt.expiresAt);
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime();
}

export function canAttemptRecovery(
  input: {
    recoveryAttempts?: number | null;
  },
  maxRecoveryAttempts = generationLifecyclePolicy.maxRecoveryAttempts,
): boolean {
  return (input.recoveryAttempts ?? 0) < maxRecoveryAttempts;
}

export function classifyRuntimeFailure(input: {
  exportState: RuntimeExportState;
  sandboxState: "live" | "missing" | "paused" | "dead" | "unknown";
  canRecover: boolean;
}): RuntimeFailureClassification {
  if (input.exportState === "terminal_completed") {
    return "terminal_completed";
  }
  if (input.exportState === "terminal_failed") {
    return "terminal_failed";
  }
  if (input.exportState === "waiting_approval") {
    return "waiting_approval";
  }
  if (input.exportState === "waiting_auth") {
    return "waiting_auth";
  }
  if (input.sandboxState === "missing" || input.sandboxState === "paused" || input.sandboxState === "dead") {
    return "sandbox_missing";
  }
  if (input.exportState === "broken") {
    return "broken_runtime_state";
  }
  if (input.canRecover && input.sandboxState === "live") {
    return "recoverable_live_runtime";
  }
  return "broken_runtime_state";
}
