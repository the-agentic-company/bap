import { QueueEvents, Worker } from "bullmq";
import {
  closeSandboxUsageSnapshotQueue,
  createSandboxUsageSnapshotRedisConnectionOptions,
  sandboxUsageSnapshotQueueName,
  sandboxUsageSnapshotRedisUrl,
  SANDBOX_USAGE_SNAPSHOT_JOB_NAME,
} from "./sandbox-usage-snapshot-client";
import {
  extractTraceContextFromPayload,
  recordCounter,
  recordHistogram,
  startActiveServerSpan,
  withExtractedTraceContext,
} from "../utils/observability";

export { SANDBOX_USAGE_SNAPSHOT_JOB_NAME };
export { getSandboxUsageSnapshotQueue } from "./sandbox-usage-snapshot-client";

type SnapshotJobPayload = Record<string, unknown>;

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
      connection: createSandboxUsageSnapshotRedisConnectionOptions(),
      concurrency: 1,
    },
  );

  const queueEvents = new QueueEvents(sandboxUsageSnapshotQueueName, {
    connection: createSandboxUsageSnapshotRedisConnectionOptions(),
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
  const closers: Promise<unknown>[] = [
    worker.close(),
    queueEvents.close(),
    closeSandboxUsageSnapshotQueue(),
  ];
  await Promise.allSettled(closers);
}
