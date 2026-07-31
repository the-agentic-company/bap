import { db } from "./client";
import {
  coworker,
  coworkerBuilderChat,
  coworkerFolder,
  coworkerMemberPreference,
  coworkerRevision,
  coworkerRun,
  user,
} from "./schema";
import { eq, isNull, or } from "drizzle-orm";

type Database = typeof db;

type FolderShape = {
  id: string;
  parentId: string | null;
  visibility: "private" | "workspace";
};

export function resolveBackfillCoworkerVisibility(input: {
  explicitVisibility: "private" | "workspace";
  sharedAt: Date | null;
  folderId: string | null;
  folders: FolderShape[];
}): "private" | "workspace" {
  if (input.explicitVisibility === "workspace" || input.sharedAt) {
    return "workspace";
  }
  if (!input.folderId) {
    return "private";
  }
  const byId = new Map(input.folders.map((folder) => [folder.id, folder]));
  let current = byId.get(input.folderId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return current?.visibility ?? "private";
}

function initialSnapshot(
  row: typeof coworker.$inferSelect,
  visibility: "private" | "workspace",
) {
  return {
    name: row.name ?? "",
    description: row.description ?? null,
    username: row.username ?? null,
    status: row.status ?? "on",
    triggerType: row.triggerType ?? "manual",
    prompt: row.prompt ?? "",
    model: row.model ?? "anthropic/claude-sonnet-4-6",
    authSource: row.authSource ?? null,
    requiresUserInput: row.requiresUserInput ?? false,
    userInputPrompt: row.userInputPrompt ?? null,
    autoApprove: row.autoApprove ?? true,
    toolAccessMode: row.toolAccessMode ?? "all",
    allowedIntegrations: row.allowedIntegrations ?? [],
    allowedCustomIntegrations: row.allowedCustomIntegrations ?? [],
    allowedWorkspaceMcpServerIds: row.allowedWorkspaceMcpServerIds ?? [],
    allowedSkillSlugs: row.allowedSkillSlugs ?? [],
    schedule: row.schedule ?? null,
    visibility,
  };
}

export async function backfillCanonicalWorkspaceCoworkers(
  database: Database = db,
) {
  const [coworkers, folders] = await Promise.all([
    database.query.coworker.findMany(),
    database.query.coworkerFolder.findMany(),
  ]);
  let updatedCoworkers = 0;

  for (const row of coworkers) {
    const creatorId = row.createdByUserId ?? row.ownerId;
    const creator = creatorId
      ? await database.query.user.findFirst({
          where: eq(user.id, creatorId),
          columns: { name: true, email: true, image: true },
        })
      : null;
    const visibility = resolveBackfillCoworkerVisibility({
      explicitVisibility: row.visibility,
      sharedAt: row.sharedAt,
      folderId: row.folderId,
      folders,
    });

    await database
      .update(coworker)
      .set({
        createdByUserId: creatorId,
        createdByNameSnapshot:
          row.createdByNameSnapshot ?? creator?.name ?? creator?.email ?? null,
        createdByAvatarSnapshot:
          row.createdByAvatarSnapshot ?? creator?.image ?? null,
        visibility,
        automationOwnerUserId: row.automationOwnerUserId ?? creatorId,
        automationOwnerConsentedAt:
          row.automationOwnerConsentedAt ?? (creatorId ? row.createdAt : null),
      })
      .where(eq(coworker.id, row.id));

    if (creatorId && row.builderConversationId) {
      await database
        .insert(coworkerBuilderChat)
        .values({
          coworkerId: row.id,
          userId: creatorId,
          conversationId: row.builderConversationId,
        })
        .onConflictDoNothing();
    }
    if (creatorId && row.isPinned) {
      await database
        .insert(coworkerMemberPreference)
        .values({
          coworkerId: row.id,
          userId: creatorId,
          isPinned: true,
        })
        .onConflictDoUpdate({
          target: [
            coworkerMemberPreference.coworkerId,
            coworkerMemberPreference.userId,
          ],
          set: { isPinned: true },
        });
    }
    await database
      .insert(coworkerRevision)
      .values({
        coworkerId: row.id,
        revision: 0,
        baseRevision: 0,
        actorUserId: creatorId,
        actorNameSnapshot:
          row.createdByNameSnapshot ?? creator?.name ?? creator?.email ?? null,
        actorAvatarSnapshot:
          row.createdByAvatarSnapshot ?? creator?.image ?? null,
        origin: "migration",
        changedFields: [],
        changes: {},
        snapshot: initialSnapshot(row, visibility),
        createdAt: row.createdAt,
      })
      .onConflictDoNothing();
    updatedCoworkers += 1;
  }

  const legacyRuns = await database.query.coworkerRun.findMany({
    where: orMissingRunIdentity(),
  });
  for (const run of legacyRuns) {
    await database
      .update(coworkerRun)
      .set({
        initiatedByUserId: run.initiatedByUserId ?? run.ownerId,
        executionUserId: run.executionUserId ?? run.ownerId,
        // Conservative privacy: old runs remain manual unless their original start kind was stored.
        startKind: run.startKind ?? "user_intent",
      })
      .where(eq(coworkerRun.id, run.id));
  }

  return { updatedCoworkers, updatedRuns: legacyRuns.length };
}

function orMissingRunIdentity() {
  return or(
    isNull(coworkerRun.initiatedByUserId),
    isNull(coworkerRun.executionUserId),
  );
}

if (process.argv[1]?.endsWith("canonical-coworker-backfill.ts")) {
  const result = await backfillCanonicalWorkspaceCoworkers();
  console.info(
    `Canonical Coworker backfill complete: ${result.updatedCoworkers} coworkers, ${result.updatedRuns} runs`,
  );
  process.exit(0);
}
