import { describe, expect, it } from "vitest";
import {
  SLO_JOURNEYS,
  aggregateSloBuckets,
  buildCumulativeSloSamples,
  type RawSloBucket,
} from "./slo-backfill";

describe("slo-backfill", () => {
  it("does not include the legacy unknown coworker journey", () => {
    expect(SLO_JOURNEYS).toEqual(["global", "chat", "coworker_builder", "coworker_run"]);
  });

  it("uses cancelled terminal journeys and terminal reason semantics in aggregation SQL", async () => {
    let capturedSql = "";
    await aggregateSloBuckets(
      {
        query: async (sql) => {
          capturedSql = sql;
          return { rows: [] };
        },
      },
      {
        from: new Date("2026-05-01T00:00:00.000Z"),
        toExclusive: new Date("2026-05-02T00:00:00.000Z"),
      },
    );

    expect(capturedSql).toContain("g.status in ('completed', 'error', 'cancelled')");
    expect(capturedSql).toContain("cr.status in ('completed', 'error', 'cancelled')");
    expect(capturedSql).toContain("coalesce(g.completion_reason, 'user_cancel')");
    expect(capturedSql).not.toContain("unknown_coworker_generation");
  });

  it("builds concrete and global cumulative samples without unknown coworker series", () => {
    const samples = buildCumulativeSloSamples(
      [
        {
          bucket: new Date("2026-05-01T00:00:00.000Z"),
          journey: "coworker_run",
          result: "bad",
          count: 2,
        } satisfies RawSloBucket,
      ],
      {
        from: new Date("2026-05-01T00:00:00.000Z"),
        toExclusive: new Date("2026-05-01T01:00:00.000Z"),
      },
    );

    expect(samples).toContainEqual(
      expect.objectContaining({ journey: "coworker_run", result: "bad", value: 2 }),
    );
    expect(samples).toContainEqual(
      expect.objectContaining({ journey: "global", result: "bad", value: 2 }),
    );
    expect(samples).not.toContainEqual(
      expect.objectContaining({ journey: "unknown_coworker_generation" }),
    );
  });
});
