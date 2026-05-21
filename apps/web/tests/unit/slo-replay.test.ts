import { describe, expect, test } from "vitest";
import {
  computeReplayDedupeKey,
  computeReplayConfigHash,
  normalizeReplayMessage,
  selectReplayCandidates,
  type SourceReplayEvent,
} from "../../scripts/slo-replay";

function event(overrides: Partial<SourceReplayEvent>): SourceReplayEvent {
  return {
    eventAt: new Date("2026-05-19T10:00:00.000Z"),
    journey: "chat",
    result: "bad",
    sourceGenerationId: "gen-1",
    sourceCoworkerRunId: null,
    sourceUserId: "remote-user-1",
    targetUserEmail: "baptiste@heybap.com",
    firstUserMessage: " Check my inbox ",
    coworkerId: null,
    model: "openai/gpt-5.4",
    authSource: "user",
    ...overrides,
  };
}

describe("slo replay candidate selection", () => {
  test("normalizes first user messages for chat-like replay keys", () => {
    expect(normalizeReplayMessage("  Check\n\nmy   inbox  ")).toBe("Check my inbox");
    expect(computeReplayDedupeKey(event({ firstUserMessage: "Check my inbox" }))).toBe(
      computeReplayDedupeKey(event({ firstUserMessage: "  Check   my inbox " })),
    );
  });

  test("dedupes coworker runs by coworker id only", () => {
    const first = computeReplayDedupeKey(
      event({
        journey: "coworker_run",
        coworkerId: "coworker-1",
        firstUserMessage: "payload A",
        sourceCoworkerRunId: "run-1",
      }),
    );
    const second = computeReplayDedupeKey(
      event({
        journey: "coworker_run",
        coworkerId: "coworker-1",
        firstUserMessage: "payload B",
        sourceCoworkerRunId: "run-2",
      }),
    );

    expect(first).toBe(second);
  });

  test("skips a group when the latest real event completed", () => {
    const selection = selectReplayCandidates(
      [
        event({
          eventAt: new Date("2026-05-19T11:00:00.000Z"),
          result: "good",
          sourceGenerationId: "gen-new",
        }),
        event({
          eventAt: new Date("2026-05-19T10:00:00.000Z"),
          result: "bad",
          sourceGenerationId: "gen-old",
        }),
      ],
      {
        targetEnv: "prod",
        limit: 10,
        existingCompletedReplays: new Set(),
      },
    );

    expect(selection.candidates).toEqual([]);
    expect(selection.skippedLatestCompleted).toBe(1);
  });

  test("selects only one latest failed representative per dedupe key", () => {
    const selection = selectReplayCandidates(
      [
        event({
          journey: "coworker_run",
          eventAt: new Date("2026-05-19T11:00:00.000Z"),
          sourceCoworkerRunId: "run-new",
          coworkerId: "coworker-1",
        }),
        event({
          journey: "coworker_run",
          eventAt: new Date("2026-05-19T10:00:00.000Z"),
          sourceCoworkerRunId: "run-old",
          coworkerId: "coworker-1",
        }),
      ],
      {
        targetEnv: "prod",
        limit: 10,
        existingCompletedReplays: new Set(),
      },
    );

    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]?.sourceCoworkerRunIds).toEqual(["run-new", "run-old"]);
  });

  test("skips candidates with a completed replay for the same config", () => {
    const source = event({});
    const dedupeKey = computeReplayDedupeKey(source);
    expect(dedupeKey).not.toBeNull();
    const configHash = computeReplayConfigHash({
      targetEnv: "prod",
      targetUserEmail: source.targetUserEmail,
      journey: source.journey,
    });

    const selection = selectReplayCandidates([source], {
      targetEnv: "prod",
      limit: 10,
      existingCompletedReplays: new Set([`${dedupeKey}:${configHash}`]),
    });

    expect(selection.candidates).toEqual([]);
    expect(selection.skippedAlreadyReplayed).toBe(1);
  });
});
