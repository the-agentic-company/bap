import { describe, expect, test, vi } from "vitest";
import {
  aggregateSloBuckets,
  buildCumulativeSloSamples,
  importSloBucketsToVictoriaMetrics,
  renderPrometheusImportRows,
  resolveSloBackfillWindow,
  type RawSloBucket,
} from "../../scripts/slo-backfill";

function sampleAt(
  samples: ReturnType<typeof buildCumulativeSloSamples>,
  timestamp: string,
  journey: string,
  result: string,
): number | undefined {
  return samples.find(
    (sample) =>
      sample.timestampMs === Date.parse(timestamp) &&
      sample.journey === journey &&
      sample.result === result,
  )?.value;
}

describe("slo backfill", () => {
  test("uses a 30-day window ending at the previous whole hour", () => {
    const window = resolveSloBackfillWindow(new Date("2026-05-17T05:34:20.000Z"));

    expect(window.from.toISOString()).toBe("2026-04-17T05:00:00.000Z");
    expect(window.toExclusive.toISOString()).toBe("2026-05-17T05:00:00.000Z");
  });

  test("builds cumulative samples with global rollups and excludes out-of-window buckets", () => {
    const window = {
      from: new Date("2026-05-17T00:00:00.000Z"),
      toExclusive: new Date("2026-05-17T03:00:00.000Z"),
    };
    const rawBuckets: RawSloBucket[] = [
      {
        bucket: new Date("2026-05-17T00:00:00.000Z"),
        journey: "chat",
        result: "good",
        count: "2",
      },
      {
        bucket: new Date("2026-05-17T01:00:00.000Z"),
        journey: "coworker_builder",
        result: "bad",
        count: 1,
      },
      {
        bucket: new Date("2026-05-17T02:00:00.000Z"),
        journey: "coworker_run",
        result: "good",
        count: 3,
      },
      {
        bucket: new Date("2026-05-17T03:00:00.000Z"),
        journey: "unknown_coworker_generation",
        result: "bad",
        count: 99,
      },
    ];

    const samples = buildCumulativeSloSamples(rawBuckets, window);

    expect(
      samples.find(
        (sample) =>
          sample.timestampMs === Date.parse("2026-05-17T03:00:00.000Z") &&
          sample.journey === "global" &&
          sample.result === "good",
      )?.value,
    ).toBe(5);
    expect(
      samples.find(
        (sample) =>
          sample.timestampMs === Date.parse("2026-05-17T02:00:00.000Z") &&
          sample.journey === "global" &&
          sample.result === "bad",
      )?.value,
    ).toBe(1);
    expect(
      samples.find(
        (sample) =>
          sample.timestampMs === Date.parse("2026-05-17T03:00:00.000Z") &&
          sample.journey === "unknown_coworker_generation" &&
          sample.result === "bad",
      )?.value,
    ).toBe(0);
  });

  test("keeps overlapping counter samples stable when the backfill window shifts", () => {
    const firstWindow = {
      from: new Date("2026-05-17T00:00:00.000Z"),
      toExclusive: new Date("2026-05-17T03:00:00.000Z"),
    };
    const secondWindow = {
      from: new Date("2026-05-17T01:00:00.000Z"),
      toExclusive: new Date("2026-05-17T04:00:00.000Z"),
    };

    const firstSamples = buildCumulativeSloSamples(
      [
        {
          bucket: new Date("2026-05-17T00:00:00.000Z"),
          journey: "chat",
          result: "good",
          count: 10,
          isSeed: true,
        },
        {
          bucket: new Date("2026-05-17T00:00:00.000Z"),
          journey: "chat",
          result: "good",
          count: 2,
        },
        {
          bucket: new Date("2026-05-17T01:00:00.000Z"),
          journey: "coworker_builder",
          result: "bad",
          count: 1,
        },
      ],
      firstWindow,
    );
    const secondSamples = buildCumulativeSloSamples(
      [
        {
          bucket: new Date("2026-05-17T01:00:00.000Z"),
          journey: "chat",
          result: "good",
          count: 12,
          isSeed: true,
        },
        {
          bucket: new Date("2026-05-17T01:00:00.000Z"),
          journey: "coworker_builder",
          result: "bad",
          count: 1,
        },
      ],
      secondWindow,
    );

    expect(sampleAt(firstSamples, "2026-05-17T01:00:00.000Z", "chat", "good")).toBe(
      sampleAt(secondSamples, "2026-05-17T01:00:00.000Z", "chat", "good"),
    );
    expect(sampleAt(firstSamples, "2026-05-17T02:00:00.000Z", "coworker_builder", "bad")).toBe(
      sampleAt(secondSamples, "2026-05-17T02:00:00.000Z", "coworker_builder", "bad"),
    );
  });

  test("renders Prometheus import rows with millisecond timestamps", () => {
    const rows = renderPrometheusImportRows([
      {
        timestampMs: Date.parse("2026-05-17T01:00:00.000Z"),
        journey: "chat",
        result: "good",
        value: 7,
      },
    ]);

    expect(rows).toContain("# TYPE cmdclaw_slo_events_total counter");
    expect(rows).toContain(
      'cmdclaw_slo_events_total{journey="chat",result="good"} 7 1778979600000',
    );
  });

  test("posts import rows to VictoriaMetrics", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    await importSloBucketsToVictoriaMetrics("rows", {
      victoriaMetricsUrl: "http://victoria.example/",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://victoria.example/api/v1/import/prometheus", {
      method: "POST",
      headers: { "content-type": "text/plain; version=0.0.4" },
      body: "rows",
    });
  });

  test("aggregation query classifies terminal events and omits initial coworker run generations", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [] as RawSloBucket[],
    }));
    const db = {
      query,
    };
    const window = {
      from: new Date("2026-04-17T00:00:00.000Z"),
      toExclusive: new Date("2026-05-17T00:00:00.000Z"),
    };

    await aggregateSloBuckets(db, window);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    const [sql, values] = call;
    expect(sql).toContain("exists");
    expect(sql).toContain("cw.builder_conversation_id = g.conversation_id");
    expect(sql).toContain("cr_by_conversation.conversation_id = g.conversation_id");
    expect(sql).toContain("run_generation.conversation_id = g.conversation_id");
    expect(sql).toContain("then 'coworker_run'");
    expect(sql).toContain("when c.type = 'coworker' then 'unknown_coworker_generation'");
    expect(sql).toContain("left join coworker_run cr on cr.generation_id = g.id");
    expect(sql).toContain("and cr.id is null");
    expect(sql).toContain("seed_events as");
    expect(sql).toContain('true as "isSeed"');
    expect(sql).toContain("where event_at < $1");
    expect(sql).toContain("where event_at >= $1");
    expect(sql).toContain("where g.status in ('completed', 'error')");
    expect(sql).toContain("where cr.status in ('completed', 'error')");
    expect(values).toEqual([window.from, window.toExclusive]);
  });
});
