import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const coworkerFindFirstMock = vi.fn();
const occurrenceFindFirstMock = vi.fn();
const registrationFindManyMock = vi.fn();
const membershipFindFirstMock = vi.fn();
const runFindFirstMock = vi.fn();
const triggerCoworkerRunMock = vi.fn();
const occurrenceReturningMock = vi.fn();
const insertOnConflictMock = vi.fn(() => ({ returning: occurrenceReturningMock }));
const insertValuesMock = vi.fn(() => ({ onConflictDoNothing: insertOnConflictMock }));
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      coworker: { findFirst: coworkerFindFirstMock },
      coworkerScheduleOccurrence: { findFirst: occurrenceFindFirstMock },
      coworkerAutomationRegistration: { findMany: registrationFindManyMock },
      workspaceMember: { findFirst: membershipFindFirstMock },
      coworkerRun: { findFirst: runFindFirstMock },
    },
    insert: vi.fn(() => ({ values: insertValuesMock })),
    update: vi.fn(() => ({ set: updateSetMock })),
  },
}));

vi.mock("./coworker-service", () => ({
  triggerCoworkerRun: triggerCoworkerRunMock,
}));

let dispatchScheduledCoworkerOccurrence: typeof import("./coworker-schedule-dispatcher").dispatchScheduledCoworkerOccurrence;

describe("dispatchScheduledCoworkerOccurrence", () => {
  beforeAll(async () => {
    ({ dispatchScheduledCoworkerOccurrence } = await import("./coworker-schedule-dispatcher"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindFirstMock.mockResolvedValue({
      id: "coworker-1",
      workspaceId: "workspace-1",
      triggerType: "schedule",
      status: "on",
    });
    occurrenceReturningMock.mockResolvedValue([
      { id: "occurrence-1", coworkerId: "coworker-1", dispatchKey: "tick-1" },
    ]);
    registrationFindManyMock.mockResolvedValue([
      { id: "registration-1", userId: "user-1" },
      { id: "registration-2", userId: "user-2" },
    ]);
    membershipFindFirstMock.mockResolvedValue({ id: "membership-1" });
    runFindFirstMock.mockResolvedValue(null);
    triggerCoworkerRunMock.mockResolvedValue({ id: "run-1" });
    updateWhereMock.mockResolvedValue(undefined);
  });

  it("fans one shared occurrence out once to every active registration", async () => {
    const scheduledFor = new Date("2026-07-31T09:00:00.000Z");

    const result = await dispatchScheduledCoworkerOccurrence({
      coworkerId: "coworker-1",
      dispatchKey: "tick-1",
      scheduledFor,
      scheduleType: "cron",
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledTimes(2);
    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "coworker-1",
        automationRegistrationId: "registration-1",
        scheduleOccurrenceId: "occurrence-1",
      }),
    );
    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ automationRegistrationId: "registration-2" }),
    );
    expect(result).toEqual({
      occurrenceId: "occurrence-1",
      registeredCount: 2,
      dispatchedCount: 2,
      existingCount: 0,
      failedCount: 0,
    });
  });

  it("reuses the durable occurrence and skips existing registration runs on retry", async () => {
    occurrenceReturningMock.mockResolvedValue([]);
    occurrenceFindFirstMock.mockResolvedValue({
      id: "occurrence-1",
      coworkerId: "coworker-1",
      dispatchKey: "tick-1",
    });
    runFindFirstMock.mockResolvedValue({ id: "existing-run" });

    const result = await dispatchScheduledCoworkerOccurrence({
      coworkerId: "coworker-1",
      dispatchKey: "tick-1",
      scheduledFor: new Date("2026-07-31T09:00:00.000Z"),
      scheduleType: "cron",
    });

    expect(triggerCoworkerRunMock).not.toHaveBeenCalled();
    expect(result.existingCount).toBe(2);
    expect(result.dispatchedCount).toBe(0);
  });

  it("isolates a member failure and keeps dispatching sibling registrations", async () => {
    triggerCoworkerRunMock
      .mockRejectedValueOnce(new Error("member credentials unavailable"))
      .mockResolvedValueOnce({ id: "run-2" });
    runFindFirstMock.mockResolvedValue(null);

    const result = await dispatchScheduledCoworkerOccurrence({
      coworkerId: "coworker-1",
      dispatchKey: "tick-1",
      scheduledFor: new Date("2026-07-31T09:00:00.000Z"),
      scheduleType: "cron",
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ dispatchedCount: 1, failedCount: 1 });
  });
});
