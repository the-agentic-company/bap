import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectMock,
  updateMock,
  getDaytonaRunawayCleanupQueueMock,
  recordedUpdates,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const recordedUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const selectMock = vi.fn();
  const updateMock = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        recordedUpdates.push({ table, values });
        return [];
      }),
    }),
  }));
  const queueMock = {
    upsertJobScheduler: vi.fn(async () => undefined),
    removeJobScheduler: vi.fn(async () => true),
  };
  const getDaytonaRunawayCleanupQueueMock = vi.fn(() => queueMock);
  const dbMock = {
    select: selectMock,
    update: updateMock,
  };

  return {
    selectMock,
    updateMock,
    getDaytonaRunawayCleanupQueueMock,
    recordedUpdates,
    queueMock,
    dbMock,
  };
});

const {
  daytonaListMock,
  daytonaGetMock,
  sandboxDeleteMock,
  fallbackDeleteMock,
} = vi.hoisted(() => {
  const sandboxDeleteMock = vi.fn(async () => undefined);
  const fallbackDeleteMock = vi.fn(async () => undefined);
  const daytonaListMock = vi.fn(async () => ({
    items: [
      {
        id: "sbx-stopped-1",
        state: "stopped",
        delete: sandboxDeleteMock,
      },
    ],
  }));
  const daytonaGetMock = vi.fn(async () => ({
    delete: fallbackDeleteMock,
  }));

  return {
    daytonaListMock,
    daytonaGetMock,
    sandboxDeleteMock,
    fallbackDeleteMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    list = daytonaListMock;
    get = daytonaGetMock;
  },
}));

vi.mock("../sandbox/daytona", () => ({
  getDaytonaClientConfig: vi.fn(() => ({ apiKey: "test-key" })),
  listDaytonaSandboxPages: vi.fn(async (daytona: { list: () => Promise<unknown> }) => {
    const result = await daytona.list();
    return Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] }).items ?? []);
  }),
}));

vi.mock("../queues/daytona-runaway-cleanup-client", () => ({
  DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME: "daytona:stopped-sandbox-delete",
  getDaytonaRunawayCleanupQueue: getDaytonaRunawayCleanupQueueMock,
}));

import {
  cleanupStoppedDaytonaSandboxes,
  DAYTONA_STOPPED_SANDBOX_DELETE_SCHEDULER_ID,
  syncStoppedDaytonaSandboxDeleteJob,
} from "./daytona-stopped-sandbox-delete";

describe("daytona-stopped-sandbox-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedUpdates.length = 0;
    queueMock.upsertJobScheduler.mockResolvedValue(undefined);
    queueMock.removeJobScheduler.mockResolvedValue(true);
    getDaytonaRunawayCleanupQueueMock.mockReturnValue(queueMock);
    sandboxDeleteMock.mockResolvedValue(undefined);
    fallbackDeleteMock.mockResolvedValue(undefined);
    daytonaGetMock.mockResolvedValue({
      delete: fallbackDeleteMock,
    });
  });

  it("deletes stopped sandboxes and clears matching DB bindings", async () => {
    daytonaListMock.mockResolvedValue({
      items: [
        {
          id: "sbx-stopped-1",
          state: "stopped",
          delete: sandboxDeleteMock,
        },
        {
          id: "sbx-started-1",
          state: "started",
          delete: sandboxDeleteMock,
        },
      ],
    });

    const summary = await cleanupStoppedDaytonaSandboxes();

    expect(summary).toEqual({
      scanned: 2,
      stopped: 1,
      errored: 0,
      deleted: 1,
      deleteFailed: 0,
      skippedMissingId: 0,
    });
    expect(sandboxDeleteMock).toHaveBeenCalledWith(60);
    expect(recordedUpdates.map((entry) => entry.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "dead",
          sandboxId: null,
          sessionId: null,
          activeGenerationId: null,
        }),
        expect.objectContaining({
          sandboxId: null,
        }),
      ]),
    );
  });

  it("falls back to daytona.get when a stopped sandbox entry has no delete method", async () => {
    daytonaListMock.mockResolvedValue({
      items: [
        {
          id: "sbx-stopped-2",
          state: "stopped",
        },
      ],
    });

    const summary = await cleanupStoppedDaytonaSandboxes();

    expect(summary).toEqual({
      scanned: 1,
      stopped: 1,
      errored: 0,
      deleted: 1,
      deleteFailed: 0,
      skippedMissingId: 0,
    });
    expect(daytonaGetMock).toHaveBeenCalledWith("sbx-stopped-2");
    expect(fallbackDeleteMock).toHaveBeenCalledWith(60);
  });

  it("skips stopped sandboxes without ids", async () => {
    daytonaListMock.mockResolvedValue({
      items: [
        {
          state: "stopped",
          delete: sandboxDeleteMock,
        },
      ],
    });

    const summary = await cleanupStoppedDaytonaSandboxes();

    expect(summary).toEqual({
      scanned: 1,
      stopped: 1,
      errored: 0,
      deleted: 0,
      deleteFailed: 0,
      skippedMissingId: 1,
    });
    expect(sandboxDeleteMock).not.toHaveBeenCalled();
    expect(recordedUpdates).toHaveLength(0);
  });

  it("deletes errored sandboxes left behind by timed-out creates", async () => {
    daytonaListMock.mockResolvedValue({
      items: [
        {
          id: "sbx-error-1",
          state: "error",
          delete: sandboxDeleteMock,
        },
      ],
    });

    const summary = await cleanupStoppedDaytonaSandboxes();

    expect(summary).toEqual({
      scanned: 1,
      stopped: 0,
      errored: 1,
      deleted: 1,
      deleteFailed: 0,
      skippedMissingId: 0,
    });
    expect(sandboxDeleteMock).toHaveBeenCalledWith(60);
  });

  it("removes the repeating BullMQ scheduler for stopped sandbox deletion", async () => {
    await syncStoppedDaytonaSandboxDeleteJob();

    expect(getDaytonaRunawayCleanupQueueMock).toHaveBeenCalledOnce();
    expect(queueMock.removeJobScheduler).toHaveBeenCalledWith(
      DAYTONA_STOPPED_SANDBOX_DELETE_SCHEDULER_ID,
    );
    expect(queueMock.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
