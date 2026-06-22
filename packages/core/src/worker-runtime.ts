import { closePool } from "@bap/db/client";
import {
  buildQueueJobId,
  CONVERSATION_LOADING_CLEANUP_JOB_NAME,
  GENERATION_STALE_REAPER_JOB_NAME,
  PAUSED_SANDBOX_CLEANUP_JOB_NAME,
  getQueue,
  startQueues,
  stopQueues,
} from "./server/queues";
import {
  closeDaytonaRunawayCleanupQueue,
} from "./server/queues/daytona-runaway-cleanup-client";
import {
  startSandboxUsageSnapshotQueue,
  stopSandboxUsageSnapshotQueue,
} from "./server/queues/sandbox-usage-snapshot";
import { syncConversationLoadingCleanupJob } from "./server/services/conversation-loading-cleanup";
import { syncDaytonaRunawayCleanupJob } from "./server/services/daytona-runaway-cleanup";
import { syncStoppedDaytonaSandboxDeleteJob } from "./server/services/daytona-stopped-sandbox-delete";
import { syncSandboxUsageSnapshotJob } from "./server/services/sandbox-usage-snapshot";
import { reconcileScheduledCoworkerJobs } from "./server/services/coworker-scheduler";
import { syncDailyTelemetryDigestJob } from "./server/services/telemetry-digest";

export async function startWorkerRuntime(): Promise<void> {
  const {
    worker,
    queueEvents,
    queueName,
    redisUrl,
  } = startQueues();
  const {
    worker: sandboxSnapshotWorker,
    queueEvents: sandboxSnapshotQueueEvents,
    queueName: sandboxSnapshotQueueName,
    redisUrl: sandboxSnapshotRedisUrl,
  } = startSandboxUsageSnapshotQueue();
  const staleReaperIntervalMs = 10 * 60 * 1000;
  const pausedSandboxCleanupIntervalMs = 60 * 60 * 1000;
  let staleReaperInterval: ReturnType<typeof setInterval> | null = null;
  let pausedSandboxCleanupInterval: ReturnType<typeof setInterval> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  async function enqueueStaleGenerationReaperJob(): Promise<void> {
    const queue = getQueue();
    await queue.add(
      GENERATION_STALE_REAPER_JOB_NAME,
      {},
      {
        jobId: buildQueueJobId([GENERATION_STALE_REAPER_JOB_NAME, Date.now()]),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  async function enqueuePausedSandboxCleanupJob(): Promise<void> {
    const queue = getQueue();
    await queue.add(
      PAUSED_SANDBOX_CLEANUP_JOB_NAME,
      {},
      {
        jobId: buildQueueJobId([PAUSED_SANDBOX_CLEANUP_JOB_NAME, Date.now()]),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  async function enqueueConversationLoadingCleanupJob(): Promise<void> {
    const queue = getQueue();
    await queue.add(
      CONVERSATION_LOADING_CLEANUP_JOB_NAME,
      {},
      {
        jobId: buildQueueJobId([CONVERSATION_LOADING_CLEANUP_JOB_NAME, Date.now()]),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  const shutdown = async () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.log("[worker] shutting down...");

      if (staleReaperInterval) {
        clearInterval(staleReaperInterval);
        staleReaperInterval = null;
      }
      if (pausedSandboxCleanupInterval) {
        clearInterval(pausedSandboxCleanupInterval);
        pausedSandboxCleanupInterval = null;
      }
      await Promise.allSettled([
        stopQueues(worker, queueEvents),
        closeDaytonaRunawayCleanupQueue(),
        stopSandboxUsageSnapshotQueue(sandboxSnapshotWorker, sandboxSnapshotQueueEvents),
        closePool(),
      ]);
    })();

    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log(`[worker] listening on "${queueName}" with redis "${redisUrl}"`);
  console.log(
    `[worker] Sandbox usage snapshot listening on "${sandboxSnapshotQueueName}" with redis "${sandboxSnapshotRedisUrl}"`,
  );

  try {
    const { synced, failed } = await reconcileScheduledCoworkerJobs();
    console.log(`[worker] reconciled scheduled coworkers: ${synced} synced, ${failed} failed`);
  } catch (error) {
    console.error("[worker] failed to reconcile scheduled coworkers", error);
  }

  try {
    await syncDailyTelemetryDigestJob();
    console.log("[worker] synced daily telemetry digest schedule");
  } catch (error) {
    console.error("[worker] failed to sync daily telemetry digest schedule", error);
  }

  try {
    await syncConversationLoadingCleanupJob();
    console.log("[worker] synced conversation loading cleanup schedule");
  } catch (error) {
    console.error("[worker] failed to sync conversation loading cleanup schedule", error);
  }

  try {
    await syncDaytonaRunawayCleanupJob();
    console.log("[worker] removed Daytona runaway cleanup schedule");
  } catch (error) {
    console.error("[worker] failed to remove Daytona runaway cleanup schedule", error);
  }

  try {
    await syncStoppedDaytonaSandboxDeleteJob();
    console.log("[worker] removed Daytona stopped sandbox delete schedule");
  } catch (error) {
    console.error("[worker] failed to remove Daytona stopped sandbox delete schedule", error);
  }

  try {
    await syncSandboxUsageSnapshotJob();
    console.log("[worker] synced sandbox usage snapshot schedule");
  } catch (error) {
    console.error("[worker] failed to sync sandbox usage snapshot schedule", error);
  }

  try {
    await enqueueStaleGenerationReaperJob();
  } catch (error) {
    console.error("[worker] failed to enqueue stale generation reaper job", error);
  }

  staleReaperInterval = setInterval(() => {
    void enqueueStaleGenerationReaperJob().catch((error) => {
      console.error("[worker] failed to enqueue stale generation reaper job", error);
    });
  }, staleReaperIntervalMs);

  try {
    await enqueuePausedSandboxCleanupJob();
  } catch (error) {
    console.error("[worker] failed to enqueue paused sandbox cleanup job", error);
  }

  pausedSandboxCleanupInterval = setInterval(() => {
    void enqueuePausedSandboxCleanupJob().catch((error) => {
      console.error("[worker] failed to enqueue paused sandbox cleanup job", error);
    });
  }, pausedSandboxCleanupIntervalMs);

  try {
    await enqueueConversationLoadingCleanupJob();
  } catch (error) {
    console.error("[worker] failed to enqueue conversation loading cleanup job", error);
  }

}
