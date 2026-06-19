import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock, insertedRows, dbMock } = vi.hoisted(() => {
  const insertedRows: unknown[] = [];
  const insertMock = vi.fn(() => ({
    values: vi.fn(async (values: unknown) => {
      insertedRows.push(values);
      return [];
    }),
  }));
  const dbMock = {
    insert: insertMock,
  };

  return {
    insertMock,
    insertedRows,
    dbMock,
  };
});

const {
  isDaytonaConfiguredMock,
  listAllDaytonaSandboxesMock,
  isE2BConfiguredMock,
  listAllE2BSandboxesMock,
  getSandboxUsageSnapshotQueueMock,
  queueMock,
} = vi.hoisted(() => {
  const isDaytonaConfiguredMock = vi.fn(() => true);
  const listAllDaytonaSandboxesMock = vi.fn(async () => [
    {
      sandboxId: "daytona-1",
      state: "running",
      startedAt: new Date("2026-04-21T18:00:00.000Z"),
      lastActivityAt: new Date("2026-04-21T18:20:00.000Z"),
      metadata: { "bap-conversation-id": "conv-1" },
    },
  ]);
  const isE2BConfiguredMock = vi.fn(() => false);
  const listAllE2BSandboxesMock = vi.fn(async () => []);
  const queueMock = {
    upsertJobScheduler: vi.fn(async () => undefined),
  };
  const getSandboxUsageSnapshotQueueMock = vi.fn(() => queueMock);

  return {
    isDaytonaConfiguredMock,
    listAllDaytonaSandboxesMock,
    isE2BConfiguredMock,
    listAllE2BSandboxesMock,
    getSandboxUsageSnapshotQueueMock,
    queueMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../sandbox/daytona", () => ({
  isDaytonaConfigured: isDaytonaConfiguredMock,
  listAllDaytonaSandboxes: listAllDaytonaSandboxesMock,
}));

vi.mock("../sandbox/e2b", () => ({
  isE2BConfigured: isE2BConfiguredMock,
  listAllE2BSandboxes: listAllE2BSandboxesMock,
}));

vi.mock("../queues/sandbox-usage-snapshot-client", () => ({
  SANDBOX_USAGE_SNAPSHOT_JOB_NAME: "sandbox:usage-snapshot",
  getSandboxUsageSnapshotQueue: getSandboxUsageSnapshotQueueMock,
}));

import {
  collectSandboxUsageSnapshot,
  syncSandboxUsageSnapshotJob,
} from "./sandbox-usage-snapshot";

describe("sandbox-usage-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    isDaytonaConfiguredMock.mockReturnValue(true);
    listAllDaytonaSandboxesMock.mockResolvedValue([
      {
        sandboxId: "daytona-1",
        state: "running",
        startedAt: new Date("2026-04-21T18:00:00.000Z"),
        lastActivityAt: new Date("2026-04-21T18:20:00.000Z"),
        metadata: { "bap-conversation-id": "conv-1" },
      },
    ]);
    isE2BConfiguredMock.mockReturnValue(false);
    listAllE2BSandboxesMock.mockResolvedValue([]);
  });

  it("inserts Daytona sandbox usage rows", async () => {
    const summary = await collectSandboxUsageSnapshot(new Date("2026-04-21T18:30:00.000Z"));

    expect(summary).toEqual({
      inserted: 1,
      e2b: 0,
      daytona: 1,
      failed: 0,
      providerFailures: [],
    });
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertedRows[0]).toEqual([
      expect.objectContaining({
        provider: "daytona",
        sandboxId: "daytona-1",
        state: "running",
        runtimeSeconds: 30 * 60,
        metadata: expect.objectContaining({
          "bap-conversation-id": "conv-1",
          lastActivityAt: "2026-04-21T18:20:00.000Z",
        }),
      }),
    ]);
  });

  it("reports configured Daytona listing failures instead of a healthy empty snapshot", async () => {
    listAllDaytonaSandboxesMock.mockRejectedValue(new Error("Daytona list unavailable"));

    const summary = await collectSandboxUsageSnapshot(new Date("2026-04-21T18:30:00.000Z"));

    expect(summary).toEqual({
      inserted: 0,
      e2b: 0,
      daytona: 0,
      failed: 0,
      providerFailures: ["daytona"],
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("registers a repeating BullMQ scheduler for sandbox usage snapshots", async () => {
    await syncSandboxUsageSnapshotJob();

    expect(getSandboxUsageSnapshotQueueMock).toHaveBeenCalledOnce();
    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      "sandbox:usage-snapshot",
      expect.objectContaining({
        pattern: "*/5 * * * *",
        tz: expect.any(String),
      }),
      {
        name: "sandbox:usage-snapshot",
        data: {},
      },
    );
  });
});
