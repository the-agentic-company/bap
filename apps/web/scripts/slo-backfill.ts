import process from "node:process";
import {
  SLO_METRIC_JOURNEYS,
  SLO_RESULTS,
  SLO_TRAFFIC_TYPES,
  type SloMetricJourney,
  type SloResult,
  type SloTraffic,
} from "@cmdclaw/core/server/services/slo-journey-classification";
import { Pool } from "pg";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_VICTORIA_METRICS_URL = "http://127.0.0.1:8428";

export const SLO_JOURNEYS = SLO_METRIC_JOURNEYS;
export { SLO_RESULTS, SLO_TRAFFIC_TYPES };

export type SloJourney = SloMetricJourney;
export type { SloResult };
export type SloTrafficType = SloTraffic;

export type RawSloBucket = {
  bucket: Date | string;
  journey: Exclude<SloJourney, "global">;
  result: SloResult;
  count: number | string;
  isSeed?: boolean | string;
};

export type SloSample = {
  timestampMs: number;
  journey: SloJourney;
  result: SloResult;
  value: number;
  traffic?: SloTrafficType;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type Queryable = {
  query(sql: string, values?: unknown[]): Promise<{ rows: RawSloBucket[] }>;
};

export type SloBackfillWindow = {
  from: Date;
  toExclusive: Date;
};

export type AggregateSloBucketOptions = SloBackfillWindow;

export type ImportSloBucketsOptions = {
  victoriaMetricsUrl?: string;
  fetchImpl?: FetchLike;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function floorToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS);
}

export function resolveSloBackfillWindow(
  now = new Date(),
  windowDays = DEFAULT_WINDOW_DAYS,
): SloBackfillWindow {
  const toExclusive = floorToHour(now);
  const from = new Date(toExclusive.getTime() - windowDays * 24 * ONE_HOUR_MS);
  return { from, toExclusive };
}

function seriesKey(journey: SloJourney, result: SloResult): string {
  return `${journey}:${result}`;
}

function parseBucketTime(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    throw new Error(`Invalid SLO bucket timestamp: ${String(value)}`);
  }
  return floorToHour(date).getTime();
}

function parseCount(value: number | string): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid SLO bucket count: ${String(value)}`);
  }
  return count;
}

function parseIsSeed(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

export async function aggregateSloBuckets(
  db: Queryable,
  options: AggregateSloBucketOptions,
): Promise<RawSloBucket[]> {
  const result = await db.query(
    `
      with generation_events as (
        select
          coalesce(g.completed_at, g.last_runtime_event_at, g.started_at) as event_at,
          case
            when exists (
              select 1
              from coworker cw
              where cw.builder_conversation_id = g.conversation_id
            ) then 'coworker_builder'
            when exists (
              select 1
              from coworker_run cr_by_conversation
              left join generation run_generation
                on run_generation.id = cr_by_conversation.generation_id
              where cr_by_conversation.conversation_id = g.conversation_id
                 or run_generation.conversation_id = g.conversation_id
            ) then 'coworker_run'
            when c.type = 'coworker' then null
            else 'chat'
          end as journey,
          case
            when g.status = 'completed' then 'good'
            when g.status = 'cancelled' and coalesce(g.completion_reason, 'user_cancel') in ('user_cancel', 'cancelled') then 'good'
            else 'bad'
          end as result
        from generation g
        join conversation c on c.id = g.conversation_id
        left join coworker_run cr on cr.generation_id = g.id
        where g.status in ('completed', 'error', 'cancelled')
          and cr.id is null
          and coalesce(g.completed_at, g.last_runtime_event_at, g.started_at) < $2
      ),
      coworker_run_events as (
        select
          coalesce(cr.finished_at, cr.started_at) as event_at,
          'coworker_run' as journey,
          case
            when cr.status = 'completed' then 'good'
            when cr.status = 'cancelled' and coalesce(g.completion_reason, 'user_cancel') in ('user_cancel', 'cancelled') then 'good'
            else 'bad'
          end as result
        from coworker_run cr
        left join generation g on g.id = cr.generation_id
        where cr.status in ('completed', 'error', 'cancelled')
          and coalesce(cr.finished_at, cr.started_at) < $2
      ),
      all_events as (
        select * from generation_events where journey is not null
        union all
        select * from coworker_run_events
      ),
      seed_events as (
        select
          $1::timestamp as bucket,
          journey,
          result,
          count(*)::bigint as count,
          true as "isSeed"
        from all_events
        where event_at < $1
        group by 1, 2, 3
      ),
      window_events as (
        select
          date_trunc('hour', event_at) as bucket,
          journey,
          result,
          count(*)::bigint as count,
          false as "isSeed"
        from all_events
        where event_at >= $1
        group by 1, 2, 3
      )
      select
        bucket,
        journey,
        result,
        count::text as count,
        "isSeed"
      from seed_events
      union all
      select
        bucket,
        journey,
        result,
        count::text as count,
        "isSeed"
      from window_events
      order by 1, 2, 3, 5
    `,
    [options.from, options.toExclusive],
  );

  return result.rows;
}

export function buildCumulativeSloSamples(
  rawBuckets: RawSloBucket[],
  window: SloBackfillWindow,
): SloSample[] {
  const fromMs = floorToHour(window.from).getTime();
  const toExclusiveMs = floorToHour(window.toExclusive).getTime();
  if (toExclusiveMs <= fromMs) {
    throw new Error("SLO backfill window must end after it starts.");
  }

  const bucketCounts = new Map<string, number>();
  const seedCounts = new Map<string, number>();
  for (const bucket of rawBuckets) {
    const bucketMs = parseBucketTime(bucket.bucket);
    const isSeed = parseIsSeed(bucket.isSeed);
    if ((!isSeed && bucketMs < fromMs) || bucketMs >= toExclusiveMs) {
      continue;
    }

    const value = parseCount(bucket.count);
    const journeyKey = seriesKey(bucket.journey, bucket.result);
    const globalKey = seriesKey("global", bucket.result);
    const targetCounts = isSeed ? seedCounts : bucketCounts;
    targetCounts.set(
      `${bucketMs}:${journeyKey}`,
      (targetCounts.get(`${bucketMs}:${journeyKey}`) ?? 0) + value,
    );
    targetCounts.set(
      `${bucketMs}:${globalKey}`,
      (targetCounts.get(`${bucketMs}:${globalKey}`) ?? 0) + value,
    );
  }

  const totals = new Map<string, number>();
  const samples: SloSample[] = [];

  for (const journey of SLO_JOURNEYS) {
    for (const result of SLO_RESULTS) {
      const key = seriesKey(journey, result);
      const seedValue = seedCounts.get(`${fromMs}:${key}`) ?? 0;
      totals.set(key, seedValue);
      samples.push({ timestampMs: fromMs, journey, result, value: seedValue });
    }
  }

  for (let bucketMs = fromMs; bucketMs < toExclusiveMs; bucketMs += ONE_HOUR_MS) {
    const sampleTimestampMs = bucketMs + ONE_HOUR_MS;
    for (const journey of SLO_JOURNEYS) {
      for (const result of SLO_RESULTS) {
        const key = seriesKey(journey, result);
        const nextValue = (totals.get(key) ?? 0) + (bucketCounts.get(`${bucketMs}:${key}`) ?? 0);
        totals.set(key, nextValue);
        samples.push({ timestampMs: sampleTimestampMs, journey, result, value: nextValue });
      }
    }
  }

  return samples;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export function renderPrometheusImportRows(samples: SloSample[]): string {
  const lines = [
    "# TYPE cmdclaw_slo_events_total counter",
    ...samples.map((sample) => {
      const labels = [
        `journey="${escapeLabelValue(sample.journey)}"`,
        `result="${escapeLabelValue(sample.result)}"`,
        `traffic="${escapeLabelValue(sample.traffic ?? "real")}"`,
      ].join(",");
      return `cmdclaw_slo_events_total{${labels}} ${sample.value} ${sample.timestampMs}`;
    }),
  ];

  return `${lines.join("\n")}\n`;
}

export async function importSloBucketsToVictoriaMetrics(
  rows: string,
  options: ImportSloBucketsOptions = {},
): Promise<void> {
  const baseUrl = (options.victoriaMetricsUrl ?? DEFAULT_VICTORIA_METRICS_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/api/v1/import/prometheus`, {
    method: "POST",
    headers: { "content-type": "text/plain; version=0.0.4" },
    body: rows,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail
        ? `VictoriaMetrics import failed: ${response.status} ${detail}`
        : `VictoriaMetrics import failed: ${response.status}`,
    );
  }
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_PROD?.trim();
  if (!databaseUrl) {
    fail("Missing DATABASE_URL_PROD in the environment.");
  }

  const window = resolveSloBackfillWindow();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const rawBuckets = await aggregateSloBuckets(pool, window);
    const samples = buildCumulativeSloSamples(rawBuckets, window);
    const rows = renderPrometheusImportRows(samples);
    await importSloBucketsToVictoriaMetrics(rows, {
      victoriaMetricsUrl: process.env.CMDCLAW_VICTORIA_METRICS_URL,
    });

    const eventCount = rawBuckets.reduce((total, bucket) => total + parseCount(bucket.count), 0);
    console.log(
      [
        `Imported CmdClaw SLO backfill into VictoriaMetrics.`,
        `window=${window.from.toISOString()}..${window.toExclusive.toISOString()}`,
        `events=${eventCount}`,
        `samples=${samples.length}`,
      ].join(" "),
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
