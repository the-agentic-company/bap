import { db } from "@cmdclaw/db/client";
import {
  conversation,
  conversationQueuedMessage,
  generation,
  type QueuedMessageAttachment,
} from "@cmdclaw/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  buildQueueJobId,
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
  getQueue,
} from "../../../queues/queue-client";

const QUEUEABLE_CONVERSATION_TYPES = ["chat", "coworker"] as const;

export type UserFileAttachment = { name: string; mimeType: string; dataUrl: string };

export type ConversationQueuedMessageRecord = {
  id: string;
  content: string;
  fileAttachments?: QueuedMessageAttachment[];
  selectedPlatformSkillSlugs?: string[];
  status: "queued" | "processing";
  createdAt: Date;
};

export type StartQueuedConversationTurnInput = {
  conversationId: string;
  userId: string;
  content: string;
  fileAttachments?: UserFileAttachment[];
  selectedPlatformSkillSlugs?: string[];
};

export type StartQueuedConversationTurnResult = {
  generationId: string;
  conversationId: string;
};

export type ConversationTurnQueueDependencies = {
  startGeneration: (
    input: StartQueuedConversationTurnInput,
  ) => Promise<StartQueuedConversationTurnResult>;
};

function formatQueueErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isActiveGenerationStartError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Generation already in progress");
}

export class ConversationTurnQueue {
  constructor(private readonly deps: ConversationTurnQueueDependencies) {}

  async enqueueConversationQueuedMessageProcess(conversationId: string): Promise<void> {
    const queue = getQueue();
    await queue.add(
      CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
      { conversationId },
      {
        jobId: buildQueueJobId([CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME, conversationId]),
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  async enqueueConversationMessage(params: {
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
    replaceExisting?: boolean;
  }): Promise<{ queuedMessageId: string }> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, params.conversationId),
        eq(conversation.userId, params.userId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      throw new Error("Conversation not found");
    }

    if (params.replaceExisting ?? false) {
      await db
        .delete(conversationQueuedMessage)
        .where(
          and(
            eq(conversationQueuedMessage.conversationId, params.conversationId),
            eq(conversationQueuedMessage.userId, params.userId),
            inArray(conversationQueuedMessage.status, ["queued", "failed"]),
          ),
        );
    }

    const [queued] = await db
      .insert(conversationQueuedMessage)
      .values({
        conversationId: params.conversationId,
        userId: params.userId,
        content: params.content,
        fileAttachments: params.fileAttachments,
        selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs,
        status: "queued",
      })
      .returning({ id: conversationQueuedMessage.id });

    await this.enqueueConversationQueuedMessageProcess(params.conversationId);
    return { queuedMessageId: queued.id };
  }

  async listConversationQueuedMessages(
    conversationId: string,
    userId: string,
  ): Promise<ConversationQueuedMessageRecord[]> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, conversationId),
        eq(conversation.userId, userId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      return [];
    }

    const rows = await db.query.conversationQueuedMessage.findMany({
      where: and(
        eq(conversationQueuedMessage.conversationId, conversationId),
        eq(conversationQueuedMessage.userId, userId),
        inArray(conversationQueuedMessage.status, ["queued", "processing"]),
      ),
      orderBy: [asc(conversationQueuedMessage.createdAt)],
      columns: {
        id: true,
        content: true,
        fileAttachments: true,
        selectedPlatformSkillSlugs: true,
        status: true,
        createdAt: true,
      },
    });

    return rows
      .filter(
        (
          row,
        ): row is typeof row & {
          status: "queued" | "processing";
        } => row.status === "queued" || row.status === "processing",
      )
      .map((row) => ({
        id: row.id,
        content: row.content,
        fileAttachments: row.fileAttachments ?? undefined,
        selectedPlatformSkillSlugs: row.selectedPlatformSkillSlugs ?? undefined,
        status: row.status,
        createdAt: row.createdAt,
      }));
  }

  async removeConversationQueuedMessage(
    queuedMessageId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const deleted = await db
      .delete(conversationQueuedMessage)
      .where(
        and(
          eq(conversationQueuedMessage.id, queuedMessageId),
          eq(conversationQueuedMessage.conversationId, conversationId),
          eq(conversationQueuedMessage.userId, userId),
          inArray(conversationQueuedMessage.status, ["queued", "failed"]),
        ),
      )
      .returning({ id: conversationQueuedMessage.id });
    return deleted.length > 0;
  }

  async updateConversationQueuedMessage(params: {
    queuedMessageId: string;
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
  }): Promise<boolean> {
    const updated = await db
      .update(conversationQueuedMessage)
      .set({
        content: params.content,
        fileAttachments: params.fileAttachments ?? null,
        selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs ?? null,
      })
      .where(
        and(
          eq(conversationQueuedMessage.id, params.queuedMessageId),
          eq(conversationQueuedMessage.conversationId, params.conversationId),
          eq(conversationQueuedMessage.userId, params.userId),
          eq(conversationQueuedMessage.status, "queued"),
        ),
      )
      .returning({ id: conversationQueuedMessage.id });
    return updated.length > 0;
  }

  async processConversationQueuedMessages(conversationId: string): Promise<void> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, conversationId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      return;
    }

    const active = await db.query.generation.findFirst({
      where: and(
        eq(generation.conversationId, conversationId),
        inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
      ),
      columns: {
        id: true,
      },
    });

    if (active) {
      return;
    }

    const processNext = async (): Promise<void> => {
      const nextQueued = await db.query.conversationQueuedMessage.findFirst({
        where: and(
          eq(conversationQueuedMessage.conversationId, conversationId),
          eq(conversationQueuedMessage.status, "queued"),
        ),
        orderBy: [asc(conversationQueuedMessage.createdAt)],
        columns: {
          id: true,
        },
      });

      if (!nextQueued) {
        return;
      }

      const [claimed] = await db
        .update(conversationQueuedMessage)
        .set({
          status: "processing",
          processingStartedAt: new Date(),
          errorMessage: null,
        })
        .where(
          and(
            eq(conversationQueuedMessage.id, nextQueued.id),
            eq(conversationQueuedMessage.status, "queued"),
          ),
        )
        .returning({
          id: conversationQueuedMessage.id,
          userId: conversationQueuedMessage.userId,
          content: conversationQueuedMessage.content,
          fileAttachments: conversationQueuedMessage.fileAttachments,
          selectedPlatformSkillSlugs: conversationQueuedMessage.selectedPlatformSkillSlugs,
        });

      if (!claimed) {
        return processNext();
      }

      try {
        const started = await this.deps.startGeneration({
          conversationId,
          userId: claimed.userId,
          content: claimed.content,
          fileAttachments: claimed.fileAttachments ?? undefined,
          selectedPlatformSkillSlugs: claimed.selectedPlatformSkillSlugs ?? undefined,
        });

        await db
          .update(conversationQueuedMessage)
          .set({
            status: "sent",
            generationId: started.generationId,
            sentAt: new Date(),
            processingStartedAt: null,
            errorMessage: null,
          })
          .where(eq(conversationQueuedMessage.id, claimed.id));
        return;
      } catch (error) {
        if (isActiveGenerationStartError(error)) {
          await db
            .update(conversationQueuedMessage)
            .set({
              status: "queued",
              processingStartedAt: null,
              errorMessage: null,
            })
            .where(eq(conversationQueuedMessage.id, claimed.id));
          return;
        }

        await db
          .update(conversationQueuedMessage)
          .set({
            status: "failed",
            processingStartedAt: null,
            errorMessage: formatQueueErrorMessage(error),
          })
          .where(eq(conversationQueuedMessage.id, claimed.id));
        return processNext();
      }
    };

    await processNext();
  }
}
