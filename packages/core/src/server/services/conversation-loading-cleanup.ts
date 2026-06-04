import { db } from "@cmdclaw/db/client";
import { conversation, coworkerRun, generation, message } from "@cmdclaw/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { CONVERSATION_LOADING_CLEANUP_JOB_NAME, getQueue } from "../queues/queue-client";
import { generationInterruptService } from "./generation-interrupt-service";
import { generationLifecyclePolicy } from "./lifecycle-policy";

const CONVERSATION_LOADING_MAX_IDLE_MS =
  generationLifecyclePolicy.explicitPauseRetentionMs / 6;
const STALE_CONVERSATION_LOADING_ERROR_MESSAGE =
  "Generation was marked as stale after no new messages were recorded for over 4 hours.";
export const STALE_LOADING_CONVERSATION_STATUSES = ["generating"] as const;

export const CONVERSATION_LOADING_CLEANUP_SCHEDULER_ID = "conversation:loading-cleanup";

type ConversationGenerationStatus = "idle" | "generating" | "complete" | "error";

function mapGenerationStatusToConversationStatus(
  status: typeof generation.$inferSelect.status,
): ConversationGenerationStatus {
  switch (status) {
    case "running":
      return "generating";
    case "completed":
      return "complete";
    case "error":
      return "error";
    case "cancelled":
      return "idle";
    default:
      return "idle";
  }
}

function resolveSchedulerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
}

export async function cleanupStaleConversationLoadingStates(
  now = new Date(),
): Promise<{
  scanned: number;
  stale: number;
  finalizedRunningAsError: number;
  correctedStatuses: number;
}> {
  const cutoff = new Date(now.getTime() - CONVERSATION_LOADING_MAX_IDLE_MS);
  const candidates = await db.query.conversation.findMany({
    where: inArray(conversation.generationStatus, STALE_LOADING_CONVERSATION_STATUSES),
    columns: {
      id: true,
      currentGenerationId: true,
      updatedAt: true,
    },
  });

  let stale = 0;
  let finalizedRunningAsError = 0;
  let correctedStatuses = 0;

  for (const candidate of candidates) {
    const [latestMessage, currentGeneration] = await Promise.all([
      db.query.message.findFirst({
        where: eq(message.conversationId, candidate.id),
        orderBy: [desc(message.createdAt)],
        columns: {
          createdAt: true,
        },
      }),
      candidate.currentGenerationId
        ? db.query.generation.findFirst({
            where: eq(generation.id, candidate.currentGenerationId),
            columns: {
              id: true,
              status: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const lastActivityAt = latestMessage?.createdAt ?? candidate.updatedAt;
    if (lastActivityAt > cutoff) {
      continue;
    }

    stale += 1;

    if (currentGeneration?.status === "running") {
      await generationInterruptService.cancelInterruptsForGeneration(currentGeneration.id);
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: STALE_CONVERSATION_LOADING_ERROR_MESSAGE,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completedAt: now,
        })
        .where(eq(generation.id, currentGeneration.id));
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: now,
          errorMessage: STALE_CONVERSATION_LOADING_ERROR_MESSAGE,
        })
        .where(eq(coworkerRun.generationId, currentGeneration.id));
      await db
        .update(conversation)
        .set({ generationStatus: "error" })
        .where(eq(conversation.id, candidate.id));
      finalizedRunningAsError += 1;
      continue;
    }

    await db
      .update(conversation)
      .set({
        generationStatus: currentGeneration
          ? mapGenerationStatusToConversationStatus(currentGeneration.status)
          : "idle",
      })
      .where(eq(conversation.id, candidate.id));
    correctedStatuses += 1;
  }

  return {
    scanned: candidates.length,
    stale,
    finalizedRunningAsError,
    correctedStatuses,
  };
}

export async function syncConversationLoadingCleanupJob(): Promise<void> {
  const queue = getQueue();
  await queue.upsertJobScheduler(
    CONVERSATION_LOADING_CLEANUP_SCHEDULER_ID,
    {
      pattern: "0 * * * *",
      tz: resolveSchedulerTimezone(),
    },
    {
      name: CONVERSATION_LOADING_CLEANUP_JOB_NAME,
      data: {},
    },
  );
}
