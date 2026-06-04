import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectMock,
  updateMock,
  insertMock,
  getDaytonaRunawayCleanupQueueMock,
  recordedUpdates,
  recordedInserts,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const recordedUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const recordedInserts: Array<{ table: unknown; values: unknown }> = [];
  const selectMock = vi.fn();
  const updateMock = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        recordedUpdates.push({ table, values });
        return [];
      }),
    }),
  }));
  const insertMock = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      recordedInserts.push({ table, values });
      return [];
    }),
  }));
  const queueMock = {
    upsertJobScheduler: vi.fn(async () => undefined),
  };
  const getDaytonaRunawayCleanupQueueMock = vi.fn(() => queueMock);
  const dbMock = {
    select: selectMock,
    update: updateMock,
    insert: insertMock,
  };

  return {
    selectMock,
    updateMock,
    insertMock,
    getDaytonaRunawayCleanupQueueMock,
    recordedUpdates,
    recordedInserts,
    queueMock,
    dbMock,
  };
});

const { daytonaGetMock, sandboxStopMock, sandboxRefreshDataMock } = vi.hoisted(() => {
  const sandboxStopMock = vi.fn(async () => undefined);
  const sandboxRefreshDataMock = vi.fn(async () => undefined);
  const daytonaGetMock = vi.fn(async () => ({
    state: "started",
    lastActivityAt: "2026-04-21T18:30:00.000Z",
    refreshData: sandboxRefreshDataMock,
    stop: sandboxStopMock,
  }));

  return {
    daytonaGetMock,
    sandboxStopMock,
    sandboxRefreshDataMock,
  };
});

const { cancelInterruptsForGenerationMock } = vi.hoisted(() => ({
  cancelInterruptsForGenerationMock: vi.fn(async () => undefined),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    get = daytonaGetMock;
  },
}));

vi.mock("../sandbox/daytona", () => ({
  getDaytonaClientConfig: vi.fn(() => ({ apiKey: "test-key" })),
}));

vi.mock("./generation-interrupt-service", () => ({
  generationInterruptService: {
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
  },
}));

vi.mock("../queues/daytona-runaway-cleanup-client", () => ({
  DAYTONA_RUNAWAY_CLEANUP_JOB_NAME: "daytona:runaway-cleanup",
  getDaytonaRunawayCleanupQueue: getDaytonaRunawayCleanupQueueMock,
}));

import {
  cleanupRunawayDaytonaJobs,
  DAYTONA_RUNAWAY_CLEANUP_SCHEDULER_ID,
  syncDaytonaRunawayCleanupJob,
} from "./daytona-runaway-cleanup";

describe("daytona-runaway-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedUpdates.length = 0;
    recordedInserts.length = 0;
    queueMock.upsertJobScheduler.mockResolvedValue(undefined);
    getDaytonaRunawayCleanupQueueMock.mockReturnValue(queueMock);
    sandboxRefreshDataMock.mockResolvedValue(undefined);
    sandboxStopMock.mockResolvedValue(undefined);
    daytonaGetMock.mockResolvedValue({
      state: "started",
      lastActivityAt: "2026-04-21T18:30:00.000Z",
      refreshData: sandboxRefreshDataMock,
      stop: sandboxStopMock,
    });
    cancelInterruptsForGenerationMock.mockResolvedValue(undefined);
  });

  it("stops stale Daytona sandboxes and marks linked records as error", async () => {
    const selectChain = {
      from: vi.fn(() => selectChain),
      innerJoin: vi.fn(() => selectChain),
      leftJoin: vi.fn(() => selectChain),
      where: vi.fn(async () => [
        {
          runtimeId: "rt-1",
          conversationId: "conv-1",
          sandboxId: "sbx-1",
          generationId: "gen-1",
          coworkerRunId: "run-1",
        },
      ]),
    };
    selectMock.mockReturnValue(selectChain);

    const summary = await cleanupRunawayDaytonaJobs(new Date("2026-04-21T19:00:00.000Z"));

    expect(summary).toEqual({
      scanned: 1,
      stale: 1,
      stopped: 1,
      finalizedAsError: 1,
      missingActivity: 0,
      skippedNotStarted: 0,
      lookupFailed: 0,
      stopFailed: 0,
    });
    expect(daytonaGetMock).toHaveBeenCalledWith("sbx-1");
    expect(sandboxRefreshDataMock).toHaveBeenCalledOnce();
    expect(sandboxStopMock).toHaveBeenCalledOnce();
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-1");
    expect(recordedUpdates.map((entry) => entry.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "error",
          errorMessage:
            "Runaway job was stopped by the Daytona cleanup worker after no sandbox activity was recorded for over 25 minutes.",
          completionReason: "runtime_error",
          completedAt: new Date("2026-04-21T19:00:00.000Z"),
        }),
        expect.objectContaining({
          generationStatus: "error",
        }),
        expect.objectContaining({
          status: "error",
          finishedAt: new Date("2026-04-21T19:00:00.000Z"),
          errorMessage:
            "Runaway job was stopped by the Daytona cleanup worker after no sandbox activity was recorded for over 25 minutes.",
        }),
        expect.objectContaining({
          status: "dead",
          sandboxId: null,
          sessionId: null,
          activeGenerationId: null,
        }),
      ]),
    );
    expect(recordedInserts).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({
          coworkerRunId: "run-1",
          type: "error",
          payload: expect.objectContaining({
            stage: "daytona_runaway_cleanup",
            sandboxId: "sbx-1",
            idleMs: 30 * 60 * 1000,
          }),
        }),
      }),
    ]);
  });

  it("skips sandboxes whose last activity is still within the 25 minute window", async () => {
    const selectChain = {
      from: vi.fn(() => selectChain),
      innerJoin: vi.fn(() => selectChain),
      leftJoin: vi.fn(() => selectChain),
      where: vi.fn(async () => [
        {
          runtimeId: "rt-1",
          conversationId: "conv-1",
          sandboxId: "sbx-1",
          generationId: "gen-1",
          coworkerRunId: null,
        },
      ]),
    };
    selectMock.mockReturnValue(selectChain);
    daytonaGetMock.mockResolvedValue({
      state: "started",
      lastActivityAt: "2026-04-21T18:40:00.000Z",
      refreshData: sandboxRefreshDataMock,
      stop: sandboxStopMock,
    });

    const summary = await cleanupRunawayDaytonaJobs(new Date("2026-04-21T19:00:00.000Z"));

    expect(summary).toEqual({
      scanned: 1,
      stale: 0,
      stopped: 0,
      finalizedAsError: 0,
      missingActivity: 0,
      skippedNotStarted: 0,
      lookupFailed: 0,
      stopFailed: 0,
    });
    expect(sandboxStopMock).not.toHaveBeenCalled();
    expect(recordedUpdates).toHaveLength(0);
    expect(recordedInserts).toHaveLength(0);
  });

  it("skips sandboxes without a last activity timestamp", async () => {
    const selectChain = {
      from: vi.fn(() => selectChain),
      innerJoin: vi.fn(() => selectChain),
      leftJoin: vi.fn(() => selectChain),
      where: vi.fn(async () => [
        {
          runtimeId: "rt-1",
          conversationId: "conv-1",
          sandboxId: "sbx-1",
          generationId: "gen-1",
          coworkerRunId: null,
        },
      ]),
    };
    selectMock.mockReturnValue(selectChain);
    daytonaGetMock.mockResolvedValue({
      state: "started",
      lastActivityAt: undefined,
      refreshData: sandboxRefreshDataMock,
      stop: sandboxStopMock,
    });

    const summary = await cleanupRunawayDaytonaJobs(new Date("2026-04-21T19:00:00.000Z"));

    expect(summary).toEqual({
      scanned: 1,
      stale: 0,
      stopped: 0,
      finalizedAsError: 0,
      missingActivity: 1,
      skippedNotStarted: 0,
      lookupFailed: 0,
      stopFailed: 0,
    });
    expect(sandboxStopMock).not.toHaveBeenCalled();
    expect(recordedUpdates).toHaveLength(0);
  });

  it("registers a repeating BullMQ scheduler on the dedicated cleanup queue", async () => {
    await syncDaytonaRunawayCleanupJob();

    expect(getDaytonaRunawayCleanupQueueMock).toHaveBeenCalledOnce();
    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      DAYTONA_RUNAWAY_CLEANUP_SCHEDULER_ID,
      expect.objectContaining({
        pattern: "*/5 * * * *",
        tz: expect.any(String),
      }),
      {
        name: "daytona:runaway-cleanup",
        data: {},
      },
    );
  });
});
