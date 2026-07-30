import {
  coworker,
  coworkerRevision,
  type providerAuthSourceEnum,
} from "@bap/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import { normalizeCoworkerToolAccessMode } from "../../lib/coworker-tool-policy";
import type {
  CanonicalCoworkerRecord,
  CoworkerChangeRepository,
  CoworkerConfigurationSnapshot,
  CoworkerRevisionRecord,
} from "./coworker-change-service";

type Database = typeof import("@bap/db/client").db;

function configurationFromRow(row: typeof coworker.$inferSelect): CoworkerConfigurationSnapshot {
  const visibility = row.visibility === "workspace" || row.sharedAt ? "workspace" : "private";
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
    toolAccessMode: normalizeCoworkerToolAccessMode(
      row.toolAccessMode,
      row.allowedIntegrations ?? [],
    ),
    allowedIntegrations: row.allowedIntegrations ?? [],
    allowedCustomIntegrations: row.allowedCustomIntegrations ?? [],
    allowedWorkspaceMcpServerIds: row.allowedWorkspaceMcpServerIds ?? [],
    allowedSkillSlugs: row.allowedSkillSlugs ?? [],
    schedule: row.schedule ?? null,
    visibility,
  };
}

function canonicalCoworkerFromRow(row: typeof coworker.$inferSelect): CanonicalCoworkerRecord {
  const configuration = configurationFromRow(row);
  return {
    id: row.id,
    visibility: configuration.visibility,
    createdByUserId: row.createdByUserId ?? row.ownerId ?? null,
    configurationRevision: row.configurationRevision ?? 0,
    configuration,
  };
}

function revisionFromRow(row: typeof coworkerRevision.$inferSelect): CoworkerRevisionRecord {
  return {
    coworkerId: row.coworkerId,
    revision: row.revision,
    baseRevision: row.baseRevision,
    actorUserId: row.actorUserId,
    actorNameSnapshot: row.actorNameSnapshot,
    actorAvatarSnapshot: row.actorAvatarSnapshot,
    origin: row.origin,
    changedFields: row.changedFields,
    changes: row.changes,
    snapshot: row.snapshot as CoworkerConfigurationSnapshot,
    createdAt: row.createdAt,
  };
}

function configurationUpdate(
  configuration: CoworkerConfigurationSnapshot,
): Partial<typeof coworker.$inferInsert> {
  return {
    name: configuration.name,
    description: configuration.description,
    username: configuration.username,
    status: configuration.status,
    triggerType: configuration.triggerType,
    prompt: configuration.prompt,
    model: configuration.model,
    authSource:
      configuration.authSource as (typeof providerAuthSourceEnum.enumValues)[number] | null,
    requiresUserInput: configuration.requiresUserInput,
    userInputPrompt: configuration.userInputPrompt,
    autoApprove: configuration.autoApprove,
    toolAccessMode: configuration.toolAccessMode,
    allowedIntegrations:
      configuration.allowedIntegrations as (typeof coworker.$inferInsert)["allowedIntegrations"],
    allowedCustomIntegrations: configuration.allowedCustomIntegrations,
    allowedWorkspaceMcpServerIds: configuration.allowedWorkspaceMcpServerIds,
    allowedSkillSlugs: configuration.allowedSkillSlugs,
    schedule: configuration.schedule,
    visibility: configuration.visibility,
    sharedAt: configuration.visibility === "workspace" ? new Date() : null,
  };
}

export function createDrizzleCoworkerChangeRepository(
  database: Database,
): CoworkerChangeRepository {
  return {
    async getCoworker(coworkerId) {
      const row = await database.query.coworker.findFirst({
        where: eq(coworker.id, coworkerId),
      });
      return row ? canonicalCoworkerFromRow(row) : null;
    },

    async listRevisionsAfter(coworkerId, revision) {
      const rows = await database.query.coworkerRevision.findMany({
        where: and(
          eq(coworkerRevision.coworkerId, coworkerId),
          gt(coworkerRevision.revision, revision),
        ),
        orderBy: [asc(coworkerRevision.revision)],
      });
      return rows.map(revisionFromRow);
    },

    async commit(input) {
      return database.transaction(async (tx) => {
        const updated = await tx
          .update(coworker)
          .set({
            ...configurationUpdate(input.configuration),
            configurationRevision: input.revision.revision,
          })
          .where(
            and(
              eq(coworker.id, input.coworkerId),
              eq(coworker.configurationRevision, input.expectedRevision),
            ),
          )
          .returning({ id: coworker.id });
        if (!updated[0]) {
          return false;
        }

        await tx.insert(coworkerRevision).values({
          coworkerId: input.revision.coworkerId,
          revision: input.revision.revision,
          baseRevision: input.revision.baseRevision,
          actorUserId: input.revision.actorUserId,
          actorNameSnapshot: input.revision.actorNameSnapshot,
          actorAvatarSnapshot: input.revision.actorAvatarSnapshot,
          origin: input.revision.origin,
          changedFields: input.revision.changedFields,
          changes: input.revision.changes,
          snapshot: input.revision.snapshot,
          createdAt: input.revision.createdAt,
        });
        return true;
      });
    },
  };
}
