import {
  buildQueueJobId,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  getQueue,
} from "../../queues/queue-client";
import { logger } from "../../utils/observability";
import { generationLifecyclePolicy } from "../lifecycle-policy";
import { formatErrorMessage } from "./format-error-message";
import type { GenerationTimeoutKind } from "./maintenance/generation-maintenance";

const AGENT_PREPARING_TIMEOUT_MS = generationLifecyclePolicy.bootstrapTimeoutMs;

/**
 * Schedule the delayed BullMQ job that fails a Generation whose approval/auth
 * interrupt has expired. A no-op under NODE_ENV=test so unit tests do not touch
 * the queue. The job id is derived from the expiry so re-enqueuing the same
 * timeout is idempotent.
 */
export async function enqueueGenerationTimeout(
  generationId: string,
  kind: GenerationTimeoutKind,
  expiresAtIso: string,
): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const queue = getQueue();
  const runAt = Date.parse(expiresAtIso);
  const delay = Math.max(0, Number.isFinite(runAt) ? runAt - Date.now() : 0);
  const timeoutKey =
    Number.isFinite(runAt) && runAt > 0
      ? String(runAt)
      : expiresAtIso.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const jobName =
    kind === "approval" ? GENERATION_APPROVAL_TIMEOUT_JOB_NAME : GENERATION_AUTH_TIMEOUT_JOB_NAME;
  const jobId = buildQueueJobId([jobName, generationId, timeoutKey]);
  await queue.add(
    jobName,
    { generationId, kind, expiresAt: expiresAtIso },
    {
      jobId,
      delay,
      removeOnComplete: true,
      removeOnFail: 500,
    },
  );
}

/**
 * Schedule the delayed check that detects a Generation stuck in the preparing
 * phase past the bootstrap timeout. Failures to enqueue are logged, not thrown.
 */
export async function enqueuePreparingStuckCheck(generationId: string): Promise<void> {
  try {
    const queue = getQueue();
    const jobName = GENERATION_PREPARING_STUCK_CHECK_JOB_NAME;
    await queue.add(
      jobName,
      { generationId },
      {
        jobId: buildQueueJobId([jobName, generationId]),
        delay: AGENT_PREPARING_TIMEOUT_MS,
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  } catch (error) {
    logger.warn({
      event: "GENERATION_PREPARING_STUCK_CHECK_ENQUEUE_FAILED",
      ...{ source: "generation-manager" },
      ...{
        generationId,
        error: formatErrorMessage(error),
      },
    });
  }
}
