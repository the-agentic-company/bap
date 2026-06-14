import { conversationRuntimeService } from "@bap/core/server/services/conversation-runtime-service";
import { conversationRuntime, sandboxUsageSnapshot } from "@bap/db/schema";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { requireAdmin } from "./admin-require-admin";

type EnrichmentRow = {
  sandboxId: string;
  conversationId: string | null;
  conversationTitle: string | null;
  conversationType: string | null;
  model: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  coworkerName: string | null;
  coworkerUsername: string | null;
  coworkerTriggerType: string | null;
  coworkerId: string | null;
};

const ENRICHMENT_QUERY = `
  select distinct on (cr.sandbox_id)
    cr.sandbox_id as "sandboxId",
    cr.conversation_id as "conversationId",
    c.title as "conversationTitle",
    c.type as "conversationType",
    c.model,
    c.user_id as "userId",
    u.email as "userEmail",
    u.name as "userName",
    cw.name as "coworkerName",
    cw.username as "coworkerUsername",
    cw.trigger_type as "coworkerTriggerType",
    cw.id as "coworkerId"
  from conversation_runtime cr
  join conversation c on c.id = cr.conversation_id
  left join "user" u on u.id = c.user_id
  left join generation g on g.conversation_id = c.id
  left join coworker_run cwr on cwr.generation_id = g.id
  left join coworker cw on cw.id = cwr.coworker_id
  where cr.sandbox_id = any($1)
  order by cr.sandbox_id, cw.id nulls last, cr.updated_at desc
`;

async function queryEnrichmentFromUrl(
  connectionString: string,
  sandboxIds: string[],
): Promise<EnrichmentRow[]> {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    const result = await pool.query(ENRICHMENT_QUERY, [sandboxIds]);
    return result.rows as EnrichmentRow[];
  } catch {
    return [];
  } finally {
    await pool.end();
  }
}

type UnifiedSandbox = {
  provider: "e2b" | "daytona";
  sandboxId: string;
  templateId: string | null;
  state: "running" | "paused" | "stopped" | "error" | "unknown";
  startedAt: Date | null;
  endAt: Date | null;
  cpuCount: number | null;
  memoryMB: number | null;
  metadata: Record<string, string>;
};

async function listSandboxesFromProvider(): Promise<UnifiedSandbox[]> {
  const [{ isE2BConfigured, listAllE2BSandboxes }, daytonaModule] = await Promise.all([
    import("@bap/core/server/sandbox/e2b"),
    import("@bap/core/server/sandbox/daytona"),
  ]);

  const results: UnifiedSandbox[] = [];

  if (isE2BConfigured()) {
    try {
      const e2b = await listAllE2BSandboxes();
      for (const s of e2b) {
        results.push({
          provider: "e2b",
          sandboxId: s.sandboxId,
          templateId: s.templateId,
          state: s.state,
          startedAt: s.startedAt,
          endAt: s.endAt,
          cpuCount: s.cpuCount,
          memoryMB: s.memoryMB,
          metadata: s.metadata ?? {},
        });
      }
    } catch (error) {
      console.warn("[admin.listSandboxes] e2b listing failed", error);
    }
  }

  if (daytonaModule.isDaytonaConfigured()) {
    try {
      const daytona = await daytonaModule.listAllDaytonaSandboxes();
      for (const s of daytona) {
        results.push({
          provider: "daytona",
          sandboxId: s.sandboxId,
          templateId: null,
          state: s.state,
          startedAt: s.startedAt,
          endAt: null,
          cpuCount: null,
          memoryMB: null,
          metadata: s.metadata ?? {},
        });
      }
    } catch (error) {
      console.warn("[admin.listSandboxes] daytona listing failed", error);
    }
  }

  return results;
}

async function killSandboxInProvider(sandboxId: string, provider: "e2b" | "daytona") {
  if (provider === "daytona") {
    const { killDaytonaSandboxById } = await import("@bap/core/server/sandbox/daytona");
    return killDaytonaSandboxById(sandboxId);
  }
  const { killE2BSandboxById } = await import("@bap/core/server/sandbox/e2b");
  return killE2BSandboxById(sandboxId);
}

export const listSandboxes = protectedProcedure.handler(async ({ context }) => {
  await requireAdmin(context);

  const sandboxes = await listSandboxesFromProvider();

  if (sandboxes.length === 0) {
    return { sandboxes: [], totalCount: 0 };
  }

  const sandboxIds = sandboxes.map((s) => s.sandboxId);

  // Query all available databases for enrichment
  const dbSources: Array<{ env: string; url: string }> = [
    { env: "dev", url: process.env.DATABASE_URL! },
  ];
  if (process.env.DATABASE_URL_STAGING) {
    dbSources.push({ env: "staging", url: process.env.DATABASE_URL_STAGING });
  }
  if (process.env.DATABASE_URL_PROD) {
    dbSources.push({ env: "prod", url: process.env.DATABASE_URL_PROD });
  }

  const enrichmentMap = new Map<string, EnrichmentRow & { environment: string }>();

  const enrichmentResults = await Promise.all(
    dbSources.map(async ({ env: envName, url }) => {
      const rows = await queryEnrichmentFromUrl(url, sandboxIds);
      return { envName, rows };
    }),
  );

  for (const { envName, rows } of enrichmentResults) {
    for (const row of rows) {
      if (!enrichmentMap.has(row.sandboxId)) {
        enrichmentMap.set(row.sandboxId, { ...row, environment: envName });
      }
    }
  }

  const merged = sandboxes.map((s) => {
    const enrichment = enrichmentMap.get(s.sandboxId);
    return {
      provider: s.provider,
      sandboxId: s.sandboxId,
      templateId: s.templateId,
      state: s.state,
      startedAt: s.startedAt,
      endAt: s.endAt,
      cpuCount: s.cpuCount,
      memoryMB: s.memoryMB,
      metadata: s.metadata,
      environment: enrichment?.environment ?? null,
      conversationId: enrichment?.conversationId ?? s.metadata.conversationId ?? null,
      conversationTitle: enrichment?.conversationTitle ?? null,
      conversationType: enrichment?.conversationType ?? null,
      model: enrichment?.model ?? null,
      userId: enrichment?.userId ?? s.metadata.userId ?? null,
      userEmail: enrichment?.userEmail ?? null,
      userName: enrichment?.userName ?? null,
      coworkerName: enrichment?.coworkerName ?? null,
      coworkerUsername: enrichment?.coworkerUsername ?? null,
      coworkerTriggerType: enrichment?.coworkerTriggerType ?? null,
      coworkerId: enrichment?.coworkerId ?? null,
    };
  });

  return { sandboxes: merged, totalCount: merged.length };
});

export const adminKillSandbox = protectedProcedure
  .input(
    z.object({
      sandboxId: z.string().min(1),
      provider: z.enum(["e2b", "daytona"]).default("e2b"),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    await killSandboxInProvider(input.sandboxId, input.provider);

    const runtime = await context.db.query.conversationRuntime.findFirst({
      where: eq(conversationRuntime.sandboxId, input.sandboxId),
    });
    if (runtime) {
      await conversationRuntimeService.markRuntimeDead(runtime.id);
    }

    return { success: true, sandboxId: input.sandboxId, provider: input.provider };
  });

const SANDBOX_USAGE_RANGE_HOURS: Record<"24h" | "7d" | "30d", number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export const getSandboxUsageHistory = protectedProcedure
  .input(
    z.object({
      range: z.enum(["24h", "7d", "30d"]).default("7d"),
      bucket: z.enum(["hour", "day"]).default("hour"),
    }),
  )
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const hours = SANDBOX_USAGE_RANGE_HOURS[input.range];
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const bucketExpr = input.bucket === "day" ? sql`'day'` : sql`'hour'`;

    // Per-bucket/provider aggregates. Credits per bucket = avg credits per tick × ticks-per-bucket,
    // but since we want cumulative picture, we sum per-snapshot credits and normalize by ticks.
    // Simpler & more useful: sum credits per bucket (each snapshot's credits is instantaneous
    // runtime-to-date), then take max per sandbox per bucket for count, and sum credit deltas.
    //
    // For the chart, we show:
    //   - concurrent sandbox count (max per bucket)
    //   - total accumulated credits "burned" during each bucket
    //     = sum_per_sandbox(max(credits in bucket) - min(credits in bucket))
    //       approximated as: (avg(credits) * count) / 12 (ticks per hour)
    //
    // We report:
    //   count = avg distinct sandboxes per bucket
    //   creditsBurned = sum(credits) / snapshots_in_bucket × sandboxes × hours
    // To keep SQL simple, we approximate credits burned per bucket as:
    //   avg(credits_per_tick) × (bucket_length_minutes / 5 minutes) × avg_distinct_sandboxes
    // But cleanest: the DB already has credits-since-start per snapshot. The incremental burn
    // over a bucket = (latest credits - earliest credits) per sandbox per bucket, summed.
    const rows = await context.db.execute(sql`
      with bucketed as (
        select
          date_trunc(${bucketExpr}, ${sandboxUsageSnapshot.snapshotAt}) as bucket_start,
          ${sandboxUsageSnapshot.provider} as provider,
          ${sandboxUsageSnapshot.sandboxId} as sandbox_id,
          ${sandboxUsageSnapshot.snapshotAt} as snapshot_at,
          ${sandboxUsageSnapshot.credits} as credits,
          ${sandboxUsageSnapshot.runtimeSeconds} as runtime_seconds
        from ${sandboxUsageSnapshot}
        where ${sandboxUsageSnapshot.snapshotAt} >= ${cutoff}
      ),
      per_sandbox_bucket as (
        select
          bucket_start,
          provider,
          sandbox_id,
          max(credits) - min(credits) as credits_burned,
          max(runtime_seconds) - min(runtime_seconds) as seconds_burned,
          count(*) as snapshot_count
        from bucketed
        group by bucket_start, provider, sandbox_id
      )
      select
        bucket_start as "bucketStart",
        provider as "provider",
        count(distinct sandbox_id)::int as "sandboxCount",
        coalesce(sum(credits_burned), 0)::float as "creditsBurned",
        coalesce(sum(seconds_burned), 0)::bigint as "secondsBurned"
      from per_sandbox_bucket
      group by bucket_start, provider
      order by bucket_start asc, provider asc
    `);

    const buckets = (rows.rows ?? []) as Array<{
      bucketStart: Date;
      provider: "e2b" | "daytona";
      sandboxCount: number;
      creditsBurned: number;
      secondsBurned: number | string;
    }>;

    // Per-sandbox leak table: longest continuously-observed sandbox during range.
    const leaksResult = await context.db.execute(sql`
      select
        ${sandboxUsageSnapshot.sandboxId} as "sandboxId",
        ${sandboxUsageSnapshot.provider} as "provider",
        min(${sandboxUsageSnapshot.snapshotAt}) as "firstSeen",
        max(${sandboxUsageSnapshot.snapshotAt}) as "lastSeen",
        max(${sandboxUsageSnapshot.runtimeSeconds})::int as "runtimeSeconds",
        max(${sandboxUsageSnapshot.credits})::float as "credits",
        count(*)::int as "ticks"
      from ${sandboxUsageSnapshot}
      where ${sandboxUsageSnapshot.snapshotAt} >= ${cutoff}
      group by ${sandboxUsageSnapshot.sandboxId}, ${sandboxUsageSnapshot.provider}
      having count(*) >= 2
      order by max(${sandboxUsageSnapshot.runtimeSeconds}) desc
      limit 20
    `);
    const leaks = (leaksResult.rows ?? []) as Array<{
      sandboxId: string;
      provider: "e2b" | "daytona";
      firstSeen: Date;
      lastSeen: Date;
      runtimeSeconds: number;
      credits: number;
      ticks: number;
    }>;

    return {
      range: input.range,
      bucket: input.bucket,
      buckets: buckets.map((b) => ({
        bucketStart: b.bucketStart,
        provider: b.provider,
        sandboxCount: b.sandboxCount,
        creditsBurned: Number(b.creditsBurned) || 0,
        secondsBurned: Number(b.secondsBurned) || 0,
      })),
      leaks,
    };
  });
