import { generateCoworkerMetadataOnFirstPromptFill } from "@bap/core/server/services/coworker-metadata";
import { coworker } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";

function isBlankMetadataValue(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export async function ensureBuilderCoworkerMetadata(params: {
  context: {
    user: { id: string };
    db: unknown;
  };
  wf: typeof coworker.$inferSelect;
}): Promise<typeof coworker.$inferSelect> {
  const { context, wf } = params;
  const database = context.db as {
    query: {
      coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
    };
    update: (table: typeof coworker) => {
      set: (
        values: Partial<Pick<typeof coworker.$inferInsert, "name" | "description" | "username">>,
      ) => {
        where: (clause: unknown) => {
          returning: () => Promise<Array<typeof coworker.$inferSelect>>;
        };
      };
    };
  };

  if (!wf.builderConversationId || !wf.prompt?.trim()) {
    return wf;
  }

  if (
    !isBlankMetadataValue(wf.name) &&
    !isBlankMetadataValue(wf.description) &&
    !isBlankMetadataValue(wf.username)
  ) {
    return wf;
  }

  const coworkerQueryDatabase = database as {
    query: {
      coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
    };
  };
  const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
    database: coworkerQueryDatabase,
    current: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      username: wf.username,
      prompt: "",
      triggerType: wf.triggerType,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      schedule: wf.schedule ?? null,
      autoApprove: wf.autoApprove,
    },
    next: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      username: wf.username,
      prompt: wf.prompt,
      triggerType: wf.triggerType,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      schedule: wf.schedule ?? null,
      autoApprove: wf.autoApprove,
    },
  });

  if (Object.keys(metadataUpdates).length === 0) {
    return wf;
  }

  const [updated] = await database
    .update(coworker)
    .set(metadataUpdates)
    .where(
      wf.workspaceId
        ? and(
            eq(coworker.id, wf.id),
            eq(coworker.ownerId, context.user.id),
            eq(coworker.workspaceId, wf.workspaceId),
          )
        : and(eq(coworker.id, wf.id), eq(coworker.ownerId, context.user.id)),
    )
    .returning();

  return updated ?? { ...wf, ...metadataUpdates };
}
