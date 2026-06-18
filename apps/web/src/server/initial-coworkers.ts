import {
  normalizeCoworkerAllowedSkillSlugs,
  normalizeCoworkerToolAccessMode,
} from "@bap/core/lib/coworker-tool-policy";
import { db } from "@bap/db/client";
import { coworker, coworkerRun, generation } from "@bap/db/schema";
import { and, count, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

const INITIAL_COWORKER_LIMIT = 36;

export async function queryInitialCoworkers(params: { userId: string; workspaceId: string }) {
  const where = and(
    eq(coworker.ownerId, params.userId),
    eq(coworker.workspaceId, params.workspaceId),
  );
  const [totalRow] = await db.select({ value: count() }).from(coworker).where(where);
  const [sharedRow] = await db
    .select({ value: count() })
    .from(coworker)
    .where(and(where, isNotNull(coworker.sharedAt)));
  const rows = await db.query.coworker.findMany({
    where,
    orderBy: [desc(coworker.isPinned), desc(coworker.updatedAt), desc(coworker.id)],
    limit: INITIAL_COWORKER_LIMIT,
  });
  const coworkerIds = rows.map((row) => row.id);
  const rankedRuns =
    coworkerIds.length > 0
      ? db
          .select({
            runId: coworkerRun.id,
            coworkerId: coworkerRun.coworkerId,
            status: coworkerRun.status,
            startedAt: coworkerRun.startedAt,
            conversationId: sql<
              string | null
            >`coalesce(${coworkerRun.conversationId}, ${generation.conversationId})`.as(
              "conversation_id",
            ),
            rowNumber:
              sql<number>`row_number() over (partition by ${coworkerRun.coworkerId} order by ${coworkerRun.startedAt} desc)`.as(
                "row_number",
              ),
          })
          .from(coworkerRun)
          .leftJoin(generation, eq(coworkerRun.generationId, generation.id))
          .where(
            and(inArray(coworkerRun.coworkerId, coworkerIds), isNull(coworkerRun.syntheticKind)),
          )
          .as("ranked_runs")
      : null;
  const lastRunsByCoworkerId = new Map<
    string,
    { id: string; status: string; startedAt: Date; conversationId: string | null }
  >();

  if (rankedRuns) {
    const lastRuns = await db
      .select({
        runId: rankedRuns.runId,
        coworkerId: rankedRuns.coworkerId,
        status: rankedRuns.status,
        startedAt: rankedRuns.startedAt,
        conversationId: rankedRuns.conversationId,
      })
      .from(rankedRuns)
      .where(lte(rankedRuns.rowNumber, 1));

    for (const run of lastRuns) {
      lastRunsByCoworkerId.set(run.coworkerId, {
        id: run.runId,
        status: run.status,
        startedAt: run.startedAt,
        conversationId: run.conversationId ?? null,
      });
    }
  }

  return {
    sharedCount: sharedRow?.value ?? 0,
    totalCount: totalRow?.value ?? rows.length,
    coworkers: rows.map((row) => {
      const lastRun = lastRunsByCoworkerId.get(row.id);
      const toolAccessMode = normalizeCoworkerToolAccessMode(
        row.toolAccessMode,
        row.allowedIntegrations,
      );

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        username: row.username,
        folderId: row.folderId,
        status: row.status,
        autoApprove: row.autoApprove,
        model: row.model,
        authSource: row.authSource,
        triggerType: row.triggerType,
        integrations: row.allowedIntegrations,
        toolAccessMode,
        allowedIntegrations: row.allowedIntegrations,
        allowedCustomIntegrations: row.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: row.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(row.allowedSkillSlugs),
        schedule: row.schedule,
        requiresUserInput: row.requiresUserInput,
        userInputPrompt: row.userInputPrompt,
        isPinned: row.isPinned,
        sharedAt: row.sharedAt,
        updatedAt: row.updatedAt,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.startedAt ?? null,
        recentRuns: lastRun
          ? [
              {
                id: lastRun.id,
                status: lastRun.status,
                startedAt: lastRun.startedAt,
                conversationId: lastRun.conversationId,
                source: "manual" as const,
              },
            ]
          : [],
      };
    }),
  };
}
