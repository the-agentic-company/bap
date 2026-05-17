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
const sandboxUsageSnapshotQueueName = `${rawBaseQueueName.replaceAll(":", "-")}-sandbox-usage-snapshot`;
const sandboxUsageSnapshotRedisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const SANDBOX_USAGE_SNAPSHOT_JOB_NAME = "sandbox:usage-snapshot";

type SnapshotJobPayload = Record<string, unknown>;

let queue: Queue<SnapshotJobPayload, unknown, string> | null = null;

function createRedisConnectionOptions(): ConnectionOptions {
  return buildRedisOptions(sandboxUsageSnapshotRedisUrl, redisOptions) as ConnectionOptions;
}

export function getSandboxUsageSnapshotQueue(): Queue<SnapshotJobPayload, unknown, string> {
  if (!queue) {
    queue = new Queue<SnapshotJobPayload, unknown, string>(sandboxUsageSnapshotQueueName, {
      connection: createRedisConnectionOptions(),
    });
    patchQueueAdd(queue);
  }

  return queue;
}

function patchQueueAdd(targetQueue: Queue<SnapshotJobPayload, unknown, string>): void {
  const queueWithPatchFlag = targetQueue as Queue<SnapshotJobPayload, unknown, string> & {
    __cmdclawTracedAddPatched?: boolean;
  };
  if (queueWithPatchFlag.__cmdclawTracedAddPatched) {
    return;
  }

  const originalAdd = targetQueue.add.bind(targetQueue);
  targetQueue.add = ((name, data, opts) =>
    originalAdd(name, attachTraceContext(data), opts)) as typeof targetQueue.add;
  queueWithPatchFlag.__cmdclawTracedAddPatched = true;
}

export function startSandboxUsageSnapshotQueue() {
  const worker = new Worker<SnapshotJobPayload, unknown, string>(
    sandboxUsageSnapshotQueueName,
    async (job) => {
      const startedAt = performance.now();
      const attributes = {
        queue: sandboxUsageSnapshotQueueName,
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
              if (job.name === SANDBOX_USAGE_SNAPSHOT_JOB_NAME) {
                const { collectSandboxUsageSnapshot } = await import(
                  "../services/sandbox-usage-snapshot"
                );
                const summary = await collectSandboxUsageSnapshot();
                if (summary.inserted > 0 || summary.failed > 0) {
                  console.info("[worker] sandbox usage snapshot summary", summary);
                }
                recordCounter("cmdclaw_worker_jobs_total", 1, {
                  ...attributes,
                  status: "ok",
                });
                return;
              }

              throw new Error(`No handler registered for sandbox usage snapshot job "${job.name}"`);
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

  const queueEvents = new QueueEvents(sandboxUsageSnapshotQueueName, {
    connection: createRedisConnectionOptions(),
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[worker] Sandbox usage snapshot job ${jobId} failed: ${failedReason}`);
  });

  worker.on("error", (error) => {
    console.error("[worker] Sandbox usage snapshot worker unhandled error", error);
  });

  worker.on("failed", (job, error) => {
    const id = job?.id ?? "unknown";
    console.error(`[worker] Sandbox usage snapshot job ${id} failed in processor`, error);
  });

  queueEvents.on("error", (error) => {
    console.error("[worker] Sandbox usage snapshot queue events error", error);
  });

  return {
    worker,
    queueEvents,
    queueName: sandboxUsageSnapshotQueueName,
    redisUrl: sandboxUsageSnapshotRedisUrl,
  };
}

export async function stopSandboxUsageSnapshotQueue(
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
