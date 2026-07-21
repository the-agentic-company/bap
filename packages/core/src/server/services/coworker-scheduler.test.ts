import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  findManyMock,
  removeJobSchedulerMock,
  upsertJobSchedulerMock,
  getQueueMock,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const findFirstMock = vi.fn();
  const findManyMock = vi.fn();
  const removeJobSchedulerMock = vi.fn();
  const upsertJobSchedulerMock = vi.fn();
  const queueMock = {
    removeJobScheduler: removeJobSchedulerMock,
    upsertJobScheduler: upsertJobSchedulerMock,
  };
  const getQueueMock = vi.fn(() => queueMock);
  const dbMock = {
    query: {
      coworker: {
        findFirst: findFirstMock,
        findMany: findManyMock,
      },
    },
  };

  return {
    findFirstMock,
    findManyMock,
    removeJobSchedulerMock,
    upsertJobSchedulerMock,
    getQueueMock,
    queueMock,
    dbMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../queues/queue-client", () => ({
  SCHEDULED_COWORKER_JOB_NAME: "coworker:scheduled-trigger",
  getQueue: getQueueMock,
}));

import {
  getCoworkerSchedulerId,
  getLegacyCoworkerSchedulerId,
  isCoworkerSchedulable,
  reconcileCoworkerScheduleJob,
  reconcileScheduledCoworkerJobs,
  removeCoworkerScheduleJob,
  syncCoworkerScheduleJob,
  upsertCoworkerScheduleJob,
} from "./coworker-scheduler";

type CoworkerScheduleRowInput = Parameters<typeof upsertCoworkerScheduleJob>[0];

function createRow(overrides: Partial<CoworkerScheduleRowInput> = {}): CoworkerScheduleRowInput {
  return {
    id: "wf-1",
    triggerType: "schedule",
    status: "on",
    schedule: { type: "interval", intervalMinutes: 10 },
    ...overrides,
  };
}

describe("coworker-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueMock.mockReturnValue(queueMock);
    findManyMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(undefined);
    removeJobSchedulerMock.mockResolvedValue(undefined);
    upsertJobSchedulerMock.mockResolvedValue(undefined);
  });

  it("builds scheduler ids from coworker ids", () => {
    expect(getCoworkerSchedulerId("wf-123")).toBe("coworker:wf-123");
    expect(getLegacyCoworkerSchedulerId("wf-123")).toBe("workflow:wf-123");
  });

  it("detects whether a coworker row is schedulable", () => {
    expect(isCoworkerSchedulable(createRow())).toBe(true);
    expect(isCoworkerSchedulable(createRow({ status: "off" }))).toBe(false);
    expect(isCoworkerSchedulable(createRow({ triggerType: "manual" }))).toBe(false);
    expect(isCoworkerSchedulable(createRow({ schedule: { type: "daily" } }))).toBe(false);
  });

  it("removes scheduler jobs by coworker id", async () => {
    await removeCoworkerScheduleJob("wf-remove");

    expect(getQueueMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).toHaveBeenCalledTimes(2);
    expect(removeJobSchedulerMock).toHaveBeenNthCalledWith(1, "coworker:wf-remove");
    expect(removeJobSchedulerMock).toHaveBeenNthCalledWith(2, "workflow:wf-remove");
  });

  it("upserts interval schedules with millisecond repeat intervals", async () => {
    await upsertCoworkerScheduleJob(
      createRow({
        id: "wf-interval",
        schedule: { type: "interval", intervalMinutes: 15 },
      }),
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "coworker:wf-interval",
      { every: 15 * 60 * 1000 },
      {
        name: "coworker:scheduled-trigger",
        data: {
          source: "schedule",
          coworkerId: "wf-interval",
          scheduleType: "interval",
        },
      },
    );
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-interval");
  });

  it("upserts daily schedules with UTC timezone by default", async () => {
    await upsertCoworkerScheduleJob(
      createRow({
        id: "wf-daily",
        schedule: { type: "daily", time: "09:05" },
      }),
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "coworker:wf-daily",
      { pattern: "5 9 * * *", tz: "UTC" },
      {
        name: "coworker:scheduled-trigger",
        data: {
          source: "schedule",
          coworkerId: "wf-daily",
          scheduleType: "daily",
        },
      },
    );
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-daily");
  });

  it("upserts weekly schedules with sorted unique weekdays", async () => {
    await upsertCoworkerScheduleJob(
      createRow({
        id: "wf-weekly",
        schedule: {
          type: "weekly",
          time: "16:45",
          daysOfWeek: [5, 1, 5, 3],
          timezone: "America/New_York",
        },
      }),
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "coworker:wf-weekly",
      { pattern: "45 16 * * 1,3,5", tz: "America/New_York" },
      {
        name: "coworker:scheduled-trigger",
        data: {
          source: "schedule",
          coworkerId: "wf-weekly",
          scheduleType: "weekly",
        },
      },
    );
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-weekly");
  });

  it("upserts monthly schedules with explicit day-of-month", async () => {
    await upsertCoworkerScheduleJob(
      createRow({
        id: "wf-monthly",
        schedule: {
          type: "monthly",
          time: "08:30",
          dayOfMonth: 21,
          timezone: "Europe/Paris",
        },
      }),
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "coworker:wf-monthly",
      { pattern: "30 8 21 * *", tz: "Europe/Paris" },
      {
        name: "coworker:scheduled-trigger",
        data: {
          source: "schedule",
          coworkerId: "wf-monthly",
          scheduleType: "monthly",
        },
      },
    );
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-monthly");
  });

  it("throws when schedule payload is invalid", async () => {
    await expect(
      upsertCoworkerScheduleJob(
        createRow({
          id: "wf-invalid",
          schedule: { unexpected: true },
        }),
      ),
    ).rejects.toThrow('Coworker "wf-invalid" has invalid schedule payload');

    expect(upsertJobSchedulerMock).not.toHaveBeenCalled();
  });

  it("throws when schedule time is not numeric", async () => {
    await expect(
      upsertCoworkerScheduleJob(
        createRow({
          id: "wf-invalid-time",
          schedule: { type: "daily", time: "ab:30" },
        }),
      ),
    ).rejects.toThrow('Invalid schedule time "ab:30"');
  });

  it("throws when schedule time is outside the valid range", async () => {
    await expect(
      upsertCoworkerScheduleJob(
        createRow({
          id: "wf-invalid-time-range",
          schedule: { type: "daily", time: "24:00" },
        }),
      ),
    ).rejects.toThrow('Invalid schedule time "24:00"');
  });

  it("syncs schedulable rows by upserting jobs", async () => {
    await syncCoworkerScheduleJob(
      createRow({
        id: "wf-sync",
        schedule: { type: "daily", time: "11:00", timezone: "UTC" },
      }),
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-sync");
  });

  it("syncs unschedulable rows by removing jobs", async () => {
    await syncCoworkerScheduleJob(
      createRow({
        id: "wf-sync-off",
        status: "off",
      }),
    );

    expect(removeJobSchedulerMock).toHaveBeenCalledWith("coworker:wf-sync-off");
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-sync-off");
    expect(upsertJobSchedulerMock).not.toHaveBeenCalled();
  });

  it("reconciles again when the coworker changes during queue synchronization", async () => {
    const offRow = createRow({ status: "off" });
    const onRow = createRow({ status: "on" });
    findFirstMock
      .mockResolvedValueOnce(offRow)
      .mockResolvedValueOnce(onRow)
      .mockResolvedValueOnce(onRow)
      .mockResolvedValueOnce(onRow);

    await reconcileCoworkerScheduleJob("wf-1");

    expect(upsertJobSchedulerMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("coworker:wf-1");
  });

  it("reconciles coworkers and tracks sync failures", async () => {
    findManyMock.mockResolvedValue([
      createRow({
        id: "wf-success",
        schedule: { type: "interval", intervalMinutes: 5 },
      }),
      createRow({
        id: "wf-fail",
        schedule: { type: "daily", time: "99:00" },
      }),
    ]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await reconcileScheduledCoworkerJobs();

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      "[coworker-scheduler] failed to reconcile coworker wf-fail",
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
