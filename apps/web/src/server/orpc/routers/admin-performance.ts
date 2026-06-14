import { billingLedger, generation, conversation, message, user } from "@bap/db/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { requireAdmin } from "./admin-require-admin";

const generationDurationMsSql = sql<number>`
  coalesce(
    (m.timing->>'generationDurationMs')::numeric,
    (m.timing->>'endToEndDurationMs')::numeric
  )
`;

export const getPerformanceDashboard = protectedProcedure
  .input(z.object({ days: z.enum(["1", "7", "30"]).default("7") }))
  .handler(async ({ context, input }) => {
    await requireAdmin(context);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(input.days));

    // 1. Summary stats: P50/P95 end-to-end, P50 TTFVO, sandbox reuse rate, total count
    const summaryResult = await context.db.execute(sql`
      select
        count(*)::int as "totalMessages",
        percentile_cont(0.5) within group (
          order by ${generationDurationMsSql}
        )::int as "p50EndToEndMs",
        percentile_cont(0.95) within group (
          order by ${generationDurationMsSql}
        )::int as "p95EndToEndMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'promptToFirstVisibleOutputMs')::numeric
        )::int as "p50TtfvoMs",
        count(*) filter (
          where m.timing->>'sandboxStartupMode' = 'reused'
        )::int as "sandboxReusedCount",
        count(*) filter (
          where m.timing->>'sandboxStartupMode' is not null
        )::int as "sandboxTotalCount"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and ${generationDurationMsSql} is not null
        and m.created_at >= ${cutoffDate}
    `);
    const summaryRow = (summaryResult.rows?.[0] ?? {}) as {
      totalMessages: number;
      p50EndToEndMs: number;
      p95EndToEndMs: number;
      p50TtfvoMs: number;
      sandboxReusedCount: number;
      sandboxTotalCount: number;
    };
    const sandboxReuseRate =
      summaryRow.sandboxTotalCount > 0
        ? Math.round((summaryRow.sandboxReusedCount / summaryRow.sandboxTotalCount) * 100)
        : 0;

    // 2. Latency over time: daily P50/P95 end-to-end + P50 TTFVO
    const latencyResult = await context.db.execute(sql`
      select
        to_char(m.created_at, 'YYYY-MM-DD') as "date",
        count(*)::int as "messageCount",
        percentile_cont(0.5) within group (
          order by ${generationDurationMsSql}
        )::int as "p50EndToEndMs",
        percentile_cont(0.95) within group (
          order by ${generationDurationMsSql}
        )::int as "p95EndToEndMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'promptToFirstVisibleOutputMs')::numeric
        )::int as "p50TtfvoMs"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and ${generationDurationMsSql} is not null
        and m.created_at >= ${cutoffDate}
      group by to_char(m.created_at, 'YYYY-MM-DD')
      order by "date" asc
    `);
    const latencyOverTime = (latencyResult.rows ?? []) as Array<{
      date: string;
      messageCount: number;
      p50EndToEndMs: number;
      p95EndToEndMs: number;
      p50TtfvoMs: number;
    }>;

    // 3. Phase breakdown: average time per execution phase
    const phaseResult = await context.db.execute(sql`
      select
        coalesce(avg((m.timing->'phaseDurationsMs'->>'sandboxConnectOrCreateMs')::numeric), 0)::int as "avgSandboxConnectMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'opencodeReadyMs')::numeric), 0)::int as "avgOpencodeReadyMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'sessionReadyMs')::numeric), 0)::int as "avgSessionReadyMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'prePromptSetupMs')::numeric), 0)::int as "avgPrePromptSetupMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'waitForFirstEventMs')::numeric), 0)::int as "avgWaitForFirstEventMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'promptToFirstTokenMs')::numeric), 0)::int as "avgPromptToFirstTokenMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'modelStreamMs')::numeric), 0)::int as "avgModelStreamMs",
        coalesce(avg((m.timing->'phaseDurationsMs'->>'postProcessingMs')::numeric), 0)::int as "avgPostProcessingMs"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and m.timing->'phaseDurationsMs' is not null
        and m.created_at >= ${cutoffDate}
    `);
    const phaseBreakdown = (phaseResult.rows?.[0] ?? {}) as {
      avgSandboxConnectMs: number;
      avgOpencodeReadyMs: number;
      avgSessionReadyMs: number;
      avgPrePromptSetupMs: number;
      avgWaitForFirstEventMs: number;
      avgPromptToFirstTokenMs: number;
      avgModelStreamMs: number;
      avgPostProcessingMs: number;
    };

    // 4. Model comparison: per-model latency stats via billing_ledger for actual model used
    const modelResult = await context.db.execute(sql`
      select
        bl.model,
        count(*)::int as "generationCount",
        percentile_cont(0.5) within group (
          order by ${generationDurationMsSql}
        )::int as "p50EndToEndMs",
        percentile_cont(0.95) within group (
          order by ${generationDurationMsSql}
        )::int as "p95EndToEndMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'promptToFirstVisibleOutputMs')::numeric
        )::int as "p50TtfvoMs",
        coalesce(avg(bl.input_tokens + bl.output_tokens), 0)::int as "avgTokens"
      from ${billingLedger} bl
      join ${generation} g on g.id = bl.generation_id
      join ${message} m on m.id = g.message_id
      where m.role = 'assistant'
        and m.timing is not null
        and ${generationDurationMsSql} is not null
        and m.created_at >= ${cutoffDate}
      group by bl.model
      order by count(*) desc
    `);
    const modelComparison = (modelResult.rows ?? []) as Array<{
      model: string;
      generationCount: number;
      p50EndToEndMs: number;
      p95EndToEndMs: number;
      p50TtfvoMs: number;
      avgTokens: number;
    }>;

    // 5. Sandbox reuse rate over time
    const sandboxResult = await context.db.execute(sql`
      select
        to_char(m.created_at, 'YYYY-MM-DD') as "date",
        count(*) filter (where m.timing->>'sandboxStartupMode' = 'reused')::int as "reused",
        count(*) filter (where m.timing->>'sandboxStartupMode' = 'created')::int as "created",
        count(*)::int as "total"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and m.timing->>'sandboxStartupMode' is not null
        and m.created_at >= ${cutoffDate}
      group by to_char(m.created_at, 'YYYY-MM-DD')
      order by "date" asc
    `);
    const sandboxOverTime = (sandboxResult.rows ?? []) as Array<{
      date: string;
      reused: number;
      created: number;
      total: number;
    }>;

    // 6. Sandbox latency impact: reused vs created
    const sandboxImpactResult = await context.db.execute(sql`
      select
        m.timing->>'sandboxStartupMode' as "mode",
        count(*)::int as "count",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'sandboxConnectOrCreateMs')::numeric
        )::int as "p50SandboxMs",
        percentile_cont(0.5) within group (
          order by ${generationDurationMsSql}
        )::int as "p50EndToEndMs"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and m.timing->>'sandboxStartupMode' in ('reused', 'created')
        and m.created_at >= ${cutoffDate}
      group by m.timing->>'sandboxStartupMode'
    `);
    const sandboxImpact = (sandboxImpactResult.rows ?? []) as Array<{
      mode: string;
      count: number;
      p50SandboxMs: number;
      p50EndToEndMs: number;
    }>;

    // 7. Slowest generations for investigation (includes full timing for flame chart)
    const slowestResult = await context.db.execute(sql`
      select
        g.id as "generationId",
        g.conversation_id as "conversationId",
        c.title as "conversationTitle",
        c.user_id as "userId",
        u.email as "userEmail",
        bl.model,
        ${generationDurationMsSql}::int as "endToEndMs",
        (m.timing->'phaseDurationsMs'->>'sandboxConnectOrCreateMs')::int as "sandboxMs",
        (m.timing->'phaseDurationsMs'->>'modelStreamMs')::int as "modelStreamMs",
        (m.timing->'phaseDurationsMs'->>'promptToFirstVisibleOutputMs')::int as "ttfvoMs",
        m.timing->>'sandboxStartupMode' as "sandboxMode",
        g.input_tokens as "inputTokens",
        g.output_tokens as "outputTokens",
        m.created_at as "createdAt",
        m.timing as "timing"
      from ${message} m
      join ${generation} g on g.message_id = m.id
      join ${conversation} c on c.id = g.conversation_id
      left join ${user} u on u.id = c.user_id
      left join ${billingLedger} bl on bl.generation_id = g.id
      where m.role = 'assistant'
        and m.timing is not null
        and ${generationDurationMsSql} is not null
        and m.created_at >= ${cutoffDate}
      order by ${generationDurationMsSql} desc
      limit 20
    `);
    const slowestGenerations = (slowestResult.rows ?? []) as Array<{
      generationId: string;
      conversationId: string;
      conversationTitle: string | null;
      userId: string | null;
      userEmail: string | null;
      model: string | null;
      endToEndMs: number;
      sandboxMs: number | null;
      modelStreamMs: number | null;
      ttfvoMs: number | null;
      sandboxMode: string | null;
      inputTokens: number;
      outputTokens: number;
      createdAt: Date;
      timing: Record<string, unknown>;
    }>;

    // 8. Daily phase percentiles: P50/P95 per phase per day for trend charts
    const dailyPhaseResult = await context.db.execute(sql`
      select
        to_char(m.created_at, 'YYYY-MM-DD') as "date",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'sandboxConnectOrCreateMs')::numeric
        )::int as "p50SandboxConnectMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'sandboxConnectOrCreateMs')::numeric
        )::int as "p95SandboxConnectMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'opencodeReadyMs')::numeric
        )::int as "p50OpencodeReadyMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'opencodeReadyMs')::numeric
        )::int as "p95OpencodeReadyMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'sessionReadyMs')::numeric
        )::int as "p50SessionReadyMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'sessionReadyMs')::numeric
        )::int as "p95SessionReadyMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'prePromptSetupMs')::numeric
        )::int as "p50PrePromptSetupMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'prePromptSetupMs')::numeric
        )::int as "p95PrePromptSetupMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'waitForFirstEventMs')::numeric
        )::int as "p50WaitForFirstEventMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'waitForFirstEventMs')::numeric
        )::int as "p95WaitForFirstEventMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'promptToFirstTokenMs')::numeric
        )::int as "p50PromptToFirstTokenMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'promptToFirstTokenMs')::numeric
        )::int as "p95PromptToFirstTokenMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'modelStreamMs')::numeric
        )::int as "p50ModelStreamMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'modelStreamMs')::numeric
        )::int as "p95ModelStreamMs",
        percentile_cont(0.5) within group (
          order by (m.timing->'phaseDurationsMs'->>'postProcessingMs')::numeric
        )::int as "p50PostProcessingMs",
        percentile_cont(0.95) within group (
          order by (m.timing->'phaseDurationsMs'->>'postProcessingMs')::numeric
        )::int as "p95PostProcessingMs"
      from ${message} m
      where m.role = 'assistant'
        and m.timing is not null
        and m.timing->'phaseDurationsMs' is not null
        and m.created_at >= ${cutoffDate}
      group by to_char(m.created_at, 'YYYY-MM-DD')
      order by "date" asc
    `);
    type DailyPhaseRow = {
      date: string;
      p50SandboxConnectMs: number;
      p95SandboxConnectMs: number;
      p50OpencodeReadyMs: number;
      p95OpencodeReadyMs: number;
      p50SessionReadyMs: number;
      p95SessionReadyMs: number;
      p50PrePromptSetupMs: number;
      p95PrePromptSetupMs: number;
      p50WaitForFirstEventMs: number;
      p95WaitForFirstEventMs: number;
      p50PromptToFirstTokenMs: number;
      p95PromptToFirstTokenMs: number;
      p50ModelStreamMs: number;
      p95ModelStreamMs: number;
      p50PostProcessingMs: number;
      p95PostProcessingMs: number;
    };
    const dailyPhases = (dailyPhaseResult.rows ?? []) as DailyPhaseRow[];

    return {
      summary: {
        totalMessages: summaryRow.totalMessages,
        p50EndToEndMs: summaryRow.p50EndToEndMs,
        p95EndToEndMs: summaryRow.p95EndToEndMs,
        p50TtfvoMs: summaryRow.p50TtfvoMs,
        sandboxReuseRate,
      },
      latencyOverTime,
      phaseBreakdown,
      modelComparison,
      sandboxOverTime,
      sandboxImpact,
      slowestGenerations,
      dailyPhases,
    };
  });
