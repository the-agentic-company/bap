import { QueueEvents, Worker } from "bullmq";
import {
  closeDaytonaRunawayCleanupQueue,
  createDaytonaRunawayCleanupRedisConnectionOptions,
  daytonaRunawayCleanupQueueName,
  daytonaRunawayCleanupRedisUrl,
  DAYTONA_RUNAWAY_CLEANUP_JOB_NAME,
  DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME,
} from "./daytona-runaway-cleanup-client";
import {
  extractTraceContextFromPayload,
  recordCounter,
  recordHistogram,
  startActiveServerSpan,
  withExtractedTraceContext,
} from "../utils/observability";

export {
  DAYTONA_RUNAWAY_CLEANUP_JOB_NAME,
  DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME,
};
export { getDaytonaRunawayCleanupQueue } from "./daytona-runaway-cleanup-client";

type CleanupJobPayload = Record<string, unknown>;

export function startDaytonaRunawayCleanupQueue() {
  const worker = new Worker<CleanupJobPayload, unknown, string>(
    daytonaRunawayCleanupQueueName,
    async (job) => {
      const startedAt = performance.now();
      const attributes = {
        queue: daytonaRunawayCleanupQueueName,
        job_name: job.name,
        job_id: job.id ?? "unknown",
      };

      return withExtractedTraceContext(extractTraceContextFromPayload(job.data), () =>
        startActiveServerSpan(
          `bullmq ${job.name}`,
          {
            attributes,
          },
          async () => {
            try {
              if (job.name === DAYTONA_RUNAWAY_CLEANUP_JOB_NAME) {
                const { cleanupRunawayDaytonaJobs } = await import("../services/daytona-runaway-cleanup");
                const summary = await cleanupRunawayDaytonaJobs();
                if (
                  summary.stale > 0 ||
                  summary.markedRuntimeDead > 0 ||
                  summary.stopFailed > 0 ||
                  summary.lookupFailed > 0
                ) {
                  console.info("[worker] daytona runaway cleanup summary", summary);
                }
                recordCounter("bap_worker_jobs_total", 1, {
                  ...attributes,
                  status: "ok",
                });
                return;
              }

              if (job.name === DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME) {
                const { cleanupStoppedDaytonaSandboxes } = await import(
                  "../services/daytona-stopped-sandbox-delete"
                );
                const summary = await cleanupStoppedDaytonaSandboxes();
                if (summary.stopped > 0 || summary.deleted > 0 || summary.deleteFailed > 0) {
                  console.info("[worker] daytona stopped sandbox delete summary", summary);
                }
                recordCounter("bap_worker_jobs_total", 1, {
                  ...attributes,
                  status: "ok",
                });
                return;
              }

              throw new Error(`No handler registered for Daytona cleanup job "${job.name}"`);
            } catch (error) {
              recordCounter("bap_worker_jobs_total", 1, {
                ...attributes,
                status: "error",
              });
              throw error;
            } finally {
              recordHistogram(
                "bap_worker_job_duration_ms",
                performance.now() - startedAt,
                attributes,
              );
            }
          },
        ),
      );
    },
    {
      connection: createDaytonaRunawayCleanupRedisConnectionOptions(),
      concurrency: 1,
    },
  );

  const queueEvents = new QueueEvents(daytonaRunawayCleanupQueueName, {
    connection: createDaytonaRunawayCleanupRedisConnectionOptions(),
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[worker] Daytona cleanup job ${jobId} failed: ${failedReason}`);
  });

  worker.on("error", (error) => {
    console.error("[worker] Daytona cleanup worker unhandled error", error);
  });

  worker.on("failed", (job, error) => {
    const id = job?.id ?? "unknown";
    console.error(`[worker] Daytona cleanup job ${id} failed in processor`, error);
  });

  queueEvents.on("error", (error) => {
    console.error("[worker] Daytona cleanup queue events error", error);
  });

  return {
    worker,
    queueEvents,
    queueName: daytonaRunawayCleanupQueueName,
    redisUrl: daytonaRunawayCleanupRedisUrl,
  };
}

export async function stopDaytonaRunawayCleanupQueue(
  worker: Worker,
  queueEvents: QueueEvents,
): Promise<void> {
  const closers: Promise<unknown>[] = [
    worker.close(),
    queueEvents.close(),
    closeDaytonaRunawayCleanupQueue(),
  ];
  await Promise.allSettled(closers);
}
