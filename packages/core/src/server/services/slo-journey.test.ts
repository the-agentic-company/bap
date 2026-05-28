import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  coworkerFindFirstMock,
  coworkerRunFindFirstMock,
  coworkerRunUpdateReturningMock,
  coworkerRunUpdateWhereMock,
  coworkerRunUpdateSetMock,
  dbUpdateMock,
  logServerEventMock,
  recordCounterMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  coworkerRunFindFirstMock: vi.fn(),
  coworkerRunUpdateReturningMock: vi.fn(),
  coworkerRunUpdateWhereMock: vi.fn(),
  coworkerRunUpdateSetMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  logServerEventMock: vi.fn(),
  recordCounterMock: vi.fn(),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    update: dbUpdateMock,
    query: {
      coworker: { findFirst: coworkerFindFirstMock },
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
    },
  },
}));

vi.mock("../utils/observability", () => ({
  logServerEvent: logServerEventMock,
  recordCounter: recordCounterMock,
}));

import {
  classifySloTerminalEvent,
  emitCoworkerRunSloTerminalEvent,
  emitGenerationSloTerminalEvent,
  emitPreGenerationCoworkerRunFailureSloEvent,
  recordSloMetricSamples,
} from "./slo-journey";

describe("SLO Journey classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdateMock.mockReturnValue({ set: coworkerRunUpdateSetMock });
    coworkerRunUpdateSetMock.mockReturnValue({ where: coworkerRunUpdateWhereMock });
    coworkerRunUpdateWhereMock.mockReturnValue({ returning: coworkerRunUpdateReturningMock });
    coworkerRunUpdateReturningMock.mockResolvedValue([{ id: "run-1" }]);
    coworkerFindFirstMock.mockResolvedValue(null);
    coworkerRunFindFirstMock.mockResolvedValue(null);
  });

  it("classifies completed journeys as good and emits a global rollup", () => {
    expect(
      classifySloTerminalEvent({
        journey: "chat",
        status: "completed",
        completionReason: "completed",
        traffic: "real",
      }),
    ).toEqual([
      { journey: "chat", result: "good", traffic: "real" },
      { journey: "global", result: "good", traffic: "real" },
    ]);
  });

  it("classifies user-intended cancellations as good and platform cancellations as bad", () => {
    expect(
      classifySloTerminalEvent({
        journey: "chat",
        status: "cancelled",
        completionReason: "user_cancel",
      }),
    ).toEqual([
      { journey: "chat", result: "good", traffic: "real" },
      { journey: "global", result: "good", traffic: "real" },
    ]);

    expect(
      classifySloTerminalEvent({
        journey: "chat",
        status: "cancelled",
        completionReason: "auth_timeout",
      }),
    ).toEqual([
      { journey: "chat", result: "bad", traffic: "real" },
      { journey: "global", result: "bad", traffic: "real" },
    ]);
  });

  it("records only journey, result, and traffic labels on the SLO counter", () => {
    recordSloMetricSamples([
      { journey: "coworker_run", result: "bad", traffic: "synthetic" },
      { journey: "global", result: "bad", traffic: "synthetic" },
    ]);

    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "coworker_run", result: "bad", traffic: "synthetic" },
      expect.any(String),
    );
    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "global", result: "bad", traffic: "synthetic" },
      expect.any(String),
    );
  });

  it("uses the Coworker Run guard for exact-once coworker run SLO emission", async () => {
    await expect(
      emitCoworkerRunSloTerminalEvent({
        coworkerRunId: "run-1",
        status: "error",
        completionReason: "runtime_error",
        syntheticKind: "slo_replay",
      }),
    ).resolves.toBe(true);

    expect(recordCounterMock).toHaveBeenCalledTimes(2);
    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "coworker_run", result: "bad", traffic: "synthetic" },
      expect.any(String),
    );

    coworkerRunUpdateReturningMock.mockResolvedValueOnce([]);
    recordCounterMock.mockClear();

    await expect(
      emitCoworkerRunSloTerminalEvent({
        coworkerRunId: "run-1",
        status: "error",
      }),
    ).resolves.toBe(false);
    expect(recordCounterMock).not.toHaveBeenCalled();
  });

  it("routes Generation-backed Coworker Runs through the coworker run guard", async () => {
    coworkerRunFindFirstMock.mockResolvedValueOnce({
      id: "run-1",
      syntheticKind: "slo_replay",
    });

    await emitGenerationSloTerminalEvent({
      generationId: "gen-1",
      conversationId: "conv-1",
      conversationType: "coworker",
      status: "completed",
      completionReason: "completed",
    });

    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "coworker_run", result: "good", traffic: "synthetic" },
      expect.any(String),
    );
  });

  it("classifies coworker builder Generations and skips unclassified coworker Generations", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "coworker-1" });

    await emitGenerationSloTerminalEvent({
      generationId: "gen-1",
      conversationId: "conv-builder",
      conversationType: "coworker",
      status: "completed",
    });

    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "coworker_builder", result: "good", traffic: "real" },
      expect.any(String),
    );

    recordCounterMock.mockClear();
    coworkerFindFirstMock.mockResolvedValueOnce(null);

    await emitGenerationSloTerminalEvent({
      generationId: "gen-2",
      conversationId: "conv-unknown",
      conversationType: "coworker",
      status: "error",
    });

    expect(recordCounterMock).not.toHaveBeenCalled();
    expect(logServerEventMock).toHaveBeenCalledWith(
      "warn",
      "SLO_JOURNEY_UNCLASSIFIED_COWORKER_GENERATION",
      expect.objectContaining({ generationId: "gen-2" }),
      { source: "slo-journey" },
    );
  });

  it("emits a diagnostic event and bad SLO samples for pre-Generation Coworker Run failures", async () => {
    await expect(
      emitPreGenerationCoworkerRunFailureSloEvent({
        coworkerRunId: "run-1",
        coworkerId: "coworker-1",
        ownerId: "user-1",
        workspaceId: "workspace-1",
        normalizedErrorCode: "start_generation_failed",
      }),
    ).resolves.toBe(true);

    expect(logServerEventMock).toHaveBeenCalledWith(
      "error",
      "COWORKER_RUN_PRE_GENERATION_FAILURE",
      expect.objectContaining({
        coworkerRunId: "run-1",
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        terminalReason: "start_generation_failed",
        normalizedErrorCode: "start_generation_failed",
      }),
      expect.objectContaining({ source: "coworker-service", userId: "user-1" }),
    );
    expect(recordCounterMock).toHaveBeenCalledWith(
      "cmdclaw_slo_events_total",
      1,
      { journey: "coworker_run", result: "bad", traffic: "real" },
      expect.any(String),
    );
  });
});
