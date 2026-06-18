import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type {
  GenerationMaintenanceDependencies,
  GenerationTimeoutKind,
} from "./generation-maintenance";

const {
  generationFindFirstMock,
  generationFindManyMock,
  coworkerRunFindFirstMock,
  coworkerRunFindManyMock,
  getPendingInterruptForGenerationMock,
  resolveInterruptMock,
  cancelInterruptsForGenerationMock,
  loggerWarnMock,
  loggerErrorMock,
  dbMock,
} = vi.hoisted(() => {
  const generationFindFirstMock = vi.fn();
  const generationFindManyMock = vi.fn();
  const coworkerRunFindFirstMock = vi.fn();
  const coworkerRunFindManyMock = vi.fn();
  const getPendingInterruptForGenerationMock = vi.fn();
  const resolveInterruptMock = vi.fn();
  const cancelInterruptsForGenerationMock = vi.fn();
  const loggerWarnMock = vi.fn();
  const loggerErrorMock = vi.fn();

  const dbMock = {
    query: {
      generation: {
        findFirst: generationFindFirstMock,
        findMany: generationFindManyMock,
      },
      coworkerRun: {
        findFirst: coworkerRunFindFirstMock,
        findMany: coworkerRunFindManyMock,
      },
    },
  };

  return {
    generationFindFirstMock,
    generationFindManyMock,
    coworkerRunFindFirstMock,
    coworkerRunFindManyMock,
    getPendingInterruptForGenerationMock,
    resolveInterruptMock,
    cancelInterruptsForGenerationMock,
    loggerWarnMock,
    loggerErrorMock,
    dbMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
    resolveInterrupt: resolveInterruptMock,
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
  },
}));

vi.mock("../../../utils/observability", () => ({
  logger: {
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

import { GenerationMaintenance } from "./generation-maintenance";

const originalKumaPushUrl = process.env.KUMA_PUSH_URL;

function createMaintenance(activeGenerationIds: string[] = []) {
  const activeGenerations = new Set(activeGenerationIds);
  const deps: GenerationMaintenanceDependencies = {
    abortAndEvictActiveGeneration: vi.fn(),
    hasActiveGeneration: vi.fn((generationId) => activeGenerations.has(generationId)),
    expireActiveGenerationTimeout: vi.fn().mockResolvedValue(undefined),
    finalizeDetachedGenerationError: vi.fn().mockResolvedValue(undefined),
    finalizeStaleGenerationsAsError: vi.fn().mockResolvedValue(undefined),
    finalizeCancelledGenerations: vi.fn().mockResolvedValue(undefined),
  };

  return {
    maintenance: new GenerationMaintenance(deps),
    deps,
    activeGenerations,
  };
}

function pendingInterrupt(overrides: {
  id: string;
  generationId: string;
  kind: "auth" | "plugin_write" | "runtime_question";
}) {
  return {
    id: overrides.id,
    generationId: overrides.generationId,
    kind: overrides.kind,
    status: "pending",
    requestedAt: new Date("2026-06-14T09:00:00.000Z"),
    expiresAt: new Date("2026-06-14T09:59:00.000Z"),
  };
}

describe("GenerationMaintenance", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.KUMA_PUSH_URL = originalKumaPushUrl;
    generationFindFirstMock.mockResolvedValue(null);
    generationFindManyMock.mockResolvedValue([]);
    coworkerRunFindFirstMock.mockResolvedValue(null);
    coworkerRunFindManyMock.mockResolvedValue([]);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
    resolveInterruptMock.mockResolvedValue(undefined);
    cancelInterruptsForGenerationMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.KUMA_PUSH_URL = originalKumaPushUrl;
  });

  it.each([
    {
      kind: "approval" as GenerationTimeoutKind,
      status: "awaiting_approval",
      interruptKind: "plugin_write" as const,
      message: "Approval request expired before the run could continue.",
      completionReason: "approval_timeout",
    },
    {
      kind: "auth" as GenerationTimeoutKind,
      status: "awaiting_auth",
      interruptKind: "auth" as const,
      message: "Authentication request expired before the run could continue.",
      completionReason: "auth_timeout",
    },
  ])(
    "expires an active $kind timeout job into a terminal error",
    async ({ kind, status, interruptKind, message, completionReason }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
      generationFindFirstMock.mockResolvedValueOnce({
        id: `gen-${kind}`,
        conversationId: `conv-${kind}`,
        runtimeId: "runtime-1",
        status,
        conversation: {
          id: `conv-${kind}`,
          userId: "user-1",
        },
      });
      getPendingInterruptForGenerationMock.mockResolvedValueOnce(
        pendingInterrupt({
          id: `interrupt-${kind}`,
          generationId: `gen-${kind}`,
          kind: interruptKind,
        }),
      );

      const { maintenance, deps } = createMaintenance([`gen-${kind}`]);
      await maintenance.processGenerationTimeout(`gen-${kind}`, kind);

      expect(deps.expireActiveGenerationTimeout).toHaveBeenCalledWith({
        generationId: `gen-${kind}`,
        kind,
        message,
        completionReason,
      });
      expect(resolveInterruptMock).not.toHaveBeenCalled();
      expect(deps.finalizeDetachedGenerationError).not.toHaveBeenCalled();
    },
  );

  it("reports stuck preparing Generations and pushes to Kuma while the Generation is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    process.env.KUMA_PUSH_URL = "https://kuma.example/push/abc";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-stuck",
      status: "running",
      sandboxId: null,
      completedAt: null,
      runtimeId: "runtime-1",
      startedAt: new Date(Date.now() - generationLifecyclePolicy.bootstrapTimeoutMs - 1),
      conversation: {
        id: "conv-stuck",
        userId: "user-1",
        type: "chat",
      },
    });

    const { maintenance, deps } = createMaintenance(["gen-stuck"]);
    await maintenance.processPreparingStuckCheck("gen-stuck");

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "GENERATION_PREPARING_STUCK_DETECTED",
        generationId: "gen-stuck",
        conversationId: "conv-stuck",
        userId: "user-1",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain("status=down");
    expect(calledUrl).toContain("conversation%3Dconv-stuck");
    expect(calledUrl).toContain("user%3Duser-1");
    expect(deps.finalizeDetachedGenerationError).not.toHaveBeenCalled();
  });

  it("finalizes detached preparing Generations as bootstrap timeouts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    process.env.KUMA_PUSH_URL = "https://kuma.example/push/abc";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-stuck",
      status: "running",
      sandboxId: null,
      runtimeId: "runtime-1",
      completedAt: null,
      startedAt: new Date(Date.now() - generationLifecyclePolicy.bootstrapTimeoutMs - 1),
      conversationId: "conv-detached-stuck",
      conversation: {
        id: "conv-detached-stuck",
        userId: "user-1",
        type: "coworker",
      },
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce({ id: "wf-run-1" });

    const { maintenance, deps } = createMaintenance();
    await maintenance.processPreparingStuckCheck("gen-detached-stuck");

    expect(deps.finalizeDetachedGenerationError).toHaveBeenCalledWith({
      generationId: "gen-detached-stuck",
      conversationId: "conv-detached-stuck",
      runtimeId: "runtime-1",
      coworkerRunId: "wf-run-1",
      message: "Agent preparation timed out before the runtime became ready.",
      completionReason: "bootstrap_timeout",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reaps stale running and Waiting Generations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    generationFindManyMock.mockResolvedValueOnce([
      {
        id: "gen-stale-running",
        status: "running",
        startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      },
      {
        id: "gen-stale-approval",
        status: "awaiting_approval",
        startedAt: new Date(Date.now() - 31 * 60 * 1000),
      },
      {
        id: "gen-stale-auth",
        status: "awaiting_auth",
        startedAt: new Date(Date.now() - 61 * 60 * 1000),
      },
      {
        id: "gen-fresh-running",
        status: "running",
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    ]);
    getPendingInterruptForGenerationMock.mockImplementation((generationId: string) => {
      if (generationId === "gen-stale-approval") {
        return Promise.resolve(
          pendingInterrupt({
            id: "interrupt-stale-approval",
            generationId,
            kind: "runtime_question",
          }),
        );
      }
      if (generationId === "gen-stale-auth") {
        return Promise.resolve(
          pendingInterrupt({
            id: "interrupt-stale-auth",
            generationId,
            kind: "auth",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const { maintenance, deps } = createMaintenance([
      "gen-stale-running",
      "gen-stale-approval",
      "gen-stale-auth",
      "gen-fresh-running",
    ]);
    const summary = await maintenance.reapStaleGenerations();

    expect(summary).toEqual({
      scanned: 4,
      stale: 3,
      finalizedRunningAsError: 1,
      finalizedWaitingAsError: 2,
      finalizedCancellationRequestedAsCancelled: 0,
    });
    expect(deps.finalizeStaleGenerationsAsError).toHaveBeenCalledWith({
      completedAt: expect.any(Date),
      running: {
        ids: ["gen-stale-running"],
        message:
          "Generation was marked as stale by the worker reaper after exceeding max running age.",
      },
      approval: {
        ids: ["gen-stale-approval"],
        message: "Approval request expired before the run could continue.",
      },
      auth: {
        ids: ["gen-stale-auth"],
        message: "Authentication request expired before the run could continue.",
      },
    });
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledTimes(3);
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledWith("gen-stale-running");
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledWith("gen-stale-approval");
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledWith("gen-stale-auth");
    expect(deps.abortAndEvictActiveGeneration).not.toHaveBeenCalledWith("gen-fresh-running");
    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-stale-approval",
      status: "expired",
    });
    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-stale-auth",
      status: "expired",
    });
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-stale-running");
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-stale-approval");
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-stale-auth");
  });

  it("finalizes cancellation-requested cancelling coworker runs as cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    coworkerRunFindManyMock.mockResolvedValueOnce([
      {
        id: "run-cancelling",
        generationId: "gen-cancelling",
        generation: {
          id: "gen-cancelling",
          status: "paused",
          cancelRequestedAt: new Date("2026-06-14T09:59:00.000Z"),
          completedAt: null,
        },
      },
      {
        id: "run-cancelling-active",
        generationId: "gen-cancelling-active",
        generation: {
          id: "gen-cancelling-active",
          status: "running",
          cancelRequestedAt: new Date("2026-06-14T09:59:00.000Z"),
          completedAt: null,
        },
      },
      {
        id: "run-not-requested",
        generationId: "gen-not-requested",
        generation: {
          id: "gen-not-requested",
          status: "paused",
          cancelRequestedAt: null,
          completedAt: null,
        },
      },
    ]);

    const { maintenance, deps } = createMaintenance(["gen-cancelling-active"]);
    const summary = await maintenance.reapStaleGenerations();

    expect(summary).toEqual({
      scanned: 0,
      stale: 0,
      finalizedRunningAsError: 0,
      finalizedWaitingAsError: 0,
      finalizedCancellationRequestedAsCancelled: 2,
    });
    expect(deps.finalizeCancelledGenerations).toHaveBeenCalledWith({
      completedAt: expect.any(Date),
      generationIds: ["gen-cancelling", "gen-cancelling-active"],
      message: "Coworker run was cancelled by reset.",
    });
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledWith("gen-cancelling");
    expect(deps.abortAndEvictActiveGeneration).toHaveBeenCalledWith("gen-cancelling-active");
    expect(deps.abortAndEvictActiveGeneration).not.toHaveBeenCalledWith("gen-not-requested");
  });
});
