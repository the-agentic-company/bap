import { conversation, generation, user } from "@bap/db/schema";
import { sql } from "drizzle-orm";
import { protectedProcedure } from "../middleware";
import { requireAdmin } from "./admin-require-admin";

export const getChatOverview = protectedProcedure.handler(async ({ context }) => {
  await requireAdmin(context);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 1. Summary stats
  const summaryResult = await context.db.execute(sql`
    select
      count(distinct g.conversation_id) filter (where g.started_at >= ${thirtyDaysAgo})::int as "totalConversations30d",
      count(g.id) filter (where g.started_at >= ${thirtyDaysAgo})::int as "totalGenerations30d",
      count(g.id) filter (where g.status = 'running')::int as "activeGenerations",
      count(g.id) filter (where g.status = 'error' and g.started_at >= ${thirtyDaysAgo})::int as "errorGenerations30d",
      coalesce(avg(extract(epoch from (g.completed_at - g.started_at)) * 1000)
        filter (where g.status = 'completed' and g.completed_at is not null and g.started_at >= ${thirtyDaysAgo}), 0)::int as "avgGenerationMs"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    where c.type = 'chat'
      and (g.started_at >= ${thirtyDaysAgo} or g.status = 'running')
  `);

  const summaryRow = (summaryResult.rows?.[0] ?? {}) as {
    totalConversations30d: number;
    totalGenerations30d: number;
    activeGenerations: number;
    errorGenerations30d: number;
    avgGenerationMs: number;
  };

  const errorRate =
    summaryRow.totalGenerations30d > 0
      ? Math.round((summaryRow.errorGenerations30d / summaryRow.totalGenerations30d) * 100)
      : 0;

  // 2. Daily generation breakdown
  const dailyResult = await context.db.execute(sql`
    select
      to_char(g.started_at, 'YYYY-MM-DD') as "date",
      count(*) filter (where g.status = 'completed')::int as "completed",
      count(*) filter (where g.status = 'error')::int as "error",
      count(*) filter (where g.status = 'cancelled')::int as "cancelled",
      count(*) filter (where g.status = 'running')::int as "running",
      count(*) filter (where g.status not in ('completed', 'error', 'cancelled', 'running'))::int as "other"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    where c.type = 'chat' and g.started_at >= ${thirtyDaysAgo}
    group by to_char(g.started_at, 'YYYY-MM-DD')
    order by "date" asc
  `);
  const dailyGenerations = (dailyResult.rows ?? []) as Array<{
    date: string;
    completed: number;
    error: number;
    cancelled: number;
    running: number;
    other: number;
  }>;

  // 3. Stuck generations (running > 10 min)
  const stuckResult = await context.db.execute(sql`
    select
      g.id as "generationId",
      g.conversation_id as "conversationId",
      c.title as "conversationTitle",
      c.model,
      c.user_id as "userId",
      u.email as "userEmail",
      g.started_at as "startedAt",
      extract(epoch from (now() - g.started_at))::int as "runningSeconds"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    left join ${user} u on u.id = c.user_id
    where g.status = 'running'
      and g.started_at < now() - interval '10 minutes'
      and c.type = 'chat'
    order by g.started_at asc
    limit 50
  `);
  const stuckGenerations = (stuckResult.rows ?? []) as Array<{
    generationId: string;
    conversationId: string;
    conversationTitle: string | null;
    model: string | null;
    userId: string | null;
    userEmail: string | null;
    startedAt: Date;
    runningSeconds: number;
  }>;

  // 4. Conversations with >= 3 errors in 24h
  const repeatedResult = await context.db.execute(sql`
    select
      c.id as "conversationId",
      c.title as "conversationTitle",
      c.model,
      c.user_id as "userId",
      u.email as "userEmail",
      count(g.id)::int as "recentErrors"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    left join ${user} u on u.id = c.user_id
    where g.status = 'error'
      and g.started_at >= now() - interval '24 hours'
      and c.type = 'chat'
    group by c.id, c.title, c.model, c.user_id, u.email
    having count(g.id) >= 3
    order by count(g.id) desc
    limit 20
  `);
  const repeatedFailures = (repeatedResult.rows ?? []) as Array<{
    conversationId: string;
    conversationTitle: string | null;
    model: string | null;
    userId: string | null;
    userEmail: string | null;
    recentErrors: number;
  }>;

  // 5. Model usage breakdown (30d)
  const modelResult = await context.db.execute(sql`
    select
      c.model,
      count(g.id)::int as "totalGenerations",
      count(g.id) filter (where g.status = 'error')::int as "errors",
      coalesce(avg(g.input_tokens + g.output_tokens)::int, 0) as "avgTokens",
      coalesce(avg(extract(epoch from (g.completed_at - g.started_at)) * 1000)
        filter (where g.status = 'completed' and g.completed_at is not null), 0)::int as "avgDurationMs"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    where c.type = 'chat' and g.started_at >= ${thirtyDaysAgo}
    group by c.model
    order by count(g.id) desc
  `);
  const modelBreakdownRaw = (modelResult.rows ?? []) as Array<{
    model: string | null;
    totalGenerations: number;
    errors: number;
    avgTokens: number;
    avgDurationMs: number;
  }>;
  const modelBreakdown = modelBreakdownRaw.map((m) => {
    const errorRate =
      m.totalGenerations > 0 ? Math.round((m.errors / m.totalGenerations) * 100) : 0;
    return {
      model: m.model ?? "unknown",
      totalGenerations: m.totalGenerations,
      errors: m.errors,
      errorRate,
      avgTokens: m.avgTokens,
      avgDurationMs: m.avgDurationMs,
    };
  });

  // 6. Recent errors (last 25)
  const errorsResult = await context.db.execute(sql`
    select
      g.id as "generationId",
      g.conversation_id as "conversationId",
      c.title as "conversationTitle",
      c.model,
      c.user_id as "userId",
      u.email as "userEmail",
      g.error_message as "errorMessage",
      g.started_at as "startedAt",
      g.completed_at as "errorAt",
      g.input_tokens as "inputTokens",
      g.output_tokens as "outputTokens"
    from ${generation} g
    join ${conversation} c on c.id = g.conversation_id
    left join ${user} u on u.id = c.user_id
    where g.status = 'error' and c.type = 'chat'
    order by g.completed_at desc nulls last
    limit 25
  `);
  const recentErrors = (errorsResult.rows ?? []) as Array<{
    generationId: string;
    conversationId: string;
    conversationTitle: string | null;
    model: string | null;
    userId: string | null;
    userEmail: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    errorAt: Date | null;
    inputTokens: number;
    outputTokens: number;
  }>;

  return {
    summary: { ...summaryRow, errorRate },
    dailyGenerations,
    stuckGenerations,
    repeatedFailures,
    modelBreakdown,
    recentErrors,
  };
});
