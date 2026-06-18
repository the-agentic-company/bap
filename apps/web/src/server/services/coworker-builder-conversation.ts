import { conversation, coworker } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";

type BuilderConversationDatabase = {
  query: {
    conversation: {
      findFirst: (args: unknown) => Promise<{
        id: string;
        autoApprove: boolean;
        workspaceId: string | null;
        userId: string;
        type: string;
      } | null>;
    };
  };
  insert: (table: typeof conversation) => {
    values: (values: typeof conversation.$inferInsert) => {
      returning: (fields: { id: typeof conversation.id }) => Promise<Array<{ id: string }>>;
    };
  };
  update: (table: typeof conversation | typeof coworker) => {
    set: (values: unknown) => {
      where: (clause: unknown) => Promise<unknown> | { returning?: unknown };
    };
  };
};

export async function getOrCreateCoworkerBuilderConversation(input: {
  database: BuilderConversationDatabase;
  userId: string;
  workspaceId: string;
  coworker: {
    id: string;
    name: string | null;
    builderConversationId: string | null;
    model: string;
    authSource: ProviderAuthSource | null;
  };
}): Promise<{ conversationId: string }> {
  const wf = input.coworker;

  if (wf.builderConversationId) {
    const existing = await input.database.query.conversation.findFirst({
      where: eq(conversation.id, wf.builderConversationId),
      columns: {
        id: true,
        autoApprove: true,
        workspaceId: true,
        userId: true,
        type: true,
      },
    });
    if (existing) {
      if (existing.autoApprove) {
        await input.database
          .update(conversation)
          .set({ autoApprove: false })
          .where(
            and(
              eq(conversation.id, existing.id),
              eq(conversation.userId, input.userId),
              eq(conversation.workspaceId, input.workspaceId),
              eq(conversation.type, "coworker"),
            ),
          );
      }
      if (
        existing.userId === input.userId &&
        existing.workspaceId === input.workspaceId &&
        existing.type === "coworker"
      ) {
        return { conversationId: existing.id };
      }
    }
  }

  const [created] = await input.database
    .insert(conversation)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: "coworker",
      title: `${wf.name || "Coworker"} – Chat`,
      model: wf.model,
      authSource: wf.authSource,
      autoApprove: false,
    })
    .returning({ id: conversation.id });

  if (!created) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Failed to create conversation",
    });
  }

  await input.database
    .update(coworker)
    .set({ builderConversationId: created.id })
    .where(
      and(
        eq(coworker.id, wf.id),
        eq(coworker.ownerId, input.userId),
        eq(coworker.workspaceId, input.workspaceId),
      ),
    );

  return { conversationId: created.id };
}
