import { db } from "@cmdclaw/db/client";
import { generation } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { generationStreamExists } from "../../../redis/generation-event-bus";
import {
  buildQueueJobId,
  CHAT_GENERATION_JOB_NAME,
  COWORKER_GENERATION_JOB_NAME,
  getQueue,
} from "../../../queues/queue-client";
import { logger } from "../../../utils/observability";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import { GenerationLeaseStore } from "../core/generation-lease";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { GenerationInterruptRecord } from "../../generation-interrupt-service";
import type { GenerationContext, GenerationRunMode } from "../types";

const GEN_QUEUE_SELF_HEAL_DELAY_MS = Number.parseInt(
  process.env.GEN_QUEUE_SELF_HEAL_DELAY_MS ?? "5000",
  10,
);

export type GenerationRunType = "chat" | "coworker";

type GenerationRunQueueDependencies = {
  activeGenerations: Map<string, GenerationContext>;
  lifecycleStore: GenerationLifecycleStore;
  runQueuedGeneration: (generationId: string, runMode: GenerationRunMode) => Promise<void>;
  formatErrorMessage: (error: unknown) => string;
};

export class GenerationRunQueue {
  private readonly generationLeaseStore = new GenerationLeaseStore();
  private readonly queuedGenerationSelfHealTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly deps: GenerationRunQueueDependencies) {}

  getGenerationRunType(ctx: Pick<GenerationContext, "coworkerRunId">): GenerationRunType {
    return ctx.coworkerRunId ? "coworker" : "chat";
  }

  async acquireGenerationLease(generationId: string): Promise<string | null> {
    return this.generationLeaseStore.acquire(generationId);
  }

  async renewGenerationLease(generationId: string, token: string): Promise<void> {
    return this.generationLeaseStore.renew(generationId, token);
  }

  async releaseGenerationLease(generationId: string, token: string): Promise<void> {
    return this.generationLeaseStore.release(generationId, token);
  }

  async enqueueGenerationRun(
    generationId: string,
    type: GenerationRunType,
    options?: {
      delayMs?: number;
      dedupeKey?: string;
      runMode?: GenerationRunMode;
      traceId?: string;
    },
  ): Promise<void> {
    const queue = getQueue();
    const jobName = type === "coworker" ? COWORKER_GENERATION_JOB_NAME : CHAT_GENERATION_JOB_NAME;
    await queue.add(
      jobName,
      {
        generationId,
        runMode: options?.runMode ?? "normal_run",
        ...(options?.traceId ? { traceId: options.traceId } : {}),
      },
      {
        jobId: buildQueueJobId([jobName, generationId, options?.dedupeKey]),
        ...(options?.delayMs && options.delayMs > 0 ? { delay: options.delayMs } : {}),
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
    this.scheduleQueuedGenerationSelfHeal(
      generationId,
      options?.runMode ?? "normal_run",
      options?.delayMs ?? 0,
    );
  }

  async enqueueResolvedInterruptResume(params: {
    generationId: string;
    conversationId: string;
    interrupt: GenerationInterruptRecord;
    runType: GenerationRunType;
    coworkerRunId?: string | null;
    remainingRunMs?: number | null;
  }): Promise<void> {
    if (params.interrupt.appliedAt) {
      return;
    }

    const remainingRunMs =
      params.remainingRunMs && params.remainingRunMs > 0
        ? params.remainingRunMs
        : generationLifecyclePolicy.runDeadlineMs;
    const deadlineAt = new Date(Date.now() + remainingRunMs);

    await this.deps.lifecycleStore.resumeResolvedInterrupt({
      generationId: params.generationId,
      conversationId: params.conversationId,
      coworkerRunId: params.coworkerRunId,
      interruptId: params.interrupt.id,
      deadlineAt,
    });

    await this.enqueueGenerationRun(params.generationId, params.runType, {
      dedupeKey: `resume-interrupt-${params.interrupt.id}`,
    });
  }

  async touchConversationLastUserVisibleAction(conversationId: string): Promise<void> {
    await this.deps.lifecycleStore.touchConversationLastUserVisibleAction(conversationId);
  }

  private clearQueuedGenerationSelfHeal(generationId: string): void {
    const existing = this.queuedGenerationSelfHealTimers.get(generationId);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    this.queuedGenerationSelfHealTimers.delete(generationId);
  }

  private scheduleQueuedGenerationSelfHeal(
    generationId: string,
    runMode: GenerationRunMode,
    queueDelayMs = 0,
  ): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    this.clearQueuedGenerationSelfHeal(generationId);
    const delayMs = Math.max(0, queueDelayMs) + Math.max(0, GEN_QUEUE_SELF_HEAL_DELAY_MS);
    const timer = setTimeout(() => {
      this.queuedGenerationSelfHealTimers.delete(generationId);
      void this.runQueuedGenerationSelfHealIfStalled({
        generationId,
        runMode,
      });
    }, delayMs);
    this.queuedGenerationSelfHealTimers.set(generationId, timer);
  }

  private async runQueuedGenerationSelfHealIfStalled(input: {
    generationId: string;
    runMode: GenerationRunMode;
  }): Promise<void> {
    if (this.deps.activeGenerations.has(input.generationId)) {
      return;
    }

    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, input.generationId),
      columns: {
        id: true,
        conversationId: true,
        status: true,
        messageId: true,
        sandboxId: true,
        runtimeHarness: true,
        runtimeProtocolVersion: true,
        completedAt: true,
      },
    });

    if (!genRecord || genRecord.status !== "running") {
      return;
    }

    if (
      genRecord.completedAt ||
      genRecord.messageId ||
      genRecord.sandboxId ||
      genRecord.runtimeHarness ||
      genRecord.runtimeProtocolVersion
    ) {
      return;
    }

    if (await this.isGenerationLeaseHeld(input.generationId)) {
      return;
    }

    const streamPresent = await generationStreamExists(input.generationId).catch((error) => {
      logger.warn({
        event: "GENERATION_QUEUE_SELF_HEAL_STREAM_CHECK_FAILED",
        ...{
          source: "generation-manager",
          generationId: input.generationId,
          conversationId: genRecord.conversationId,
        },
        ...{
          error: this.deps.formatErrorMessage(error),
        },
      });
      return false;
    });

    if (streamPresent) {
      return;
    }

    logger.warn({
      event: "GENERATION_QUEUE_SELF_HEAL_TRIGGERED",
      ...{
        source: "generation-manager",
        generationId: input.generationId,
        conversationId: genRecord.conversationId,
      },
      ...{
        runMode: input.runMode,
      },
    });

    await this.deps.runQueuedGeneration(input.generationId, input.runMode);
  }

  private async isGenerationLeaseHeld(generationId: string): Promise<boolean> {
    if (process.env.NODE_ENV === "test") {
      return this.deps.activeGenerations.has(generationId);
    }
    return this.generationLeaseStore.isHeld(generationId);
  }
}
