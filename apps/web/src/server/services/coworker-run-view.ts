import {
  reconcileStaleCoworkerRunsForCoworker,
  reconcileStaleCoworkerRunsForCoworkers,
} from "@bap/core/server/services/coworker-service";
import { decideCoworkerRunContentAccess } from "@bap/core/server/services/coworker-run-visibility";
import { generation, coworker, coworkerRun, coworkerRunEvent } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

type RunViewContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

const runCursorSchema = z.object({
  startedAt: z.coerce.date(),
  runId: z.string().min(1),
});

function encodeRunCursor(cursor: { startedAt: Date; runId: string }): string {
  return JSON.stringify({
    startedAt: cursor.startedAt.toISOString(),
    runId: cursor.runId,
  });
}

function decodeRunCursor(cursor: string | undefined): z.infer<typeof runCursorSchema> | null {
  if (!cursor) {
    return null;
  }

  try {
    return runCursorSchema.parse(JSON.parse(cursor));
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid history cursor",
    });
  }
}

function inferFailureKindFromDebugInfo(debugInfo: unknown): string | null {
  if (!debugInfo || typeof debugInfo !== "object") {
    return null;
  }
  const record = debugInfo as Record<string, unknown>;
  return record.markedFailedBy === "runner_mcp_tool" ? "runner_declared_failure" : null;
}

function resolveRunFailureKind(input: {
  runFailureKind?: string | null;
  runDebugInfo?: unknown;
  generationFailureKind?: string | null;
  generationDebugInfo?: unknown;
}): string | null {
  return (
    input.runFailureKind ??
    input.generationFailureKind ??
    inferFailureKindFromDebugInfo(input.runDebugInfo) ??
    inferFailureKindFromDebugInfo(input.generationDebugInfo)
  );
}

function accessibleCoworkerFilter(input: { userId: string; workspaceId: string }) {
  return and(
    eq(coworker.workspaceId, input.workspaceId),
    or(
      eq(coworker.visibility, "workspace"),
      eq(coworker.createdByUserId, input.userId),
      // Compatibility for rows that have not yet been backfilled.
      eq(coworker.ownerId, input.userId),
    ),
  );
}

export async function getCoworkerRunView(input: {
  context: RunViewContext;
  workspaceId: string;
  runId: string;
}) {
  const runFilter = and(
    eq(coworkerRun.id, input.runId),
    eq(coworkerRun.workspaceId, input.workspaceId),
    isNull(coworkerRun.syntheticKind),
  );

  const initialRun = await input.context.db.query.coworkerRun.findFirst({
    where: runFilter,
  });

  if (!initialRun) {
    throw new ORPCError("NOT_FOUND", { message: "Run not found" });
  }

  await reconcileStaleCoworkerRunsForCoworker(initialRun.coworkerId);

  const run = await input.context.db.query.coworkerRun.findFirst({
    where: runFilter,
  });

  if (!run) {
    throw new ORPCError("NOT_FOUND", { message: "Run not found" });
  }

  const wf = await input.context.db.query.coworker.findFirst({
    where: and(
      eq(coworker.id, run.coworkerId),
      accessibleCoworkerFilter({
        userId: input.context.user.id,
        workspaceId: input.workspaceId,
      }),
    ),
    columns: {
      id: true,
      name: true,
      username: true,
      visibility: true,
      sharedAt: true,
      createdByUserId: true,
      ownerId: true,
    },
  });

  if (!wf) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  const visibility = decideCoworkerRunContentAccess({
    actorUserId: input.context.user.id,
    isActiveWorkspaceMember: true,
    coworkerVisibility: wf.visibility === "workspace" || wf.sharedAt ? "workspace" : "private",
    coworkerCreatedByUserId: wf.createdByUserId ?? wf.ownerId,
    workspaceRole: null,
    startKind: run.startKind,
    initiatedByUserId: run.initiatedByUserId,
  });
  const canReadContent = visibility.allowed;
  const events = canReadContent
    ? await input.context.db.query.coworkerRunEvent.findMany({
        where: eq(coworkerRunEvent.coworkerRunId, run.id),
        orderBy: (evt, { asc }) => [asc(evt.createdAt)],
      })
    : [];
  const gen =
    canReadContent && run.generationId
      ? await input.context.db.query.generation.findFirst({
          where: eq(generation.id, run.generationId),
          columns: {
            conversationId: true,
            debugInfo: true,
            failureKind: true,
          },
        })
      : null;

  return {
    id: run.id,
    coworkerId: run.coworkerId,
    coworkerName: wf.name,
    coworkerUsername: wf.username,
    status: run.status,
    startKind: run.startKind,
    initiatedByUserId: run.initiatedByUserId,
    executionUserId: run.executionUserId,
    contentVisible: canReadContent,
    triggerPayload: canReadContent ? run.triggerPayload : null,
    generationId: run.generationId,
    conversationId: canReadContent ? (run.conversationId ?? gen?.conversationId ?? null) : null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: canReadContent ? run.errorMessage : null,
    failureKind: canReadContent
      ? resolveRunFailureKind({
          runFailureKind: run.failureKind,
          runDebugInfo: run.debugInfo,
          generationFailureKind: gen?.failureKind,
          generationDebugInfo: gen?.debugInfo,
        })
      : null,
    debugInfo: canReadContent ? (run.debugInfo ?? gen?.debugInfo ?? null) : null,
    events: events.map((evt) => ({
      id: evt.id,
      type: evt.type,
      payload: evt.payload,
      createdAt: evt.createdAt,
    })),
  };
}

export async function listCoworkerRunViews(input: {
  context: RunViewContext;
  workspaceId: string;
  coworkerId: string;
  limit: number;
}) {
  await reconcileStaleCoworkerRunsForCoworker(input.coworkerId);

  const runs = await input.context.db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.coworkerId, input.coworkerId),
      eq(coworkerRun.workspaceId, input.workspaceId),
      isNull(coworkerRun.syntheticKind),
    ),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
    limit: input.limit,
  });

  return runs.map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    startKind: run.startKind,
    initiatedByUserId: run.initiatedByUserId,
    executionUserId: run.executionUserId,
    errorMessage: run.errorMessage,
    failureKind: run.failureKind,
  }));
}

export async function listWorkspaceCoworkerRunViews(input: {
  context: RunViewContext;
  workspaceId: string;
  cursor?: string;
  limit: number;
  status?: typeof coworkerRun.$inferSelect.status;
  coworkerId?: string;
}) {
  const cursor = decodeRunCursor(input.cursor);
  const accessibleCoworkers = await input.context.db.query.coworker.findMany({
    where: accessibleCoworkerFilter({
      userId: input.context.user.id,
      workspaceId: input.workspaceId,
    }),
    columns: { id: true },
  });
  const accessibleCoworkerIds = accessibleCoworkers.map((item) => item.id);
  if (accessibleCoworkerIds.length === 0) {
    return { runs: [], nextCursor: undefined };
  }
  const runs = await input.context.db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.workspaceId, input.workspaceId),
      inArray(coworkerRun.coworkerId, accessibleCoworkerIds),
      isNull(coworkerRun.syntheticKind),
      ...(input.status ? [eq(coworkerRun.status, input.status)] : []),
      ...(input.coworkerId ? [eq(coworkerRun.coworkerId, input.coworkerId)] : []),
      ...(cursor
        ? [
            or(
              lt(coworkerRun.startedAt, cursor.startedAt),
              and(eq(coworkerRun.startedAt, cursor.startedAt), lt(coworkerRun.id, cursor.runId)),
            ),
          ]
        : []),
    ),
    orderBy: [desc(coworkerRun.startedAt), desc(coworkerRun.id)],
    limit: input.limit + 1,
    with: {
      coworker: {
        columns: {
          id: true,
          name: true,
        },
      },
      generation: {
        columns: {
          conversationId: true,
          failureKind: true,
        },
      },
    },
  });

  const hasMore = runs.length > input.limit;
  const pageRuns = hasMore ? runs.slice(0, -1) : runs;

  await reconcileStaleCoworkerRunsForCoworkers(
    Array.from(
      new Set(pageRuns.map((run) => run.coworker?.id).filter((id): id is string => Boolean(id))),
    ),
  );

  return {
    runs: pageRuns.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      startKind: run.startKind,
      initiatedByUserId: run.initiatedByUserId,
      executionUserId: run.executionUserId,
      coworkerId: run.coworker?.id ?? null,
      coworkerName: run.coworker?.name?.trim() || "Untitled",
    })),
    nextCursor: hasMore
      ? encodeRunCursor({
          startedAt: pageRuns[pageRuns.length - 1]!.startedAt,
          runId: pageRuns[pageRuns.length - 1]!.id,
        })
      : undefined,
  };
}

export async function getAdminWorkspaceCoworkerRunView(input: {
  database: typeof import("@bap/db/client").db;
  workspaceId: string;
  runId: string;
}) {
  const run = await input.database.query.coworkerRun.findFirst({
    where: and(eq(coworkerRun.id, input.runId), eq(coworkerRun.workspaceId, input.workspaceId)),
    with: {
      coworker: {
        columns: {
          id: true,
          name: true,
        },
        with: {
          owner: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new ORPCError("NOT_FOUND", { message: "Run not found" });
  }

  const events = await input.database.query.coworkerRunEvent.findMany({
    where: eq(coworkerRunEvent.coworkerRunId, run.id),
    orderBy: (evt, { asc }) => [asc(evt.createdAt)],
  });
  const gen = run.generationId
    ? await input.database.query.generation.findFirst({
        where: eq(generation.id, run.generationId),
        columns: {
          conversationId: true,
          debugInfo: true,
          failureKind: true,
        },
      })
    : null;

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    failureKind: resolveRunFailureKind({
      runFailureKind: run.failureKind,
      runDebugInfo: run.debugInfo,
      generationFailureKind: gen?.failureKind,
      generationDebugInfo: gen?.debugInfo,
    }),
    debugInfo: run.debugInfo ?? gen?.debugInfo ?? null,
    conversationId: run.conversationId ?? gen?.conversationId ?? null,
    coworker: run.coworker
      ? {
          id: run.coworker.id,
          name: run.coworker.name,
          owner: run.coworker.owner,
        }
      : null,
    events: events.map((evt) => ({
      id: evt.id,
      type: evt.type,
      payload: evt.payload,
      createdAt: evt.createdAt,
    })),
  };
}
