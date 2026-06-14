import { db } from "@bap/db/client";
import { conversation, generation, generationInterrupt } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { requireActiveWorkspaceAccess } from "../workspace-access";

export async function requireConversationAccessInActiveWorkspace(
  userId: string,
  conversationId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv || conv.userId !== userId || conv.workspaceId !== workspaceId) {
    throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
  }

  return { conversation: conv, workspaceId };
}

export async function requireGenerationAccessInActiveWorkspace(
  userId: string,
  generationId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const genRecord = await db.query.generation.findFirst({
    where: eq(generation.id, generationId),
    with: { conversation: true },
  });

  if (
    !genRecord ||
    genRecord.conversation.userId !== userId ||
    genRecord.conversation.workspaceId !== workspaceId
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Generation not found" });
  }

  return { generation: genRecord, workspaceId };
}

export async function requireInterruptAccessInActiveWorkspace(
  userId: string,
  interruptId: string,
  workspaceIdOverride?: string | null,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(userId, workspaceIdOverride);
  const interrupt = await db.query.generationInterrupt.findFirst({
    where: eq(generationInterrupt.id, interruptId),
    columns: {
      id: true,
      conversationId: true,
    },
  });

  const conv = interrupt
    ? await db.query.conversation.findFirst({
        where: and(
          eq(conversation.id, interrupt.conversationId),
          eq(conversation.userId, userId),
          eq(conversation.workspaceId, workspaceId),
        ),
        columns: {
          id: true,
        },
      })
    : null;

  if (!interrupt || !conv) {
    throw new ORPCError("NOT_FOUND", { message: "Interrupt not found" });
  }

  return { interrupt, workspaceId };
}
