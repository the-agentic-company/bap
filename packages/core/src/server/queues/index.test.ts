import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isCoworkerRunBacklogAutoDisableErrorMock,
  isDisabledCoworkerTriggerErrorMock,
  dispatchScheduledCoworkerOccurrenceMock,
  triggerCoworkerRunMock,
} = vi.hoisted(() => ({
  isCoworkerRunBacklogAutoDisableErrorMock: vi.fn(() => false),
  isDisabledCoworkerTriggerErrorMock: vi.fn(() => false),
  dispatchScheduledCoworkerOccurrenceMock: vi.fn(),
  triggerCoworkerRunMock: vi.fn(),
}));

vi.mock("../services/coworker-schedule-dispatcher", () => ({
  dispatchScheduledCoworkerOccurrence: dispatchScheduledCoworkerOccurrenceMock,
}));

vi.mock("../services/coworker-service", () => ({
  isCoworkerRunBacklogAutoDisableError: isCoworkerRunBacklogAutoDisableErrorMock,
  isDisabledCoworkerTriggerError: isDisabledCoworkerTriggerErrorMock,
  triggerCoworkerRun: triggerCoworkerRunMock,
}));

import { handleScheduledCoworkerJob } from "./index";

describe("handleScheduledCoworkerJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips active-run conflicts for scheduled coworkers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatchScheduledCoworkerOccurrenceMock.mockRejectedValueOnce({
      code: "BAD_REQUEST",
      status: 400,
      message: "Coworker already has an active run",
    });

    await expect(
      handleScheduledCoworkerJob({
        id: "repeat:coworker:wf-1:1",
        data: { coworkerId: "wf-1", scheduleType: "interval" },
      } as Parameters<typeof handleScheduledCoworkerJob>[0]),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[worker] skipped scheduled coworker trigger for coworker wf-1: Coworker already has an active run",
    );
  });

  it("still throws unexpected scheduled coworker errors", async () => {
    const error = new Error("database unavailable");
    dispatchScheduledCoworkerOccurrenceMock.mockRejectedValueOnce(error);

    await expect(
      handleScheduledCoworkerJob({
        id: "repeat:coworker:wf-1:1",
        data: { coworkerId: "wf-1", scheduleType: "interval" },
      } as Parameters<typeof handleScheduledCoworkerJob>[0]),
    ).rejects.toThrow(error);
  });

  it("dispatches one durable occurrence using the repeat job id", async () => {
    dispatchScheduledCoworkerOccurrenceMock.mockResolvedValueOnce({
      occurrenceId: "occurrence-1",
    });
    const timestamp = Date.parse("2026-07-31T09:00:00Z");

    await handleScheduledCoworkerJob({
      id: "repeat:coworker:wf-1:1785488400000",
      timestamp,
      data: { coworkerId: "wf-1", scheduleType: "daily" },
    } as Parameters<typeof handleScheduledCoworkerJob>[0]);

    expect(dispatchScheduledCoworkerOccurrenceMock).toHaveBeenCalledWith({
      coworkerId: "wf-1",
      dispatchKey: "repeat:coworker:wf-1:1785488400000",
      scheduleType: "daily",
      scheduledFor: new Date(timestamp),
    });
  });
});
