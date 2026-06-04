import { Queue, type ConnectionOptions } from "bullmq";
import { buildRedisOptions } from "../redis/connection-options";
import { attachTraceContext } from "../utils/observability";

const rawBaseQueueName = process.env.BULLMQ_QUEUE_NAME ?? "cmdclaw-default";
export const daytonaRunawayCleanupQueueName = `${rawBaseQueueName.replaceAll(":", "-")}-daytona-runaway-cleanup`;
export const daytonaRunawayCleanupRedisUrl =
  process.env.REDIS_URL ?? "redis://localhost:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const DAYTONA_RUNAWAY_CLEANUP_JOB_NAME = "daytona:runaway-cleanup";
export const DAYTONA_STOPPED_SANDBOX_DELETE_JOB_NAME = "daytona:stopped-sandbox-delete";

type CleanupJobPayload = Record<string, unknown>;

let queue: Queue<CleanupJobPayload, unknown, string> | null = null;

export function createDaytonaRunawayCleanupRedisConnectionOptions(): ConnectionOptions {
  return buildRedisOptions(daytonaRunawayCleanupRedisUrl, redisOptions) as ConnectionOptions;
}

export function getDaytonaRunawayCleanupQueue(): Queue<
  CleanupJobPayload,
  unknown,
  string
> {
  if (!queue) {
    queue = new Queue<CleanupJobPayload, unknown, string>(daytonaRunawayCleanupQueueName, {
      connection: createDaytonaRunawayCleanupRedisConnectionOptions(),
    });
    patchQueueAdd(queue);
  }

  return queue;
}

export async function closeDaytonaRunawayCleanupQueue(): Promise<void> {
  if (!queue) {
    return;
  }
  await queue.close();
  queue = null;
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
