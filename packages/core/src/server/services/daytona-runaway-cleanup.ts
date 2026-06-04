import { Daytona } from "@daytonaio/sdk";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  conversationRuntime,
  coworkerRun,
  coworkerRunEvent,
  generation,
} from "@cmdclaw/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDaytonaClientConfig } from "../sandbox/daytona";
import {
  DAYTONA_RUNAWAY_CLEANUP_JOB_NAME,
  getDaytonaRunawayCleanupQueue,
} from "../queues/daytona-runaway-cleanup-client";
import { generationInterruptService } from "./generation-interrupt-service";

const DAYTONA_RUNAWAY_MAX_IDLE_MS = 25 * 60 * 1000;
const DAYTONA_RUNAWAY_CLEANUP_SCHEDULE = "*/5 * * * *";
const DAYTONA_RUNAWAY_CLEANUP_ERROR_MESSAGE =
  "Runaway job was stopped by the Daytona cleanup worker after no sandbox activity was recorded for over 25 minutes.";

export const DAYTONA_RUNAWAY_CLEANUP_SCHEDULER_ID = "daytona:runaway-cleanup";

type DaytonaSandboxLike = {
  id?: string;
  state?: string;
  lastActivityAt?: string;
  refreshData?: () => Promise<void>;
  stop?: (timeout?: number, force?: boolean) => Promise<void>;
};

function resolveSchedulerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function cleanupRunawayDaytonaJobs(now = new Date()): Promise<{
  scanned: number;
  stale: number;
  stopped: number;
  finalizedAsError: number;
  missingActivity: number;
  skippedNotStarted: number;
  lookupFailed: number;
  stopFailed: number;
}> {
  const candidates = await db
    .select({
      runtimeId: conversationRuntime.id,
      conversationId: conversationRuntime.conversationId,
      sandboxId: conversationRuntime.sandboxId,
      generationId: generation.id,
      coworkerRunId: coworkerRun.id,
    })
    .from(conversationRuntime)
    .innerJoin(generation, eq(generation.id, conversationRuntime.activeGenerationId))
    .leftJoin(coworkerRun, eq(coworkerRun.generationId, generation.id))
    .where(
      and(
        eq(conversationRuntime.status, "active"),
        eq(conversationRuntime.sandboxProvider, "daytona"),
        isNotNull(conversationRuntime.sandboxId),
        eq(generation.status, "running"),
        isNull(generation.completedAt),
      ),
    );

  if (candidates.length === 0) {
    return {
      scanned: 0,
      stale: 0,
      stopped: 0,
      finalizedAsError: 0,
      missingActivity: 0,
      skippedNotStarted: 0,
      lookupFailed: 0,
      stopFailed: 0,
    };
  }

  const daytona = new Daytona(getDaytonaClientConfig());
  let stale = 0;
  let stopped = 0;
  let finalizedAsError = 0;
  let missingActivity = 0;
  let skippedNotStarted = 0;
  let lookupFailed = 0;
  let stopFailed = 0;

  for (const candidate of candidates) {
    const sandboxId = candidate.sandboxId;
    if (!sandboxId) {
      continue;
    }

    let sandbox: DaytonaSandboxLike;
    try {
      sandbox = (await daytona.get(sandboxId)) as DaytonaSandboxLike;
      await sandbox.refreshData?.();
    } catch (error) {
      lookupFailed += 1;
      console.warn("[daytona-runaway-cleanup] Failed to load sandbox", {
        sandboxId,
        generationId: candidate.generationId,
        conversationId: candidate.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if ((sandbox.state ?? "").toLowerCase() !== "started") {
      skippedNotStarted += 1;
      continue;
    }

    const lastActivityAt = parseDate(sandbox.lastActivityAt);
    if (!lastActivityAt) {
      missingActivity += 1;
      continue;
    }

    const idleMs = now.getTime() - lastActivityAt.getTime();
    if (idleMs <= DAYTONA_RUNAWAY_MAX_IDLE_MS) {
      continue;
    }

    stale += 1;

    if (!sandbox.stop) {
      stopFailed += 1;
      console.warn("[daytona-runaway-cleanup] Sandbox did not expose a stop method", {
        sandboxId,
        generationId: candidate.generationId,
        conversationId: candidate.conversationId,
        idleMs,
      });
      continue;
    }

    try {
      await sandbox.stop();
      stopped += 1;
    } catch (error) {
      stopFailed += 1;
      console.warn("[daytona-runaway-cleanup] Failed to stop stale sandbox", {
        sandboxId,
        generationId: candidate.generationId,
        conversationId: candidate.conversationId,
        idleMs,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    await generationInterruptService.cancelInterruptsForGeneration(candidate.generationId);

    await db
      .update(generation)
      .set({
        status: "error",
        pendingApproval: null,
        pendingAuth: null,
        isPaused: false,
        resumeInterruptId: null,
        suspendedAt: null,
        cancelRequestedAt: null,
        errorMessage: DAYTONA_RUNAWAY_CLEANUP_ERROR_MESSAGE,
        completionReason: "runtime_error",
        completedAt: now,
      })
      .where(eq(generation.id, candidate.generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: "error",
      })
      .where(eq(conversation.id, candidate.conversationId));

    if (candidate.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: now,
          errorMessage: DAYTONA_RUNAWAY_CLEANUP_ERROR_MESSAGE,
        })
        .where(eq(coworkerRun.id, candidate.coworkerRunId));

      await db.insert(coworkerRunEvent).values({
        coworkerRunId: candidate.coworkerRunId,
        type: "error",
        payload: {
          message: DAYTONA_RUNAWAY_CLEANUP_ERROR_MESSAGE,
          stage: "daytona_runaway_cleanup",
          sandboxId,
          lastActivityAt: lastActivityAt.toISOString(),
          idleMs,
        },
      });
    }

    await db
      .update(conversationRuntime)
      .set({
        status: "dead",
        sandboxId: null,
        sessionId: null,
        activeGenerationId: null,
      })
      .where(eq(conversationRuntime.id, candidate.runtimeId));

    finalizedAsError += 1;
  }

  return {
    scanned: candidates.length,
    stale,
    stopped,
    finalizedAsError,
    missingActivity,
    skippedNotStarted,
    lookupFailed,
    stopFailed,
  };
}

export async function syncDaytonaRunawayCleanupJob(): Promise<void> {
  const queue = getDaytonaRunawayCleanupQueue();
  await queue.upsertJobScheduler(
    DAYTONA_RUNAWAY_CLEANUP_SCHEDULER_ID,
    {
      pattern: DAYTONA_RUNAWAY_CLEANUP_SCHEDULE,
      tz: resolveSchedulerTimezone(),
    },
    {
      name: DAYTONA_RUNAWAY_CLEANUP_JOB_NAME,
      data: {},
    },
  );
}
