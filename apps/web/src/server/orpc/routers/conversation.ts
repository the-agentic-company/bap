import { writeSessionTranscriptFromConversation } from "@cmdclaw/core/server/services/memory-service";
import { clearConversationSessionSnapshot } from "@cmdclaw/core/server/services/opencode-session-snapshot-service";
import { conversation, message, messageAttachment, sandboxFile } from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { eq, desc, and, isNull, asc, sql, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAppAdminActor } from "../app-admin-access";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";
import { loadOutputHtmlPreview, OutputHtmlPreviewError } from "../../services/output-html-preview";

const conversationListCursorSchema = z.object({
  updatedAt: z.coerce.date(),
  id: z.string().min(1),
  isPinned: z.boolean(),
});

function encodeConversationListCursor(cursor: {
  updatedAt: Date;
  id: string;
  isPinned: boolean;
}): string {
  return JSON.stringify({
    updatedAt: cursor.updatedAt.toISOString(),
    id: cursor.id,
    isPinned: cursor.isPinned,
  });
}

function decodeConversationListCursor(
  cursor: string | undefined,
): z.infer<typeof conversationListCursorSchema> | null {
  if (!cursor) {
    return null;
  }

  try {
    return conversationListCursorSchema.parse(JSON.parse(cursor));
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid conversation list cursor",
    });
  }
}

// List conversations for current user
const list = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const cursor = decodeConversationListCursor(input.cursor);
    const paginationWhere = !cursor
      ? undefined
      : cursor.isPinned
        ? or(
            and(
              eq(conversation.isPinned, true),
              or(
                lt(conversation.updatedAt, cursor.updatedAt),
                and(eq(conversation.updatedAt, cursor.updatedAt), lt(conversation.id, cursor.id)),
              ),
            ),
            eq(conversation.isPinned, false),
          )
        : and(
            eq(conversation.isPinned, false),
            or(
              lt(conversation.updatedAt, cursor.updatedAt),
              and(eq(conversation.updatedAt, cursor.updatedAt), lt(conversation.id, cursor.id)),
            ),
          );

    const conversations = await context.db.query.conversation.findMany({
      where: and(
        eq(conversation.userId, context.user.id),
        eq(conversation.workspaceId, workspaceId),
        eq(conversation.type, "chat"),
        isNull(conversation.archivedAt),
        isNull(conversation.syntheticKind),
        paginationWhere,
      ),
      orderBy: [desc(conversation.isPinned), desc(conversation.updatedAt), desc(conversation.id)],
      limit: input.limit + 1,
      with: {
        messages: {
          columns: { id: true },
        },
      },
    });

    const hasMore = conversations.length > input.limit;
    const items = hasMore ? conversations.slice(0, -1) : conversations;

    return {
      conversations: items.map((c) => ({
        id: c.id,
        title: c.title,
        isPinned: c.isPinned,
        isShared: c.isShared,
        generationStatus: c.generationStatus,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        seenMessageCount: c.seenMessageCount,
      })),
      nextCursor: hasMore
        ? encodeConversationListCursor({
            updatedAt: items[items.length - 1]!.updatedAt,
            id: items[items.length - 1]!.id,
            isPinned: items[items.length - 1]!.isPinned,
          })
        : undefined,
    };
  });

// Get conversation with messages
const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const conv = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.id),
        eq(conversation.userId, context.user.id),
        eq(conversation.workspaceId, workspaceId),
        isNull(conversation.syntheticKind),
      ),
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
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      isPinned: conv.isPinned,
      isShared: conv.isShared,
      shareToken: conv.shareToken,
      model: conv.model,
      authSource: conv.authSource,
      autoApprove: conv.autoApprove,
      messages: conv.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          contentParts: m.contentParts,
          timing: m.timing,
          createdAt: m.createdAt,
          attachments: m.attachments?.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
          sandboxFiles: m.sandboxFiles?.map((f) => ({
            fileId: f.id,
            path: f.path,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
          })),
        })),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  });

const getUsage = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const conv = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.id),
        eq(conversation.userId, context.user.id),
        eq(conversation.workspaceId, workspaceId),
      ),
      columns: {
        id: true,
        usageInputTokens: true,
        usageOutputTokens: true,
        usageTotalTokens: true,
        usageAssistantMessageCount: true,
      },
    });

    if (!conv) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return {
      inputTokens: conv.usageInputTokens,
      outputTokens: conv.usageOutputTokens,
      totalTokens: conv.usageTotalTokens,
      assistantMessageCount: conv.usageAssistantMessageCount,
    };
  });

const getImpersonationTarget = protectedProcedure
  .input(z.object({ conversationId: z.string() }))
  .handler(async ({ input, context }) => {
    await requireAppAdminActor(context);

    const conv = await context.db.query.conversation.findFirst({
      where: eq(conversation.id, input.conversationId),
      columns: {
        id: true,
        title: true,
        userId: true,
      },
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!conv?.userId || !conv.user) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return {
      resourceType: "chat" as const,
      resourceId: conv.id,
      resourceLabel: conv.title,
      owner: {
        id: conv.user.id,
        name: conv.user.name,
        email: conv.user.email,
        image: conv.user.image,
      },
    };
  });

// Update conversation title
const updateTitle = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      title: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const result = await context.db
      .update(conversation)
      .set({ title: input.title })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Update conversation pinned setting
const updatePinned = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      isPinned: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const result = await context.db
      .update(conversation)
      .set({ isPinned: input.isPinned })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({
        id: conversation.id,
        isPinned: conversation.isPinned,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, isPinned: result[0].isPinned };
  });

// Mark conversation as seen up to a given message count
const markSeen = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      seenMessageCount: z.number().int().min(0),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const existing = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.id),
        eq(conversation.userId, context.user.id),
        eq(conversation.workspaceId, workspaceId),
        eq(conversation.type, "chat"),
      ),
      columns: {
        id: true,
        seenMessageCount: true,
      },
    });

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    if (input.seenMessageCount <= existing.seenMessageCount) {
      return { success: true, seenMessageCount: existing.seenMessageCount };
    }

    const result = await context.db
      .update(conversation)
      .set({ seenMessageCount: input.seenMessageCount })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({
        seenMessageCount: conversation.seenMessageCount,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, seenMessageCount: result[0].seenMessageCount };
  });

// Mark all user chat conversations as seen up to their current message count
const markAllSeen = protectedProcedure.input(z.object({})).handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id);
  const result = await context.db.execute(sql`
    with message_counts as (
      select
        ${message.conversationId} as "conversationId",
        count(*)::int as "messageCount"
      from ${message}
      group by ${message.conversationId}
    ),
    updated as (
      update ${conversation} as c
      set seen_message_count = message_counts."messageCount"
      from message_counts
      where c.id = message_counts."conversationId"
        and c.user_id = ${context.user.id}
        and c.workspace_id = ${workspaceId}
        and c.type = 'chat'
        and c.archived_at is null
        and c.seen_message_count < message_counts."messageCount"
      returning c.id
    )
    select count(*)::int as "updatedCount" from updated
  `);

  const rows = (result.rows ?? []) as Array<{ updatedCount: number }>;
  return {
    success: true,
    updatedCount: rows[0]?.updatedCount ?? 0,
  };
});

// Update conversation auto-approve setting
const updateAutoApprove = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      autoApprove: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const result = await context.db
      .update(conversation)
      .set({ autoApprove: input.autoApprove })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({
        id: conversation.id,
        autoApprove: conversation.autoApprove,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, autoApprove: result[0].autoApprove };
  });

// Share conversation via public link
const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const result = await context.db
      .update(conversation)
      .set({
        isShared: true,
        shareToken: randomUUID(),
        sharedAt: new Date(),
      })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
        ),
      )
      .returning({ shareToken: conversation.shareToken });

    if (result.length === 0 || !result[0].shareToken) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, shareToken: result[0].shareToken };
  });

// Unshare conversation and invalidate existing link
const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const result = await context.db
      .update(conversation)
      .set({
        isShared: false,
        shareToken: null,
        sharedAt: null,
      })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
        ),
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Archive conversation
const archive = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    try {
      await writeSessionTranscriptFromConversation({
        userId: context.user.id,
        conversationId: input.id,
        source: "archive",
        messageLimit: 15,
      });
    } catch (err) {
      console.error("[Conversation] Failed to write session transcript on archive:", err);
    }

    const result = await context.db
      .update(conversation)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Delete conversation
const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    try {
      await writeSessionTranscriptFromConversation({
        userId: context.user.id,
        conversationId: input.id,
        source: "delete",
        messageLimit: 15,
      });
    } catch (err) {
      console.error("[Conversation] Failed to write session transcript on delete:", err);
    }

    try {
      await clearConversationSessionSnapshot(input.id);
    } catch (err) {
      console.error("[Conversation] Failed to clear session snapshot on delete:", err);
    }

    const result = await context.db
      .delete(conversation)
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Download attachment (returns presigned URL)
const downloadAttachment = protectedProcedure
  .input(z.object({ attachmentId: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    // Find the attachment and verify ownership
    const attachment = await context.db.query.messageAttachment.findFirst({
      where: eq(messageAttachment.id, input.attachmentId),
      with: {
        message: {
          with: {
            conversation: true,
          },
        },
      },
    });

    if (
      !attachment ||
      attachment.message.conversation.userId !== context.user.id ||
      attachment.message.conversation.workspaceId !== workspaceId
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
    }

    const { getPresignedDownloadUrl } = await import("@cmdclaw/core/server/storage/s3-client");
    const url = await getPresignedDownloadUrl(attachment.storageKey);

    return {
      url,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    };
  });

// Download sandbox file (returns presigned URL)
const downloadSandboxFile = protectedProcedure
  .input(z.object({ fileId: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    // Find the sandbox file and verify ownership
    const file = await context.db.query.sandboxFile.findFirst({
      where: eq(sandboxFile.id, input.fileId),
      with: {
        conversation: true,
      },
    });

    if (
      !file ||
      file.conversation.userId !== context.user.id ||
      file.conversation.workspaceId !== workspaceId
    ) {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    if (!file.storageKey) {
      throw new ORPCError("NOT_FOUND", { message: "File not uploaded" });
    }

    const { getPresignedDownloadUrl } = await import("@cmdclaw/core/server/storage/s3-client");
    const url = await getPresignedDownloadUrl(file.storageKey);

    return {
      url,
      filename: file.filename,
      mimeType: file.mimeType,
      path: file.path,
      sizeBytes: file.sizeBytes,
    };
  });

const previewSandboxOutputHtml = protectedProcedure
  .input(z.object({ fileId: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const file = await context.db.query.sandboxFile.findFirst({
      where: eq(sandboxFile.id, input.fileId),
      with: {
        conversation: true,
      },
    });

    try {
      return await loadOutputHtmlPreview({
        file,
        userId: context.user.id,
        workspaceId,
      });
    } catch (error) {
      if (error instanceof OutputHtmlPreviewError) {
        if (error.code === "not_found" || error.code === "missing_storage") {
          throw new ORPCError("NOT_FOUND", { message: error.message });
        }
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
  });

// Get sandbox files for a conversation
const getSandboxFiles = protectedProcedure
  .input(z.object({ conversationId: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    // Verify ownership
    const conv = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, context.user.id),
        eq(conversation.workspaceId, workspaceId),
      ),
    });

    if (!conv) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    const files = await context.db.query.sandboxFile.findMany({
      where: eq(sandboxFile.conversationId, input.conversationId),
      orderBy: asc(sandboxFile.createdAt),
    });

    return {
      files: files.map((f) => ({
        id: f.id,
        path: f.path,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        messageId: f.messageId,
        createdAt: f.createdAt,
      })),
    };
  });

const adminGetWorkspaceConversation = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAdmin(context.user.id);
    const conv = await context.db.query.conversation.findFirst({
      where: and(eq(conversation.id, input.id), eq(conversation.workspaceId, workspaceId)),
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
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      userId: conv.userId,
      workspaceId: conv.workspaceId,
      model: conv.model,
      authSource: conv.authSource,
      autoApprove: conv.autoApprove,
      messages: conv.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          contentParts: m.contentParts,
          timing: m.timing,
          createdAt: m.createdAt,
          attachments: m.attachments?.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
          sandboxFiles: m.sandboxFiles?.map((f) => ({
            fileId: f.id,
            path: f.path,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
          })),
        })),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  });

export const conversationRouter = {
  list,
  get,
  getUsage,
  getImpersonationTarget,
  updateTitle,
  updatePinned,
  markSeen,
  markAllSeen,
  updateAutoApprove,
  share,
  unshare,
  archive,
  delete: del,
  downloadAttachment,
  downloadSandboxFile,
  previewSandboxOutputHtml,
  getSandboxFiles,
  adminGetWorkspaceConversation,
};
