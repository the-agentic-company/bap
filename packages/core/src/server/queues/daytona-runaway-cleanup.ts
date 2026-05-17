import { Queue, QueueEvents, Worker, type ConnectionOptions } from "bullmq";
import { buildRedisOptions } from "../redis/connection-options";
import {
  attachTraceContext,
  extractTraceContextFromPayload,
  recordCounter,
  recordHistogram,
  startActiveServerSpan,
  withExtractedTraceContext,
} from "../utils/observability";

const rawBaseQueueName = process.env.BULLMQ_QUEUE_NAME ?? "cmdclaw-default";
const daytonaRunawayCleanupQueueName = `${rawBaseQueueName.replaceAll(":", "-")}-daytona-runaway-cleanup`;
const daytonaRunawayCleanupRedisUrl =
  process.env.REDIS_URL ?? "redis://localhost:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const DAYTONA_RUNAWAY_CLEANUP_JOB_NAME = "daytona:runaway-cleanup";
export const DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME = "daytona:stopped-sandbox-delete";

type CleanupJobPayload = Record<string, unknown>;

let queue: Queue<CleanupJobPayload, unknown, string> | null = null;

function createRedisConnectionOptions(): ConnectionOptions {
  return buildRedisOptions(daytonaRunawayCleanupRedisUrl, redisOptions) as ConnectionOptions;
}

export function getDaytonaRunawayCleanupQueue(): Queue<CleanupJobPayload, unknown, string> {
  if (!queue) {
    queue = new Queue<CleanupJobPayload, unknown, string>(daytonaRunawayCleanupQueueName, {
      connection: createRedisConnectionOptions(),
    });
    patchQueueAdd(queue);
  }

  return queue;
}

function patchQueueAdd(targetQueue: Queue<CleanupJobPayload, unknown, string>): void {
  const queueWithPatchFlag = targetQueue as Queue<CleanupJobPayload, unknown, string> & {
    __cmdclawTracedAddPatched?: boolean;
  };
  if (queueWithPatchFlag.__cmdclawTracedAddPatched) {
    return;
  }

  const originalAdd = targetQueue.add.bind(targetQueue);
  targetQueue.add = ((
    name,
    data,
    opts,
  ) => originalAdd(name, attachTraceContext(data), opts)) as typeof targetQueue.add;
  queueWithPatchFlag.__cmdclawTracedAddPatched = true;
}

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
                if (summary.stale > 0 || summary.stopFailed > 0 || summary.lookupFailed > 0) {
                  console.info("[worker] daytona runaway cleanup summary", summary);
                }
                recordCounter("cmdclaw_worker_jobs_total", 1, {
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
                recordCounter("cmdclaw_worker_jobs_total", 1, {
                  ...attributes,
                  status: "ok",
                });
                return;
              }

              throw new Error(`No handler registered for Daytona cleanup job "${job.name}"`);
            } catch (error) {
              recordCounter("cmdclaw_worker_jobs_total", 1, {
                ...attributes,
                status: "error",
              });
              throw error;
            } finally {
              recordHistogram(
                "cmdclaw_worker_job_duration_ms",
                performance.now() - startedAt,
                attributes,
              );
            }
          },
        ),
      );
    },
    {
      connection: createRedisConnectionOptions(),
      concurrency: 1,
    },
  );

  const queueEvents = new QueueEvents(daytonaRunawayCleanupQueueName, {
    connection: createRedisConnectionOptions(),
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
  const closers: Promise<unknown>[] = [worker.close(), queueEvents.close()];
  if (queue) {
    closers.push(queue.close());
    queue = null;
  }
  await Promise.allSettled(closers);
}
