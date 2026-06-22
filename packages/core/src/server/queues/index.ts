import { QueueEvents, Worker, type Processor } from "bullmq";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "../../lib/email-forwarding";
import { processForwardedEmailEvent } from "../services/coworker-email-forwarding";
import {
  isCoworkerRunBacklogAutoDisableError,
  isDisabledCoworkerTriggerError,
  triggerCoworkerRun,
} from "../services/coworker-service";
import { syncFailureAlertGroupToLinear } from "../services/failure-alert-linear-sync-service";
import {
  CHAT_GENERATION_JOB_NAME,
  CONVERSATION_LOADING_CLEANUP_JOB_NAME,
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
  COWORKER_GENERATION_JOB_NAME,
  DAILY_TELEMETRY_DIGEST_JOB_NAME,
  EMAIL_FORWARDED_COWORKER_JOB_NAME,
  FAILURE_ALERT_LINEAR_SYNC_JOB_NAME,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  GENERATION_STALE_REAPER_JOB_NAME,
  GMAIL_COWORKER_JOB_NAME,
  LEGACY_SCHEDULED_COWORKER_JOB_NAME,
  PAUSED_SANDBOX_CLEANUP_JOB_NAME,
  SCHEDULED_COWORKER_JOB_NAME,
  SLACK_EVENT_JOB_NAME,
  closeQueue,
  createRedisConnectionOptions,
  getCurrentQueue,
  getQueue,
  queueName,
  redisUrl,
  type QueueJobPayload,
} from "./queue-client";
import {
  extractTraceContextFromPayload,
  registerObservableGauge,
  recordCounter,
  recordHistogram,
  startActiveServerSpan,
  withExtractedTraceContext,
  withTraceIdContext,
} from "../utils/observability";

export {
  CHAT_GENERATION_JOB_NAME,
  CONVERSATION_LOADING_CLEANUP_JOB_NAME,
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
  COWORKER_GENERATION_JOB_NAME,
  DAILY_TELEMETRY_DIGEST_JOB_NAME,
  EMAIL_FORWARDED_COWORKER_JOB_NAME,
  FAILURE_ALERT_LINEAR_SYNC_JOB_NAME,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  GENERATION_STALE_REAPER_JOB_NAME,
  GMAIL_COWORKER_JOB_NAME,
  LEGACY_SCHEDULED_COWORKER_JOB_NAME,
  PAUSED_SANDBOX_CLEANUP_JOB_NAME,
  SCHEDULED_COWORKER_JOB_NAME,
  SLACK_EVENT_JOB_NAME,
  buildQueueJobId,
  getQueue,
  queueName,
  redisUrl,
} from "./queue-client";

type JobPayload = QueueJobPayload;
type JobHandler = Processor<JobPayload, unknown, string>;
type QueueMetricSnapshot = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeSeconds: number;
};

function resolveGenerationRunMode(value: unknown): "normal_run" | "recovery_reattach" {
  return value === "recovery_reattach" ? "recovery_reattach" : "normal_run";
}

function isActiveCoworkerRunConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };

  return (
    maybeError.code === "BAD_REQUEST" &&
    maybeError.status === 400 &&
    typeof maybeError.message === "string" &&
    maybeError.message.includes("Coworker already has an active run")
  );
}

function isSkippedCoworkerTriggerError(error: unknown): boolean {
  return (
    isActiveCoworkerRunConflict(error) ||
    isDisabledCoworkerTriggerError(error) ||
    isCoworkerRunBacklogAutoDisableError(error)
  );
}

function formatSkippedCoworkerTriggerReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return String(error);
}

const handlers: Record<string, JobHandler> = {
  [SCHEDULED_COWORKER_JOB_NAME]: handleScheduledCoworkerJob,
  [LEGACY_SCHEDULED_COWORKER_JOB_NAME]: handleScheduledCoworkerJob,
  [GMAIL_COWORKER_JOB_NAME]: async (job) => {
    const coworkerId = job.data?.coworkerId;
    if (!coworkerId || typeof coworkerId !== "string") {
      throw new Error(`Missing coworkerId in gmail job "${job.id}"`);
    }

    try {
      return await triggerCoworkerRun({
        coworkerId,
        triggerPayload: job.data?.triggerPayload ?? {},
        startKind: "external_trigger",
      });
    } catch (error) {
      if (isSkippedCoworkerTriggerError(error)) {
        console.warn(
          `[worker] skipped gmail coworker trigger for coworker ${coworkerId}: ${formatSkippedCoworkerTriggerReason(error)}`,
        );
        return;
      }
      throw error;
    }
  },
  [EMAIL_FORWARDED_COWORKER_JOB_NAME]: async (job) => {
    try {
      console.info("[worker] received forwarded-email job", {
        jobId: job.id ?? null,
        webhookId:
          typeof job.data?.webhookId === "string" && job.data.webhookId.length > 0
            ? job.data.webhookId
            : null,
        eventType:
          typeof (job.data as { event?: { type?: unknown } })?.event?.type === "string"
            ? ((job.data as { event?: { type?: string } }).event?.type ?? null)
            : null,
      });
      await processForwardedEmailEvent(
        job.data as Parameters<typeof processForwardedEmailEvent>[0],
      );
    } catch (error) {
      if (isSkippedCoworkerTriggerError(error)) {
        console.warn(
          `[worker] skipped forwarded email trigger (source: ${EMAIL_FORWARDED_TRIGGER_TYPE}): ${formatSkippedCoworkerTriggerReason(error)}`,
        );
        return;
      }
      throw error;
    }
  },
  [CHAT_GENERATION_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in chat generation job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.runQueuedGeneration(
      generationId,
      resolveGenerationRunMode(job.data?.runMode),
    );
  },
  [COWORKER_GENERATION_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in coworker generation job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.runQueuedGeneration(
      generationId,
      resolveGenerationRunMode(job.data?.runMode),
    );
  },
  [GENERATION_APPROVAL_TIMEOUT_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in approval timeout job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.processGenerationTimeout(generationId, "approval");
  },
  [GENERATION_AUTH_TIMEOUT_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in auth timeout job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.processGenerationTimeout(generationId, "auth");
  },
  [GENERATION_PREPARING_STUCK_CHECK_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in preparing-stuck-check job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.processPreparingStuckCheck(generationId);
  },
  [GENERATION_STALE_REAPER_JOB_NAME]: async () => {
    const { generationManager } = await import("../services/generation-manager");
    const summary = await generationManager.reapStaleGenerations();
    if (summary.stale > 0) {
      console.warn(
        `[worker] stale generation reaper finalized ${summary.stale} generation(s) (${summary.finalizedRunningAsError} running as error, ${summary.finalizedWaitingAsError} waiting as error)`,
      );
    }
  },
  [PAUSED_SANDBOX_CLEANUP_JOB_NAME]: async () => {
    const { cleanupPausedSandboxes } = await import("../services/paused-sandbox-cleanup");
    const summary = await cleanupPausedSandboxes();
    if (summary.cleaned > 0 || summary.skippedWithActiveLease > 0) {
      console.info("[worker] paused sandbox cleanup summary", summary);
    }
  },
  [CONVERSATION_LOADING_CLEANUP_JOB_NAME]: async () => {
    const { cleanupStaleConversationLoadingStates } =
      await import("../services/conversation-loading-cleanup");
    const summary = await cleanupStaleConversationLoadingStates();
    if (summary.stale > 0) {
      console.warn("[worker] stale conversation loading cleanup summary", summary);
    }
  },
  [CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME]: async (job) => {
    const conversationId = job.data?.conversationId;
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error(`Missing conversationId in queued message process job "${job.id}"`);
    }

    const { generationManager } = await import("../services/generation-manager");
    await generationManager.processConversationQueuedMessages(conversationId);
  },
  [SLACK_EVENT_JOB_NAME]: async (job) => {
    const payload = job.data?.payload;
    if (!payload || typeof payload !== "object") {
      throw new Error(`Missing payload in slack event job "${job.id}"`);
    }
    const { handleSlackEvent } = await import("../services/slack-bot");
    await handleSlackEvent(payload as Parameters<typeof handleSlackEvent>[0]);
  },
  [DAILY_TELEMETRY_DIGEST_JOB_NAME]: async () => {
    const { postDailyTelemetryDigest } = await import("../services/telemetry-digest");
    const summary = await postDailyTelemetryDigest();
    console.info("[worker] posted daily telemetry digest", summary);
  },
  [FAILURE_ALERT_LINEAR_SYNC_JOB_NAME]: async (job) => {
    const groupId = job.data?.groupId;
    if (!groupId || typeof groupId !== "string") {
      throw new Error(`Missing groupId in failure alert Linear sync job "${job.id}"`);
    }

    const result = await syncFailureAlertGroupToLinear({ groupId });
    console.info("[worker] synced failure alert group to Linear", {
      groupId,
      ...result,
    });
  },
};

export async function handleScheduledCoworkerJob(job: Parameters<JobHandler>[0]) {
  const coworkerId = job.data?.coworkerId;
  if (!coworkerId || typeof coworkerId !== "string") {
    throw new Error(`Missing coworkerId in scheduled job "${job.id}"`);
  }

  const scheduleType =
    typeof job.data?.scheduleType === "string" ? job.data.scheduleType : "unknown";

  try {
    return await triggerCoworkerRun({
      coworkerId,
      startKind: "external_trigger",
      triggerPayload: {
        source: "schedule",
        coworkerId,
        scheduleType,
        scheduledFor: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (isSkippedCoworkerTriggerError(error)) {
      console.warn(
        `[worker] skipped scheduled coworker trigger for coworker ${coworkerId}: ${formatSkippedCoworkerTriggerReason(error)}`,
      );
      return;
    }
    throw error;
  }
}

const processor: Processor<JobPayload, unknown, string> = async (job) => {
  const handler = handlers[job.name];

  if (!handler) {
    throw new Error(`No handler registered for job "${job.name}"`);
  }

  const startedAt = performance.now();
  const attributes = {
    queue: queueName,
    job_name: job.name,
    job_id: job.id ?? "unknown",
    attempts_made: job.attemptsMade,
  };

  const durableTraceId = typeof job.data?.traceId === "string" ? job.data.traceId : undefined;
  const runWithSpan = () =>
    startActiveServerSpan(
      `bullmq ${job.name}`,
      {
        attributes,
      },
      async () => {
        try {
          const result = await handler(job);
          recordCounter(
            "bap_worker_jobs_total",
            1,
            {
              ...attributes,
              status: "ok",
            },
            "Count of BullMQ jobs processed by the Bap worker.",
          );
          return result;
        } catch (error) {
          recordCounter(
            "bap_worker_jobs_total",
            1,
            {
              ...attributes,
              status: "error",
            },
            "Count of BullMQ jobs processed by the Bap worker.",
          );
          throw error;
        } finally {
          recordHistogram(
            "bap_worker_job_duration_ms",
            performance.now() - startedAt,
            attributes,
            "Duration of BullMQ jobs processed by the Bap worker.",
          );
        }
      },
    );

  if (durableTraceId) {
    return withTraceIdContext(durableTraceId, runWithSpan);
  }

  return withExtractedTraceContext(extractTraceContextFromPayload(job.data), runWithSpan);
};

let queueMetricPoller: ReturnType<typeof setInterval> | null = null;
let queueMetricsRegistered = false;
const queueMetricSnapshot: QueueMetricSnapshot = {
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  oldestWaitingAgeSeconds: 0,
};

async function refreshQueueMetricSnapshot(): Promise<void> {
  const queue = getCurrentQueue();
  if (!queue) {
    return;
  }

  const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
  const [oldestWaitingJob] = await queue.getJobs(["waiting"], 0, 0, true);
  const oldestTimestamp =
    typeof oldestWaitingJob?.timestamp === "number" ? oldestWaitingJob.timestamp : null;

  queueMetricSnapshot.waiting = counts.waiting ?? 0;
  queueMetricSnapshot.active = counts.active ?? 0;
  queueMetricSnapshot.delayed = counts.delayed ?? 0;
  queueMetricSnapshot.failed = counts.failed ?? 0;
  queueMetricSnapshot.oldestWaitingAgeSeconds = oldestTimestamp
    ? Math.max(0, (Date.now() - oldestTimestamp) / 1000)
    : 0;
}

function registerQueueMetrics(): void {
  if (queueMetricsRegistered) {
    return;
  }

  registerObservableGauge(
    "bap_bullmq_jobs",
    (observe) => {
      observe(queueMetricSnapshot.waiting, { queue: queueName, state: "waiting" });
      observe(queueMetricSnapshot.active, { queue: queueName, state: "active" });
      observe(queueMetricSnapshot.delayed, { queue: queueName, state: "delayed" });
      observe(queueMetricSnapshot.failed, { queue: queueName, state: "failed" });
    },
    "Current BullMQ job counts by state for the primary Bap queue.",
  );

  registerObservableGauge(
    "bap_bullmq_oldest_waiting_job_age_seconds",
    (observe) => {
      observe(queueMetricSnapshot.oldestWaitingAgeSeconds, {
        queue: queueName,
      });
    },
    "Age in seconds of the oldest waiting BullMQ job on the primary Bap queue.",
  );

  queueMetricsRegistered = true;
}

function startQueueMetricsPolling(): void {
  registerQueueMetrics();

  if (queueMetricPoller) {
    return;
  }

  void refreshQueueMetricSnapshot().catch(() => {
    // Queue metric collection is best effort.
  });

  queueMetricPoller = setInterval(() => {
    void refreshQueueMetricSnapshot().catch(() => {
      // Queue metric collection is best effort.
    });
  }, 15_000);
  queueMetricPoller.unref?.();
}

function stopQueueMetricsPolling(): void {
  if (!queueMetricPoller) {
    return;
  }

  clearInterval(queueMetricPoller);
  queueMetricPoller = null;
}

export const startQueues = () => {
  getQueue();
  startQueueMetricsPolling();

  const worker = new Worker(queueName, processor, {
    connection: createRedisConnectionOptions(),
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? "5"),
  });

  const queueEvents = new QueueEvents(queueName, {
    connection: createRedisConnectionOptions(),
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[worker] job ${jobId} failed: ${failedReason}`);
  });

  worker.on("error", (error) => {
    console.error("[worker] unhandled error", error);
  });

  worker.on("failed", (job, error) => {
    const id = job?.id ?? "unknown";
    console.error(`[worker] job ${id} failed in processor`, error);
  });

  queueEvents.on("error", (error) => {
    console.error("[worker] queue events error", error);
  });

  return {
    worker,
    queueEvents,
    queueName,
    redisUrl,
  };
};

export const stopQueues = async (worker: Worker, queueEvents: QueueEvents) => {
  const closers: Promise<unknown>[] = [worker.close(), queueEvents.close()];
  stopQueueMetricsPolling();
  closers.push(closeQueue());
  await Promise.allSettled(closers);
};
