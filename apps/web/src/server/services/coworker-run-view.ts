import {
  reconcileStaleCoworkerRunsForCoworker,
  reconcileStaleCoworkerRunsForCoworkers,
} from "@bap/core/server/services/coworker-service";
import { generation, coworker, coworkerRun, coworkerRunEvent } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
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

export async function getCoworkerRunView(input: {
  context: RunViewContext;
  workspaceId: string;
  runId: string;
}) {
  const runFilter = and(
    eq(coworkerRun.id, input.runId),
    eq(coworkerRun.ownerId, input.context.user.id),
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
      eq(coworker.ownerId, input.context.user.id),
      eq(coworker.workspaceId, input.workspaceId),
    ),
    columns: {
      id: true,
      name: true,
      username: true,
    },
  });

  if (!wf) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  const events = await input.context.db.query.coworkerRunEvent.findMany({
    where: eq(coworkerRunEvent.coworkerRunId, run.id),
    orderBy: (evt, { asc }) => [asc(evt.createdAt)],
  });
  const gen = run.generationId
    ? await input.context.db.query.generation.findFirst({
        where: eq(generation.id, run.generationId),
        columns: {
          conversationId: true,
          debugInfo: true,
        },
      })
    : null;

  return {
    id: run.id,
    coworkerId: run.coworkerId,
    coworkerName: wf.name,
    coworkerUsername: wf.username,
    status: run.status,
    triggerPayload: run.triggerPayload,
    generationId: run.generationId,
    conversationId: run.conversationId ?? gen?.conversationId ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    debugInfo: run.debugInfo ?? gen?.debugInfo ?? null,
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
      eq(coworkerRun.ownerId, input.context.user.id),
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
    errorMessage: run.errorMessage,
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
  const runs = await input.context.db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.ownerId, input.context.user.id),
      eq(coworkerRun.workspaceId, input.workspaceId),
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
      errorMessage: run.errorMessage,
      conversationId: run.conversationId ?? run.generation?.conversationId ?? null,
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
        },
      })
    : null;

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
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
