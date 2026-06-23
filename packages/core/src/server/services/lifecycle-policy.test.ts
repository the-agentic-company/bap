import { describe, expect, it } from "vitest";
import {
  canAttemptRecovery,
  classifyRuntimeFailure,
  createGenerationLifecycle,
  generationLifecyclePolicy,
  isApprovalExpired,
  isAuthExpired,
  isRunExpired,
  resolveGenerationDeadlineAt,
} from "./lifecycle-policy";

describe("generationLifecyclePolicy", () => {
  it("keeps lifecycle timers in a sane order", () => {
    expect(generationLifecyclePolicy.bootstrapTimeoutMs).toBeLessThan(
      generationLifecyclePolicy.runDeadlineMs,
    );
    expect(generationLifecyclePolicy.runDeadlineMs).toBeLessThan(
      generationLifecyclePolicy.activeSandboxTimeoutMs,
    );
    expect(generationLifecyclePolicy.approvalTimeoutMs).toBeLessThan(
      generationLifecyclePolicy.runDeadlineMs,
    );
    expect(generationLifecyclePolicy.authTimeoutMs).toBeLessThan(
      generationLifecyclePolicy.runDeadlineMs,
    );
    expect(generationLifecyclePolicy.runtimeProgressStallMs).toBe(3 * 60 * 1000);
    expect(generationLifecyclePolicy.maxRecoveryAttempts).toBe(1);
  });

  it("creates a persisted lifecycle snapshot", () => {
    const now = new Date("2026-03-25T10:00:00.000Z");
    expect(createGenerationLifecycle(now)).toEqual({
      deadlineAt: new Date("2026-03-25T10:15:00.000Z"),
      lastRuntimeProgressAt: now,
      recoveryAttempts: 0,
      completionReason: null,
    });
  });

  it("resolves deadlines from persisted data or startedAt", () => {
    expect(
      resolveGenerationDeadlineAt({
        startedAt: "2026-03-25T10:00:00.000Z",
        deadlineAt: "2026-03-25T10:07:00.000Z",
      }).toISOString(),
    ).toBe("2026-03-25T10:07:00.000Z");

    expect(
      resolveGenerationDeadlineAt({
        startedAt: "2026-03-25T10:00:00.000Z",
      }).toISOString(),
    ).toBe("2026-03-25T10:15:00.000Z");
  });

  it("detects deadline and interrupt expiry", () => {
    const now = new Date("2026-03-25T10:10:00.000Z");

    expect(
      isRunExpired(
        {
          startedAt: "2026-03-25T09:50:00.000Z",
          deadlineAt: "2026-03-25T10:05:00.000Z",
        },
        now,
      ),
    ).toBe(true);

    expect(
      isApprovalExpired(
        {
          requestedAt: "2026-03-25T10:00:00.000Z",
          expiresAt: "2026-03-25T10:04:59.000Z",
        },
        now,
      ),
    ).toBe(true);

    expect(
      isAuthExpired(
        {
          requestedAt: "2026-03-25T10:00:00.000Z",
          expiresAt: "2026-03-25T10:09:59.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("caps recovery attempts at one", () => {
    expect(canAttemptRecovery({ recoveryAttempts: 0 })).toBe(true);
    expect(canAttemptRecovery({ recoveryAttempts: 1 })).toBe(false);
  });

  it("classifies runtime failure states", () => {
    expect(
      classifyRuntimeFailure({
        exportState: "terminal_completed",
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("terminal_completed");

    expect(
      classifyRuntimeFailure({
        exportState: "terminal_failed",
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("terminal_failed");

    expect(
      classifyRuntimeFailure({
        exportState: "waiting_approval",
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("waiting_approval");

    expect(
      classifyRuntimeFailure({
        exportState: "waiting_auth",
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("waiting_auth");

    expect(
      classifyRuntimeFailure({
        exportState: "non_terminal",
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("recoverable_live_runtime");

    expect(
      classifyRuntimeFailure({
        exportState: "non_terminal",
        sandboxState: "missing",
        canRecover: true,
      }),
    ).toBe("sandbox_missing");

    expect(
      classifyRuntimeFailure({
        exportState: "broken",
        sandboxState: "live",
        canRecover: false,
      }),
    ).toBe("broken_runtime_state");
  });
});
