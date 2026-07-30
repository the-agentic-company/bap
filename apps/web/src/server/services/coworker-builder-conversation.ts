import { conversation, coworkerBuilderChat } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";

type BuilderConversationDatabase = typeof import("@bap/db/client").db;

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
  const association = await input.database.query.coworkerBuilderChat.findFirst({
    where: and(
      eq(coworkerBuilderChat.coworkerId, wf.id),
      eq(coworkerBuilderChat.userId, input.userId),
    ),
    columns: { conversationId: true },
  });
  const associatedConversationId = association?.conversationId ?? wf.builderConversationId;

  if (associatedConversationId) {
    const existing = await input.database.query.conversation.findFirst({
      where: eq(conversation.id, associatedConversationId),
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
        if (!association) {
          await input.database.insert(coworkerBuilderChat).values({
            coworkerId: wf.id,
            userId: input.userId,
            conversationId: existing.id,
          });
        }
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

  await input.database.insert(coworkerBuilderChat).values({
    coworkerId: wf.id,
    userId: input.userId,
    conversationId: created.id,
  });

  return { conversationId: created.id };
}
