import { Queue, type ConnectionOptions } from "bullmq";
import { buildRedisOptions } from "../redis/connection-options";
import { attachTraceContext } from "../utils/observability";

export type QueueJobPayload = Record<string, unknown> & { coworkerId?: string };

const rawQueueName = process.env.BULLMQ_QUEUE_NAME ?? "bap-default";
export const queueName = rawQueueName.replaceAll(":", "-");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const SCHEDULED_COWORKER_JOB_NAME = "coworker:scheduled-trigger";
export const LEGACY_SCHEDULED_COWORKER_JOB_NAME = "workflow:scheduled-trigger";
export const GMAIL_COWORKER_JOB_NAME = "coworker:gmail-trigger";
export const EMAIL_FORWARDED_COWORKER_JOB_NAME = "coworker:email-forwarded-trigger";
export const CHAT_GENERATION_JOB_NAME = "generation:chat-run";
export const COWORKER_GENERATION_JOB_NAME = "generation:coworker-run";
export const GENERATION_APPROVAL_TIMEOUT_JOB_NAME = "generation:approval-timeout";
export const GENERATION_AUTH_TIMEOUT_JOB_NAME = "generation:auth-timeout";
export const GENERATION_PREPARING_STUCK_CHECK_JOB_NAME = "generation:preparing-stuck-check";
export const GENERATION_STALE_REAPER_JOB_NAME = "generation:stale-reaper";
export const PAUSED_SANDBOX_CLEANUP_JOB_NAME = "sandbox:paused-cleanup";
export const CONVERSATION_LOADING_CLEANUP_JOB_NAME = "conversation:loading-cleanup";
export const CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME = "conversation:queued-message-process";
export const SLACK_EVENT_JOB_NAME = "slack:event-callback";
export const DAILY_TELEMETRY_DIGEST_JOB_NAME = "telemetry:daily-digest";
export const FAILURE_ALERT_LINEAR_SYNC_JOB_NAME = "failure-alert:linear-sync";

export function buildQueueJobId(parts: Array<string | number | null | undefined>): string {
  const joined = parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part.length > 0)
    .join("-");
  const normalized = joined.replaceAll(":", "-").replaceAll(/\s+/g, "-").replaceAll(/-+/g, "-");
  return normalized.length > 0 ? normalized : "job";
}

export function createRedisConnectionOptions(): ConnectionOptions {
  return buildRedisOptions(redisUrl, redisOptions) as ConnectionOptions;
}

let queue: Queue<QueueJobPayload, unknown, string> | null = null;

function patchQueueAdd(targetQueue: Queue<QueueJobPayload, unknown, string>): void {
  const queueWithPatchFlag = targetQueue as Queue<QueueJobPayload, unknown, string> & {
    __bapTracedAddPatched?: boolean;
  };
  if (queueWithPatchFlag.__bapTracedAddPatched) {
    return;
  }

  const originalAdd = targetQueue.add.bind(targetQueue);
  targetQueue.add = ((name, data, opts) =>
    originalAdd(name, attachTraceContext(data), opts)) as typeof targetQueue.add;
  queueWithPatchFlag.__bapTracedAddPatched = true;
}

export const getQueue = (): Queue<QueueJobPayload, unknown, string> => {
  if (!queue) {
    queue = new Queue<QueueJobPayload, unknown, string>(queueName, {
      connection: createRedisConnectionOptions(),
    });
    patchQueueAdd(queue);
  }

  return queue;
};

export function getCurrentQueue(): Queue<QueueJobPayload, unknown, string> | null {
  return queue;
}

export async function closeQueue(): Promise<void> {
  if (!queue) {
    return;
  }
  await queue.close();
  queue = null;
}
