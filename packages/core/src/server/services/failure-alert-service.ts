import { createHash } from "node:crypto";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  coworkerRun,
  failureAlertGroup,
  failureAlertOccurrence,
  generation,
  user,
  type FailureAlertKind,
} from "@cmdclaw/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildQueueJobId, FAILURE_ALERT_LINEAR_SYNC_JOB_NAME, getQueue } from "../queues/queue-client";

type FailureAlertSource = {
  generationId: string;
  conversationId: string;
  conversationTitle: string | null;
  conversationType: FailureAlertKind;
  userId: string | null;
  userEmail: string | null;
  errorMessage: string | null;
  completionReason: string | null;
  debugInfo: Record<string, unknown> | null;
  model: string | null;
  runtimeHarness: string | null;
  sandboxProvider: string | null;
  startedAt: Date;
  failedAt: Date;
  coworkerRunId: string | null;
};

export type CaptureGenerationFailureAlertResult = {
  groupId: string;
  occurrenceId: string;
  createdGroup: boolean;
};

export function normalizeFailureAlertError(message: string): string {
  return message
    .replaceAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
    .replaceAll(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replaceAll(
      /\b(gen|conv|msg|run|sess|session|thread|trace|span|req|request|sandbox|runtime)[-_][A-Za-z0-9_-]{6,}\b/g,
      "$1-<id>",
    )
    .replaceAll(/\b[A-Za-z0-9_-]{20,}\b/g, "<id>")
    .replaceAll(/\/tmp\/[^\s:)"']+/g, "/tmp/<path>")
    .replaceAll(/\/var\/folders\/[^\s:)"']+/g, "/var/folders/<path>")
    .replaceAll(/:\d{2,5}\b/g, ":<port>")
    .replaceAll(/\b\d{10,}\b/g, "<number>")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export function buildFailureAlertSignature(input: {
  environment: string;
  kind: FailureAlertKind;
  journey: string;
  completionReason: string | null;
  normalizedError: string;
  model: string | null;
  runtimeHarness: string | null;
  sandboxProvider: string | null;
}): { signature: string; signatureHash: string } {
  const parts = [
    input.environment,
    input.kind,
    input.journey,
    input.completionReason ?? "unknown_reason",
    input.normalizedError,
    input.model ?? "unknown_model",
    input.runtimeHarness ?? "unknown_runtime",
    input.sandboxProvider ?? "unknown_sandbox",
  ];
  const signature = parts.join("\n");
  return {
    signature,
    signatureHash: createHash("sha256").update(signature).digest("hex"),
  };
}

export async function captureGenerationFailureAlert(input: {
  generationId: string;
}): Promise<CaptureGenerationFailureAlertResult | null> {
  const source = await loadFailureAlertSource(input.generationId);
  if (!source) {
    return null;
  }

  const environment = resolveFailureAlertEnvironment();
  const rawError = source.errorMessage?.trim() || "Unknown generation failure";
  const normalizedError = normalizeFailureAlertError(rawError);
  const journey = source.conversationType;
  const { signatureHash } = buildFailureAlertSignature({
    environment,
    kind: source.conversationType,
    journey,
    completionReason: source.completionReason,
    normalizedError,
    model: source.model,
    runtimeHarness: source.runtimeHarness,
    sandboxProvider: source.sandboxProvider,
  });
  const title = buildFailureAlertTitle(source.conversationType, normalizedError);

  const result = await db.transaction(async (tx) => {
    const [existingGroup] = await tx
      .select({ id: failureAlertGroup.id, occurrenceCount: failureAlertGroup.occurrenceCount })
      .from(failureAlertGroup)
      .where(eq(failureAlertGroup.signatureHash, signatureHash))
      .limit(1);

    const [group] = await tx
      .insert(failureAlertGroup)
      .values({
        signatureHash,
        environment,
        kind: source.conversationType,
        journey,
        completionReason: source.completionReason,
        normalizedError,
        title,
        model: source.model,
        runtimeHarness: source.runtimeHarness,
        sandboxProvider: source.sandboxProvider,
        firstSeenAt: source.failedAt,
        lastSeenAt: source.failedAt,
      })
      .onConflictDoUpdate({
        target: failureAlertGroup.signatureHash,
        set: {
          title,
          lastSeenAt: source.failedAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: failureAlertGroup.id });

    const [occurrence] = await tx
      .insert(failureAlertOccurrence)
      .values({
        groupId: group.id,
        generationId: source.generationId,
        conversationId: source.conversationId,
        coworkerRunId: source.coworkerRunId,
        userId: source.userId,
        userEmail: source.userEmail,
        rawError,
        normalizedError,
        completionReason: source.completionReason,
        traceId: extractTraceId(source.debugInfo),
        model: source.model,
        runtimeHarness: source.runtimeHarness,
        sandboxProvider: source.sandboxProvider,
        startedAt: source.startedAt,
        failedAt: source.failedAt,
      })
      .onConflictDoNothing({ target: failureAlertOccurrence.generationId })
      .returning({ id: failureAlertOccurrence.id });

    if (!occurrence) {
      const [existingOccurrence] = await tx
        .select({ id: failureAlertOccurrence.id })
        .from(failureAlertOccurrence)
        .where(eq(failureAlertOccurrence.generationId, source.generationId))
        .limit(1);

      return existingOccurrence
        ? {
            groupId: group.id,
            occurrenceId: existingOccurrence.id,
            createdGroup: !existingGroup,
            insertedOccurrence: false,
          }
        : null;
    }

    await tx
      .update(failureAlertGroup)
      .set({
        occurrenceCount: sql`${failureAlertGroup.occurrenceCount} + 1`,
        lastSeenAt: source.failedAt,
        updatedAt: new Date(),
      })
      .where(eq(failureAlertGroup.id, group.id));

    return {
      groupId: group.id,
      occurrenceId: occurrence.id,
      createdGroup: !existingGroup,
      insertedOccurrence: true,
    };
  });

  if (!result) {
    return null;
  }

  await enqueueFailureAlertLinearSync(result.groupId, result.occurrenceId);

  return {
    groupId: result.groupId,
    occurrenceId: result.occurrenceId,
    createdGroup: result.createdGroup,
  };
}

async function loadFailureAlertSource(generationId: string): Promise<FailureAlertSource | null> {
  const [row] = await db
    .select({
      generationId: generation.id,
      generationStatus: generation.status,
      conversationId: generation.conversationId,
      conversationTitle: conversation.title,
      conversationType: conversation.type,
      userId: conversation.userId,
      userEmail: user.email,
      errorMessage: generation.errorMessage,
      completionReason: generation.completionReason,
      debugInfo: generation.debugInfo,
      model: conversation.model,
      runtimeHarness: generation.runtimeHarness,
      conversationRuntimeHarness: conversation.lastRuntimeHarness,
      sandboxProvider: generation.sandboxProvider,
      conversationSandboxProvider: conversation.lastSandboxProvider,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      coworkerRunId: coworkerRun.id,
    })
    .from(generation)
    .innerJoin(conversation, eq(conversation.id, generation.conversationId))
    .leftJoin(user, eq(user.id, conversation.userId))
    .leftJoin(coworkerRun, eq(coworkerRun.generationId, generation.id))
    .where(eq(generation.id, generationId))
    .limit(1);

  if (!row || row.generationStatus !== "error") {
    return null;
  }

  if (row.conversationType !== "chat" && row.conversationType !== "coworker") {
    return null;
  }

  return {
    generationId: row.generationId,
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    conversationType: row.conversationType,
    userId: row.userId,
    userEmail: row.userEmail,
    errorMessage: row.errorMessage,
    completionReason: row.completionReason,
    debugInfo: (row.debugInfo ?? null) as Record<string, unknown> | null,
    model: row.model,
    runtimeHarness: row.runtimeHarness ?? row.conversationRuntimeHarness,
    sandboxProvider: row.sandboxProvider ?? row.conversationSandboxProvider,
    startedAt: row.startedAt,
    failedAt: row.completedAt ?? new Date(),
    coworkerRunId: row.coworkerRunId,
  };
}

async function enqueueFailureAlertLinearSync(groupId: string, occurrenceId: string): Promise<void> {
  await getQueue().add(
    FAILURE_ALERT_LINEAR_SYNC_JOB_NAME,
    { groupId },
    {
      jobId: buildQueueJobId([FAILURE_ALERT_LINEAR_SYNC_JOB_NAME, groupId, occurrenceId]),
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

function resolveFailureAlertEnvironment(): string {
  return (
    process.env.LINEAR_FAILURE_ALERT_ENV?.trim() ||
    process.env.APP_ALERT_ENV?.trim() ||
    process.env.APP_ALERT_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development"
  );
}

function buildFailureAlertTitle(kind: FailureAlertKind, normalizedError: string): string {
  const prefix = kind === "coworker" ? "Coworker failure" : "Chat failure";
  const suffix =
    normalizedError.length > 90 ? `${normalizedError.slice(0, 87)}...` : normalizedError;
  return `${prefix}: ${suffix}`;
}

function extractTraceId(debugInfo: Record<string, unknown> | null): string | null {
  if (!debugInfo) {
    return null;
  }
  const direct = debugInfo.traceId ?? debugInfo.trace_id;
  return typeof direct === "string" && direct.length > 0 ? direct : null;
}
