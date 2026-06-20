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

function stringifyJsonPreview(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value) ?? String(value);
}

function truncatePreview(serialized: string, maxLength: number): string {
  if (serialized.length <= maxLength) {
    return serialized;
  }
  return `${serialized.slice(0, maxLength)}...[truncated ${serialized.length - maxLength} chars]`;
}

function previewJson(value: unknown, maxLength = 4_000): string | null {
  const serialized = stringifyJsonPreview(value);
  return serialized ? truncatePreview(serialized, maxLength) : null;
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

function buildGenerationWhere(generationIds: string[], conversationIds: string[]) {
  if (generationIds.length > 0 && conversationIds.length > 0) {
    return or(
      inArray(generation.id, generationIds),
      inArray(generation.conversationId, conversationIds),
    );
  }
  if (generationIds.length > 0) {
    return inArray(generation.id, generationIds);
  }
  return inArray(generation.conversationId, conversationIds);
}

async function loadDiagnosticGenerationRows(args: {
  generationIds: string[];
  conversationIds: string[];
  maxGenerations: number;
}) {
  return db.query.generation.findMany({
    where: buildGenerationWhere(args.generationIds, args.conversationIds),
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
    limit: args.maxGenerations,
  });
}

async function loadDiagnosticConversationRows(conversationIds: string[], maxGenerations: number) {
  if (conversationIds.length === 0) {
    return [];
  }
  return db.query.conversation.findMany({
    where: inArray(conversation.id, conversationIds),
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
  });
}

async function loadDiagnosticRuntimeRows(conversationIds: string[], maxGenerations: number) {
  if (conversationIds.length === 0) {
    return [];
  }
  return db.query.conversationRuntime.findMany({
    where: inArray(conversationRuntime.conversationId, conversationIds),
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
  });
}

function buildInterruptWhere(generationIds: string[], conversationIds: string[]) {
  if (generationIds.length > 0 && conversationIds.length > 0) {
    return or(
      inArray(generationInterrupt.generationId, generationIds),
      inArray(generationInterrupt.conversationId, conversationIds),
    );
  }
  if (generationIds.length > 0) {
    return inArray(generationInterrupt.generationId, generationIds);
  }
  return inArray(generationInterrupt.conversationId, conversationIds);
}

async function loadDiagnosticInterruptRows(args: {
  generationIds: string[];
  conversationIds: string[];
  maxInterrupts: number;
}) {
  if (args.generationIds.length === 0 && args.conversationIds.length === 0) {
    return [];
  }
  return db.query.generationInterrupt.findMany({
    where: buildInterruptWhere(args.generationIds, args.conversationIds),
    columns: interruptDiagnosticColumns,
    orderBy: (fields) => [desc(fields.requestedAt)],
    limit: args.maxInterrupts,
  });
}

type CliLiveFailureDiagnosticInput = {
  inputGenerationIds: string[];
  inputConversationIds: string[];
  maxGenerations: number;
  maxInterrupts: number;
};

function buildDiagnosticInput(args: {
  generationIds?: Iterable<string>;
  conversationIds?: Iterable<string>;
  maxGenerations?: number;
  maxInterrupts?: number;
}): CliLiveFailureDiagnosticInput {
  return {
    inputGenerationIds: uniqueNonEmpty(args.generationIds),
    inputConversationIds: uniqueNonEmpty(args.conversationIds),
    maxGenerations: Number(args.maxGenerations || 8),
    maxInterrupts: Number(args.maxInterrupts || 12),
  };
}

function hasDiagnosticInput(input: CliLiveFailureDiagnosticInput): boolean {
  return input.inputGenerationIds.length > 0 || input.inputConversationIds.length > 0;
}

async function getEmptyCliLiveFailureDiagnostics(): Promise<unknown> {
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

async function getPopulatedCliLiveFailureDiagnostics(
  input: CliLiveFailureDiagnosticInput,
): Promise<unknown> {
  const generationRows = await loadDiagnosticGenerationRows({
    generationIds: input.inputGenerationIds,
    conversationIds: input.inputConversationIds,
    maxGenerations: input.maxGenerations,
  });

  const diagnosticGenerationIds = uniqueNonEmpty([
    ...input.inputGenerationIds,
    ...generationRows.map((row) => row.id),
  ]);
  const diagnosticConversationIds = uniqueNonEmpty([
    ...input.inputConversationIds,
    ...generationRows.map((row) => row.conversationId),
  ]);

  const [conversationRows, runtimeRows, interruptRows, workerQueue] = await Promise.all([
    loadDiagnosticConversationRows(diagnosticConversationIds, input.maxGenerations),
    loadDiagnosticRuntimeRows(diagnosticConversationIds, input.maxGenerations),
    loadDiagnosticInterruptRows({
      generationIds: diagnosticGenerationIds,
      conversationIds: diagnosticConversationIds,
      maxInterrupts: input.maxInterrupts,
    }),
    getWorkerQueueReadiness(),
  ]);

  return {
    input: {
      generationIds: input.inputGenerationIds,
      conversationIds: input.inputConversationIds,
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

async function getCliLiveFailureDiagnosticsForInput(
  input: CliLiveFailureDiagnosticInput,
): Promise<unknown> {
  if (!hasDiagnosticInput(input)) {
    return getEmptyCliLiveFailureDiagnostics();
  }
  return getPopulatedCliLiveFailureDiagnostics(input);
}

export async function getCliLiveFailureDiagnostics(args: {
  generationIds?: Iterable<string>;
  conversationIds?: Iterable<string>;
  maxGenerations?: number;
  maxInterrupts?: number;
}): Promise<unknown> {
  return getCliLiveFailureDiagnosticsForInput(buildDiagnosticInput(args));
}
