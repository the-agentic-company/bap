import { getPresignedDownloadUrl } from "@cmdclaw/core/server/storage/s3-client";
import { db } from "@cmdclaw/db/client";
import { conversation, message } from "@cmdclaw/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { PersistedConversationMessage } from "@/components/chat/persisted-message-mapper";

export type SharedConversation = {
  title: string;
  messages: PersistedConversationMessage[];
};

/**
 * Loads a publicly shared conversation by its share token.
 *
 * Framework-neutral data layer for the `/shared/$shareToken` route. Mirrors the original
 * previous server component: it reads the conversation only when it is flagged `isShared`,
 * keeps the visible user/assistant turns, and resolves presigned download URLs for
 * attachments and sandbox files. Returns `null` when the token does not match a shared
 * conversation so the route can surface its not-found boundary.
 */
export async function getSharedConversationByToken(
  shareToken: string,
): Promise<SharedConversation | null> {
  const conv = await db.query.conversation.findFirst({
    where: and(eq(conversation.shareToken, shareToken), eq(conversation.isShared, true)),
    with: {
      messages: {
        orderBy: asc(message.createdAt),
        with: {
          attachments: true,
          sandboxFiles: true,
        },
      },
    },
  });

  if (!conv) {
    return null;
  }

  const visibleMessages = conv.messages.filter((m) => m.role === "user" || m.role === "assistant");

  const sharedMessages = await Promise.all(
    visibleMessages.map(async (msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      contentParts: msg.contentParts,
      timing: msg.timing,
      attachments: await Promise.all(
        (msg.attachments ?? []).map(async (attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          dataUrl: await getPresignedDownloadUrl(attachment.storageKey),
        })),
      ),
      sandboxFiles: await Promise.all(
        (msg.sandboxFiles ?? []).map(async (file) => ({
          fileId: file.id,
          path: file.path,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          downloadUrl: file.storageKey ? await getPresignedDownloadUrl(file.storageKey) : null,
        })),
      ),
    })),
  );

  return {
    title: conv.title ?? "Shared conversation",
    messages: sharedMessages,
  };
}
