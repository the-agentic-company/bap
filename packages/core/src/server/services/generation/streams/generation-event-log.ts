import { db } from "@cmdclaw/db/client";
import {
  coworkerRunEvent,
  generation,
  message,
  type ContentPart,
  type MessageTiming,
} from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import {
  generationStreamExists,
  getLatestGenerationStreamEnvelope,
  getLatestGenerationStreamCursor,
  publishGenerationStreamEvent,
  readGenerationStreamAfter,
  type GenerationStreamEnvelope,
} from "../../../redis/generation-event-bus";
import { createTraceId, logServerEvent } from "../../../utils/observability";
import { sanitizeJsonForPostgres } from "../../../utils/postgres-json";
import { generationInterruptService, type GenerationInterruptRecord } from "../../generation-interrupt-service";
import type { GenerationEvent, GenerationStreamEvent } from "../types";
import { buildGenerationReplayPartEvent } from "./replay-events";

const GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS = Number.parseInt(
  process.env.GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS ?? "25000",
  10,
);
const GEN_STREAM_DB_RECOVERY_POLL_MS = Number.parseInt(
  process.env.GEN_STREAM_DB_RECOVERY_POLL_MS ?? "1000",
  10,
);

export type ActiveGenerationStreamContext = {
  id: string;
  conversationId: string;
  userId: string;
  traceId: string;
  streamSequence: number;
  streamLastCursor?: string;
  streamPublishedCount: number;
  streamFirstVisiblePublishedAt?: number;
  streamTerminalPublishedAt?: number;
  coworkerRunId?: string;
};

export type GenerationEventLogDependencies = {
  projectInterruptPendingEvent(interrupt: GenerationInterruptRecord): GenerationEvent;
};

type DoneArtifacts = {
  timing?: MessageTiming;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
  }>;
};

export type GenerationStreamCounters = {
  opened: number;
  closed: number;
  timedOut: number;
  deduped: number;
  active: number;
};

function formatStreamErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function shouldMirrorCoworkerEvent(event: GenerationEvent): boolean {
  return (
    event.type === "tool_use" ||
    event.type === "tool_result" ||
    event.type === "interrupt_pending" ||
    event.type === "interrupt_resolved" ||
    event.type === "done" ||
    event.type === "error" ||
    event.type === "cancelled" ||
    event.type === "status_change" ||
    event.type === "system"
  );
}

export class GenerationEventLog {
  private readonly activeSubscriptionCounts = new Map<string, number>();
  private readonly streamCounters = {
    opened: 0,
    closed: 0,
    timedOut: 0,
    deduped: 0,
  };

  constructor(private readonly deps?: GenerationEventLogDependencies) {}

  getCounters(): GenerationStreamCounters {
    let active = 0;
    for (const value of this.activeSubscriptionCounts.values()) {
      active += value;
    }
    return {
      ...this.streamCounters,
      active,
    };
  }

  private getSubscriptionKey(generationId: string, userId: string): string {
    return `${generationId}:${userId}`;
  }

  async *subscribe(input: {
    generationId: string;
    userId: string;
    cursor?: string;
  }): AsyncGenerator<GenerationStreamEvent, void, unknown> {
    if (!this.deps) {
      yield { type: "error", message: "Generation event log is not configured for replay." };
      return;
    }

    const { generationId, userId } = input;
    const initial = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!initial) {
      yield { type: "error", message: "Generation not found" };
      return;
    }
    if (initial.conversation.userId !== userId) {
      yield { type: "error", message: "Access denied" };
      return;
    }

    const subscriptionKey = this.getSubscriptionKey(generationId, userId);
    const existingSubscriptionCount = this.activeSubscriptionCounts.get(subscriptionKey) ?? 0;
    if (existingSubscriptionCount > 0) {
      this.streamCounters.deduped += 1;
      logServerEvent(
        "info",
        "GENERATION_STREAM_DUPLICATE_DETECTED",
        {
          ...this.getCounters(),
          existingSubscriptionCount,
        },
        {
          source: "generation-event-log",
          generationId: initial.id,
          conversationId: initial.conversationId,
          userId,
        },
      );
    }

    this.activeSubscriptionCounts.set(subscriptionKey, existingSubscriptionCount + 1);
    this.streamCounters.opened += 1;

    const maxWaitMs =
      initial.conversation.type === "coworker"
        ? Math.max(10 * 60 * 1000, GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS)
        : GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS;
    const startedAt = Date.now();
    const streamId = createTraceId();
    let terminated = false;
    let terminatedBy:
      | "completed"
      | "cancelled"
      | "error"
      | "not_found"
      | "access_denied"
      | "redis_unavailable"
      | "timeout"
      | null = null;
    let eventsYielded = 0;
    let redisReadCount = 0;
    let redisEmptyReadCount = 0;
    let lastDbRecoveryCheckAt = 0;
    let cursor = input.cursor ?? "0-0";
    let observedParts: ContentPart[] = [];
    let lastStatus: typeof generation.$inferSelect.status | null = null;
    let emittedPendingInterruptId: string | null = null;
    const isTestRuntime = process.env.NODE_ENV === "test";
    let testLoopIterations = 0;

    try {
      while (!terminated && Date.now() - startedAt < maxWaitMs) {
        if (isTestRuntime) {
          testLoopIterations += 1;
          if (testLoopIterations > 2_000) {
            terminated = true;
            terminatedBy = "timeout";
            eventsYielded += 1;
            yield {
              type: "error",
              message: "Generation stream exceeded test loop budget without terminal state.",
            };
            break;
          }
          await Promise.resolve();
        }

        let events: Awaited<ReturnType<typeof readGenerationStreamAfter>> = [];
        if (isTestRuntime) {
          events = [];
        } else {
          try {
            events = await readGenerationStreamAfter({
              generationId,
              cursor,
            });
            redisReadCount += 1;
          } catch (error) {
            terminatedBy = "redis_unavailable";
            logServerEvent(
              "error",
              "GENERATION_STREAM_REDIS_READ_FAILED",
              {
                error: formatStreamErrorMessage(error),
                streamId,
                cursor,
                redisReadCount,
              },
              {
                source: "generation-event-log",
                generationId: initial.id,
                conversationId: initial.conversationId,
                userId,
              },
            );
            eventsYielded += 1;
            yield {
              type: "error",
              message: "Generation stream is temporarily unavailable. Please retry in a moment.",
            };
            terminated = true;
            break;
          }
        }

        if (events.length === 0) {
          redisEmptyReadCount += 1;
          const now = Date.now();
          if (isTestRuntime || now - lastDbRecoveryCheckAt >= GEN_STREAM_DB_RECOVERY_POLL_MS) {
            lastDbRecoveryCheckAt = now;
            const latest = await db.query.generation.findFirst({
              where: eq(generation.id, generationId),
              with: { conversation: true },
            });
            if (!latest) {
              terminated = true;
              terminatedBy = "not_found";
              eventsYielded += 1;
              yield { type: "error", message: "Generation not found" };
              break;
            }
            if (latest.conversation.userId !== userId) {
              terminated = true;
              terminatedBy = "access_denied";
              eventsYielded += 1;
              yield { type: "error", message: "Access denied" };
              break;
            }

            const streamPresent = isTestRuntime ? false : await generationStreamExists(generationId);
            if (!streamPresent) {
              const latestParts = (latest.contentParts ?? []) as ContentPart[];
              const sharedLength = Math.min(observedParts.length, latestParts.length);
              for (let i = 0; i < sharedLength; i += 1) {
                const previousPart = observedParts[i];
                const currentPart = latestParts[i];
                if (
                  previousPart.type === "text" &&
                  currentPart.type === "text" &&
                  currentPart.text.length > previousPart.text.length
                ) {
                  eventsYielded += 1;
                  yield {
                    type: "text",
                    content: currentPart.text.slice(previousPart.text.length),
                  };
                }
              }
              for (let i = observedParts.length; i < latestParts.length; i += 1) {
                const partEvent = buildGenerationReplayPartEvent({
                  generationId: latest.id,
                  runtimeId: latest.runtimeId ?? null,
                  conversationId: latest.conversationId,
                  turnSeq: 1,
                  part: latestParts[i],
                  parts: latestParts,
                });
                if (partEvent) {
                  eventsYielded += 1;
                  yield partEvent;
                }
              }
              observedParts = latestParts;
            }

            if (latest.status !== lastStatus) {
              lastStatus = latest.status;
              eventsYielded += 1;
              yield { type: "status_change", status: latest.status };
            }

            const pendingInterrupt =
              latest.status === "awaiting_approval" || latest.status === "awaiting_auth"
                ? await generationInterruptService.getPendingInterruptForGeneration(latest.id)
                : null;
            if (pendingInterrupt && emittedPendingInterruptId !== pendingInterrupt.id) {
              emittedPendingInterruptId = pendingInterrupt.id;
              eventsYielded += 1;
              yield this.deps.projectInterruptPendingEvent(pendingInterrupt);
            }

            if (
              !streamPresent &&
              (latest.status === "completed" ||
                latest.status === "cancelled" ||
                latest.status === "error")
            ) {
              const terminalEvent = await this.getTerminalRecoveryEvent(latest, {
                includeCursor: !isTestRuntime,
              });
              if (terminalEvent) {
                terminated = true;
                terminatedBy = latest.status;
                eventsYielded += 1;
                yield terminalEvent;
                break;
              }
            }
          }
          continue;
        }

        for (const item of events) {
          cursor = item.cursor;
          const payload = item.envelope.payload;
          eventsYielded += 1;
          yield {
            ...payload,
            cursor: item.cursor,
          };
          if (payload.type === "done" || payload.type === "cancelled" || payload.type === "error") {
            terminated = true;
            terminatedBy =
              payload.type === "done"
                ? "completed"
                : payload.type === "cancelled"
                  ? "cancelled"
                  : "error";
            break;
          }
        }
      }

      if (!terminated) {
        const latestCursor = await getLatestGenerationStreamCursor(generationId);
        const errorMessage = latestCursor
          ? "Generation is still processing. Reconnect with the returned cursor to resume stream replay."
          : "Generation is still processing but no stream events are currently available. Please retry shortly.";
        terminatedBy = "timeout";
        this.streamCounters.timedOut += 1;
        logServerEvent(
          "warn",
          "GENERATION_STREAM_TIMEOUT",
          {
            maxWaitMs,
            conversationType: initial.conversation.type,
            streamId,
            eventsYielded,
            redisReadCount,
            redisEmptyReadCount,
            cursor,
            latestCursor,
          },
          {
            source: "generation-event-log",
            generationId: initial.id,
            conversationId: initial.conversationId,
            userId,
          },
        );
        eventsYielded += 1;
        yield { type: "error", message: errorMessage, cursor };
      }
    } finally {
      const currentCount = this.activeSubscriptionCounts.get(subscriptionKey) ?? 0;
      if (currentCount <= 1) {
        this.activeSubscriptionCounts.delete(subscriptionKey);
      } else {
        this.activeSubscriptionCounts.set(subscriptionKey, currentCount - 1);
      }
      this.streamCounters.closed += 1;

      logServerEvent(
        "info",
        "GENERATION_STREAM_SUBSCRIPTION_SUMMARY",
        {
          ...this.getCounters(),
          streamId,
          durationMs: Date.now() - startedAt,
          maxWaitMs,
          eventsYielded,
          redisReadCount,
          redisEmptyReadCount,
          cursor,
          termination: terminatedBy ?? "consumer_closed",
          conversationType: initial.conversation.type,
        },
        {
          source: "generation-event-log",
          generationId: initial.id,
          conversationId: initial.conversationId,
          userId,
        },
      );
    }
  }

  private async getDoneArtifacts(messageId: string): Promise<DoneArtifacts | undefined> {
    const messageRecord = await db.query.message.findFirst({
      where: eq(message.id, messageId),
      with: {
        attachments: true,
        sandboxFiles: true,
      },
    });

    if (!messageRecord) {
      return undefined;
    }

    return {
      timing: messageRecord.timing ?? undefined,
      attachments: messageRecord.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      })),
      sandboxFiles: messageRecord.sandboxFiles.map((file) => ({
        fileId: file.id,
        path: file.path,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
    };
  }

  async getTerminalRecoveryEvent(
    genRecord: typeof generation.$inferSelect,
    options?: { includeCursor?: boolean },
  ): Promise<GenerationStreamEvent | null> {
    const includeCursor = options?.includeCursor ?? true;
    const latestCursor = includeCursor ? await getLatestGenerationStreamCursor(genRecord.id) : null;
    if (genRecord.status === "completed" && genRecord.messageId) {
      const artifacts = await this.getDoneArtifacts(genRecord.messageId);
      const doneEvent: GenerationStreamEvent = {
        type: "done",
        generationId: genRecord.id,
        conversationId: genRecord.conversationId,
        messageId: genRecord.messageId,
        usage: {
          inputTokens: genRecord.inputTokens,
          outputTokens: genRecord.outputTokens,
          totalCostUsd: 0,
        },
      };
      if (artifacts !== undefined) {
        doneEvent.artifacts = artifacts;
      }
      if (latestCursor) {
        doneEvent.cursor = latestCursor;
      }
      return doneEvent;
    }
    if (genRecord.status === "cancelled") {
      const cancelledEvent: GenerationStreamEvent = {
        type: "cancelled",
        generationId: genRecord.id,
        conversationId: genRecord.conversationId,
        messageId: genRecord.messageId ?? undefined,
      };
      if (latestCursor) {
        cancelledEvent.cursor = latestCursor;
      }
      return cancelledEvent;
    }
    if (genRecord.status === "error") {
      const errorEvent: GenerationStreamEvent = {
        type: "error",
        message: genRecord.errorMessage || "Unknown error",
      };
      if (latestCursor) {
        errorEvent.cursor = latestCursor;
      }
      return errorEvent;
    }
    return null;
  }

  publishActive(ctx: ActiveGenerationStreamContext, event: GenerationEvent): void {
    const nextSequence = ctx.streamSequence + 1;
    ctx.streamSequence = nextSequence;
    const envelope: GenerationStreamEnvelope = {
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      sequence: nextSequence,
      eventType: event.type,
      payload: event,
      createdAtMs: Date.now(),
    };

    void publishGenerationStreamEvent(ctx.id, envelope)
      .then((cursor) => {
        ctx.streamLastCursor = cursor;
        ctx.streamPublishedCount += 1;
        if (
          (event.type === "text" || event.type === "thinking") &&
          ctx.streamFirstVisiblePublishedAt === undefined
        ) {
          ctx.streamFirstVisiblePublishedAt = Date.now();
        }
        if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
          ctx.streamTerminalPublishedAt = Date.now();
        }
      })
      .catch((error) => {
        logServerEvent(
          "error",
          "GENERATION_STREAM_PUBLISH_FAILED",
          {
            error: formatStreamErrorMessage(error),
            sequence: nextSequence,
            eventType: event.type,
          },
          {
            source: "generation-event-log",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      });

    if (ctx.coworkerRunId) {
      void this.recordCoworkerRunEvent(ctx.coworkerRunId, event);
    }
  }

  async publishDetached(input: {
    generationId: string;
    conversationId: string;
    event: GenerationEvent;
  }): Promise<void> {
    try {
      const latest = await getLatestGenerationStreamEnvelope(input.generationId);
      const envelope: GenerationStreamEnvelope = {
        generationId: input.generationId,
        conversationId: input.conversationId,
        sequence: (latest?.envelope.sequence ?? 0) + 1,
        eventType: input.event.type,
        payload: input.event,
        createdAtMs: Date.now(),
      };
      await publishGenerationStreamEvent(input.generationId, envelope);
    } catch (error) {
      logServerEvent(
        "error",
        "GENERATION_STREAM_PUBLISH_FAILED",
        {
          error: formatStreamErrorMessage(error),
          eventType: input.event.type,
        },
        {
          source: "generation-event-log",
          generationId: input.generationId,
          conversationId: input.conversationId,
        },
      );
    }
  }

  async recordCoworkerRunEvent(coworkerRunId: string, event: GenerationEvent): Promise<void> {
    if (!shouldMirrorCoworkerEvent(event)) {
      return;
    }

    await db.insert(coworkerRunEvent).values({
      coworkerRunId,
      type: event.type,
      payload: sanitizeJsonForPostgres(event),
    });
  }
}
