import { getQueue, queueName } from "@bap/core/server/queues";
import { db } from "@bap/db/client";
import { conversation, conversationRuntime, generation, generationInterrupt } from "@bap/db/schema";
import { desc, inArray, or } from "drizzle-orm";

const interruptDiagnosticColumns = {
  id: true,
  generationId: true,
  runtimeId: true,
  conversationId: true,
  kind: true,
  status: true,
  provider: true,
  providerRequestId: true,
  providerToolUseId: true,
  turnSeq: true,
  requestedAt: true,
  expiresAt: true,
  resolvedAt: true,
  appliedAt: true,
} as const;

function uniqueNonEmpty(values: Iterable<string> | undefined): string[] {
  return Array.from(new Set(Array.from(values ?? []).filter((value) => value.trim().length > 0)));
}

function previewJson(value: unknown, maxLength = 4_000): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const serialized = JSON.stringify(value) ?? String(value);
  if (serialized.length <= maxLength) {
    return serialized;
  }

  return `${serialized.slice(0, maxLength)}...[truncated ${serialized.length - maxLength} chars]`;
}

async function getWorkerQueueReadiness(): Promise<{
  ready: boolean;
  queueName: string;
  workerCount: number;
  counts: Record<string, number>;
}> {
  const queue = getQueue();
  const [workerCount, counts] = await Promise.all([
    queue.getWorkersCount(),
    queue.getJobCounts("waiting", "active", "delayed", "failed", "paused"),
  ]);

  return {
    ready: workerCount > 0,
    queueName,
    workerCount,
    counts,
  };
}

export async function getCliLiveFailureDiagnostics(args: {
  generationIds?: Iterable<string>;
  conversationIds?: Iterable<string>;
  maxGenerations?: number;
  maxInterrupts?: number;
}): Promise<unknown> {
  const inputGenerationIds = uniqueNonEmpty(args.generationIds);
  const inputConversationIds = uniqueNonEmpty(args.conversationIds);
  const maxGenerations = args.maxGenerations ?? 8;
  const maxInterrupts = args.maxInterrupts ?? 12;

  if (inputGenerationIds.length === 0 && inputConversationIds.length === 0) {
    return {
      input: {
        generationIds: [],
        conversationIds: [],
      },
      conversations: [],
      generations: [],
      runtimes: [],
      interrupts: [],
      workerQueue: await getWorkerQueueReadiness(),
    };
  }

  const generationWhere =
    inputGenerationIds.length > 0 && inputConversationIds.length > 0
      ? or(
          inArray(generation.id, inputGenerationIds),
          inArray(generation.conversationId, inputConversationIds),
        )
      : inputGenerationIds.length > 0
        ? inArray(generation.id, inputGenerationIds)
        : inArray(generation.conversationId, inputConversationIds);

  const generationRows = await db.query.generation.findMany({
    where: generationWhere,
    columns: {
      id: true,
      conversationId: true,
      runtimeId: true,
      messageId: true,
      status: true,
      pendingApproval: true,
      pendingAuth: true,
      executionPolicy: true,
      sandboxId: true,
      sandboxProvider: true,
      runtimeHarness: true,
      runtimeProtocolVersion: true,
      isPaused: true,
      deadlineAt: true,
      remainingRunMs: true,
      suspendedAt: true,
      resumeInterruptId: true,
      lastRuntimeProgressAt: true,
      recoveryAttempts: true,
      completionReason: true,
      errorMessage: true,
      debugInfo: true,
      inputTokens: true,
      outputTokens: true,
      traceId: true,
      terminalCanonicalEventEmittedAt: true,
      startedAt: true,
      cancelRequestedAt: true,
      completedAt: true,
    },
    orderBy: (fields) => [desc(fields.startedAt)],
    limit: maxGenerations,
  });

  const diagnosticGenerationIds = uniqueNonEmpty([
    ...inputGenerationIds,
    ...generationRows.map((row) => row.id),
  ]);
  const diagnosticConversationIds = uniqueNonEmpty([
    ...inputConversationIds,
    ...generationRows.map((row) => row.conversationId),
  ]);

  const [conversationRows, runtimeRows, interruptRows, workerQueue] = await Promise.all([
    diagnosticConversationIds.length > 0
      ? db.query.conversation.findMany({
          where: inArray(conversation.id, diagnosticConversationIds),
          columns: {
            id: true,
            type: true,
            title: true,
            generationStatus: true,
            currentGenerationId: true,
            lastSandboxProvider: true,
            lastRuntimeHarness: true,
            model: true,
            autoApprove: true,
            spawnDepth: true,
            createdAt: true,
            updatedAt: true,
            archivedAt: true,
          },
          limit: maxGenerations,
        })
      : Promise.resolve([]),
    diagnosticConversationIds.length > 0
      ? db.query.conversationRuntime.findMany({
          where: inArray(conversationRuntime.conversationId, diagnosticConversationIds),
          columns: {
            id: true,
            conversationId: true,
            sandboxProvider: true,
            runtimeHarness: true,
            runtimeProtocolVersion: true,
            sandboxId: true,
            sessionId: true,
            status: true,
            activeGenerationId: true,
            activeTurnSeq: true,
            lastBoundAt: true,
            createdAt: true,
            updatedAt: true,
          },
          limit: maxGenerations,
        })
      : Promise.resolve([]),
    diagnosticGenerationIds.length > 0 && diagnosticConversationIds.length > 0
      ? db.query.generationInterrupt.findMany({
          where: or(
            inArray(generationInterrupt.generationId, diagnosticGenerationIds),
            inArray(generationInterrupt.conversationId, diagnosticConversationIds),
          ),
          columns: interruptDiagnosticColumns,
          orderBy: (fields) => [desc(fields.requestedAt)],
          limit: maxInterrupts,
        })
      : diagnosticGenerationIds.length > 0
        ? db.query.generationInterrupt.findMany({
            where: inArray(generationInterrupt.generationId, diagnosticGenerationIds),
            columns: interruptDiagnosticColumns,
            orderBy: (fields) => [desc(fields.requestedAt)],
            limit: maxInterrupts,
          })
        : db.query.generationInterrupt.findMany({
            where: inArray(generationInterrupt.conversationId, diagnosticConversationIds),
            columns: interruptDiagnosticColumns,
            orderBy: (fields) => [desc(fields.requestedAt)],
            limit: maxInterrupts,
          }),
    getWorkerQueueReadiness(),
  ]);

  return {
    input: {
      generationIds: inputGenerationIds,
      conversationIds: inputConversationIds,
    },
    conversations: conversationRows,
    generations: generationRows.map(({ debugInfo, pendingApproval, pendingAuth, ...row }) =>
      Object.assign(row, {
        pendingApproval: Boolean(pendingApproval),
        pendingAuth: Boolean(pendingAuth),
        debugInfoPreview: previewJson(debugInfo),
      }),
    ),
    runtimes: runtimeRows,
    interrupts: interruptRows,
    workerQueue,
  };
}
