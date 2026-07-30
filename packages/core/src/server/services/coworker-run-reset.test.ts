import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const coworkerRunFindManyMock = vi.fn();
const cancelInterruptsForGenerationMock = vi.fn();
const reconcileStaleCoworkerRunsForCoworkerMock = vi.fn();
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock, returning: vi.fn() }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));

vi.mock("@bap/db/client", () => ({
  db: {
    query: { coworkerRun: { findMany: coworkerRunFindManyMock } },
    insert: vi.fn(() => ({ values: insertValuesMock })),
    update: updateMock,
  },
}));

vi.mock("./generation-interrupt-service", () => ({
  generationInterruptService: {
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
  },
}));

vi.mock("./coworker-service", () => ({
  reconcileStaleCoworkerRunsForCoworker: reconcileStaleCoworkerRunsForCoworkerMock,
}));

let resetCoworkerRunsAndEnable: typeof import("./coworker-run-reset").resetCoworkerRunsAndEnable;

describe("resetCoworkerRunsAndEnable", () => {
  beforeAll(async () => {
    ({ resetCoworkerRunsAndEnable } = await import("./coworker-run-reset"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    updateSetMock.mockImplementation((values: unknown) => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(
          (values as { updatedAt?: Date }).updatedAt ? [{ id: "wf-1" }] : [],
        ),
      })),
    }));
    insertValuesMock.mockResolvedValue(undefined);
    reconcileStaleCoworkerRunsForCoworkerMock.mockResolvedValue(undefined);
    cancelInterruptsForGenerationMock.mockResolvedValue(undefined);
  });

  it("resets all non-terminal coworker runs and enables the coworker", async () => {
    coworkerRunFindManyMock.mockResolvedValue([
      { id: "run-needs-input", status: "needs_user_input", generationId: null, generation: null },
      {
        id: "run-running",
        status: "running",
        generationId: "gen-running",
        generation: { id: "gen-running", status: "running", completedAt: null },
      },
      {
        id: "run-paused",
        status: "paused",
        generationId: "gen-paused",
        generation: { id: "gen-paused", status: "paused", completedAt: null },
      },
    ]);

    const result = await resetCoworkerRunsAndEnable({
      coworkerId: "wf-1",
      resetByUserId: "user-reset",
      workspaceId: "ws-1",
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      totalAffectedRuns: 3,
      cancelledRunCount: 1,
      cancellingRunCount: 2,
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        finishedAt: expect.any(Date),
        errorMessage: "Cancelled by coworker run reset.",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelling",
        errorMessage: "Cancellation requested by coworker run reset.",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ cancelRequestedAt: expect.any(Date) }),
    );
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-running");
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-paused");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "on", disabledReason: null, disabledAt: null }),
    );
    const statuses = updateSetMock.mock.calls.map(
      ([value]) => (value as { status?: string }).status,
    );
    expect(statuses.indexOf("on")).toBeGreaterThan(statuses.indexOf("cancelling"));
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerRunId: "run-needs-input",
        type: "reset_requested",
        payload: expect.objectContaining({
          resetByUserId: "user-reset",
          previousStatus: "needs_user_input",
          nextStatus: "cancelled",
        }),
      }),
    );
  });
});
