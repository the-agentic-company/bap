import {
  reconcileStaleCoworkerRunsForCoworker,
  reconcileStaleCoworkerRunsForCoworkers,
} from "@bap/core/server/services/coworker-service";
import {
  generation,
  coworkerDocument,
  coworkerRun,
  coworkerTag,
  coworkerTagAssignment,
} from "@bap/db/schema";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { ensureBuilderCoworkerMetadata } from "@/server/services/coworker-builder-metadata";
import { getResolvedCoworkerToolPolicy } from "@/server/services/coworker-toolbox";

type CatalogContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

export async function listCoworkerCatalog(input: {
  context: CatalogContext;
  coworkers: Array<typeof import("@bap/db/schema").coworker.$inferSelect>;
}) {
  const coworkerIds = input.coworkers.map((row) => row.id);

  await reconcileStaleCoworkerRunsForCoworkers(coworkerIds);

  const tagAssignments =
    coworkerIds.length > 0
      ? await input.context.db
          .select({
            coworkerId: coworkerTagAssignment.coworkerId,
            tagId: coworkerTag.id,
            tagName: coworkerTag.name,
            tagColor: coworkerTag.color,
          })
          .from(coworkerTagAssignment)
          .innerJoin(coworkerTag, eq(coworkerTagAssignment.tagId, coworkerTag.id))
          .where(inArray(coworkerTagAssignment.coworkerId, coworkerIds))
      : [];
  const tagsByCoworkerId = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const row of tagAssignments) {
    const tags = tagsByCoworkerId.get(row.coworkerId) ?? [];
    tags.push({ id: row.tagId, name: row.tagName, color: row.tagColor });
    tagsByCoworkerId.set(row.coworkerId, tags);
  }

  const rankedCoworkerRuns =
    coworkerIds.length > 0
      ? input.context.db
          .select({
            runId: coworkerRun.id,
            coworkerId: coworkerRun.coworkerId,
            status: coworkerRun.status,
            startedAt: coworkerRun.startedAt,
            triggerPayload: coworkerRun.triggerPayload,
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
          .as("ranked_coworker_runs")
      : null;

  const recentRunsByCoworkerId = new Map<
    string,
    Array<{
      id: string;
      status: string;
      startedAt: Date;
      conversationId: string | null;
      source: "trigger" | "manual";
    }>
  >();

  if (rankedCoworkerRuns) {
    const recentRunRows = await input.context.db
      .select({
        runId: rankedCoworkerRuns.runId,
        coworkerId: rankedCoworkerRuns.coworkerId,
        status: rankedCoworkerRuns.status,
        startedAt: rankedCoworkerRuns.startedAt,
        triggerPayload: rankedCoworkerRuns.triggerPayload,
        conversationId: rankedCoworkerRuns.conversationId,
      })
      .from(rankedCoworkerRuns)
      .where(lte(rankedCoworkerRuns.rowNumber, 20))
      .orderBy(desc(rankedCoworkerRuns.startedAt));

    for (const run of recentRunRows) {
      const payload =
        run.triggerPayload && typeof run.triggerPayload === "object"
          ? (run.triggerPayload as Record<string, unknown>)
          : null;
      const source = payload && Object.keys(payload).length > 0 ? "trigger" : "manual";
      const groupedRuns = recentRunsByCoworkerId.get(run.coworkerId) ?? [];
      groupedRuns.push({
        id: run.runId,
        status: run.status,
        startedAt: run.startedAt,
        conversationId: run.conversationId ?? null,
        source,
      });
      recentRunsByCoworkerId.set(run.coworkerId, groupedRuns);
    }
  }

  const items = await Promise.all(
    input.coworkers.map(async (coworkerRow) => {
      const wf = await ensureBuilderCoworkerMetadata({
        context: input.context,
        wf: coworkerRow,
      });
      const runs = recentRunsByCoworkerId.get(wf.id) ?? [];
      const lastRun = runs[0];
      const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);

      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        username: wf.username,
        folderId: wf.folderId,
        status: wf.status,
        autoApprove: wf.autoApprove,
        model: wf.model,
        authSource: wf.authSource,
        triggerType: wf.triggerType,
        integrations: wf.allowedIntegrations,
        toolAccessMode,
        allowedIntegrations: wf.allowedIntegrations,
        allowedCustomIntegrations: wf.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs,
        schedule: wf.schedule,
        requiresUserInput: wf.requiresUserInput,
        userInputPrompt: wf.userInputPrompt,
        isPinned: wf.isPinned,
        sharedAt: wf.sharedAt,
        updatedAt: wf.updatedAt,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.startedAt ?? null,
        tags: tagsByCoworkerId.get(wf.id) ?? [],
        recentRuns: runs,
      };
    }),
  );

  items.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return 0;
  });

  return items;
}

export async function getCoworkerCatalogDetails(input: {
  context: CatalogContext;
  coworker: typeof import("@bap/db/schema").coworker.$inferSelect;
}) {
  await reconcileStaleCoworkerRunsForCoworker(input.coworker.id);

  const wf = await ensureBuilderCoworkerMetadata({
    context: input.context,
    wf: input.coworker,
  });

  const runs = await input.context.db.query.coworkerRun.findMany({
    where: eq(coworkerRun.coworkerId, wf.id),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
    limit: 20,
  });
  const documents = await input.context.db.query.coworkerDocument.findMany({
    where: eq(coworkerDocument.coworkerId, wf.id),
    orderBy: (document, { desc }) => [desc(document.createdAt)],
  });
  const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);

  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    username: wf.username,
    folderId: wf.folderId,
    status: wf.status,
    autoApprove: wf.autoApprove,
    model: wf.model,
    authSource: wf.authSource,
    triggerType: wf.triggerType,
    prompt: wf.prompt,
    toolAccessMode,
    allowedIntegrations: wf.allowedIntegrations,
    allowedCustomIntegrations: wf.allowedCustomIntegrations,
    allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
    allowedSkillSlugs,
    schedule: wf.schedule,
    requiresUserInput: wf.requiresUserInput,
    userInputPrompt: wf.userInputPrompt,
    sharedAt: wf.sharedAt,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
    documents: documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      description: document.description,
      createdAt: document.createdAt,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
    })),
  };
}
