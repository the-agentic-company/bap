import { Queue, type ConnectionOptions } from "bullmq";
import { buildRedisOptions } from "../redis/connection-options";
import { attachTraceContext } from "../utils/observability";

const rawBaseQueueName = process.env.BULLMQ_QUEUE_NAME ?? "cmdclaw-default";
export const sandboxUsageSnapshotQueueName = `${rawBaseQueueName.replaceAll(":", "-")}-sandbox-usage-snapshot`;
export const sandboxUsageSnapshotRedisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const SANDBOX_USAGE_SNAPSHOT_JOB_NAME = "sandbox:usage-snapshot";

type SnapshotJobPayload = Record<string, unknown>;

let queue: Queue<SnapshotJobPayload, unknown, string> | null = null;

export function createSandboxUsageSnapshotRedisConnectionOptions(): ConnectionOptions {
  return buildRedisOptions(sandboxUsageSnapshotRedisUrl, redisOptions) as ConnectionOptions;
}

export function getSandboxUsageSnapshotQueue(): Queue<SnapshotJobPayload, unknown, string> {
  if (!queue) {
    queue = new Queue<SnapshotJobPayload, unknown, string>(sandboxUsageSnapshotQueueName, {
      connection: createSandboxUsageSnapshotRedisConnectionOptions(),
    });
    patchQueueAdd(queue);
  }

  return queue;
}

export async function closeSandboxUsageSnapshotQueue(): Promise<void> {
  if (!queue) {
    return;
  }
  await queue.close();
  queue = null;
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
