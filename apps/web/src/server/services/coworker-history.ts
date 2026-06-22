import { reconcileStaleCoworkerRunsForCoworkers } from "@bap/core/server/services/coworker-service";
import { coworkerRun, coworkerRunEvent } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getOperationLabel } from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";

const COWORKER_HISTORY_PAGE_SIZE = 100;
const HISTORY_TARGET_KEYS = [
  "channel",
  "to",
  "repo",
  "repository",
  "table",
  "base",
  "sheet",
  "spreadsheet",
  "database",
  "page",
  "parent",
  "folder",
  "file",
  "filename",
  "issue",
  "record",
  "team",
  "company",
  "calendar",
  "user",
  "owner",
  "id",
  "title",
  "subject",
  "name",
  "query",
  "text",
  "c",
  "r",
  "u",
  "o",
  "q",
] as const;
const ACTIVE_HISTORY_RUN_STATUSES = new Set([
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "cancelling",
]);
const HISTORY_INTEGRATIONS = new Set<string>([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
]);

type CoworkerRunEventOrderHelpers = {
  asc: (column: unknown) => unknown;
};

export type CoworkerHistoryStatus = "success" | "denied" | "error" | "pending";

export type CoworkerHistoryEntry = {
  id: string;
  runId: string;
  toolUseId: string;
  timestamp: Date;
  coworker: {
    id: string;
    name: string;
    username: string | null;
  };
  integration: string;
  operation: string;
  operationLabel: string;
  status: CoworkerHistoryStatus;
  target: string;
  preview: Record<string, unknown>;
};

type HistoryRunRow = {
  id: string;
  status: string;
  errorMessage: string | null;
  startedAt: Date;
  coworker: {
    id: string;
    name: string;
    username: string | null;
  } | null;
};

type HistoryEventRow = {
  id: string;
  coworkerRunId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
};

type CoworkerHistoryDatabase = {
  query: {
    coworkerRun: {
      findMany: (args: unknown) => Promise<unknown[]>;
    };
    coworkerRunEvent: {
      findMany: (args: unknown) => Promise<unknown[]>;
    };
  };
};

const historyCursorSchema = z.object({
  startedAt: z.coerce.date(),
  runId: z.string().min(1),
});

function encodeHistoryCursor(cursor: { startedAt: Date; runId: string }): string {
  return JSON.stringify({
    startedAt: cursor.startedAt.toISOString(),
    runId: cursor.runId,
  });
}

function decodeHistoryCursor(
  cursor: string | undefined,
): z.infer<typeof historyCursorSchema> | null {
  if (!cursor) {
    return null;
  }

  try {
    return historyCursorSchema.parse(JSON.parse(cursor));
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid history cursor",
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function pickTargetFromRecord(record: Record<string, unknown> | null): string | null {
  if (!record) {
    return null;
  }

  for (const key of HISTORY_TARGET_KEYS) {
    const raw = record[key];
    const stringValue = asString(raw);
    if (stringValue) {
      return stringValue;
    }

    if (Array.isArray(raw)) {
      for (const item of raw) {
        const nestedString = asString(item);
        if (nestedString) {
          return nestedString;
        }
        const nestedRecord = asRecord(item);
        const nestedTarget = pickTargetFromRecord(nestedRecord);
        if (nestedTarget) {
          return nestedTarget;
        }
      }
    }

    const nestedRecord = asRecord(raw);
    const nestedTarget = pickTargetFromRecord(nestedRecord);
    if (nestedTarget) {
      return nestedTarget;
    }
  }

  return null;
}

function getToolUseIdFromPayload(payload: Record<string, unknown>, fallbackId: string): string {
  return asString(payload.toolUseId) ?? fallbackId;
}

function getHistoryStatus(params: {
  runStatus: string;
  hasToolResult: boolean;
  resolvedInterruptStatus: string | null;
  hasPendingInterrupt: boolean;
}): CoworkerHistoryStatus {
  if (
    params.resolvedInterruptStatus === "rejected" ||
    params.resolvedInterruptStatus === "expired" ||
    params.resolvedInterruptStatus === "cancelled"
  ) {
    return "denied";
  }

  if (params.hasToolResult) {
    return "success";
  }

  if (params.hasPendingInterrupt || ACTIVE_HISTORY_RUN_STATUSES.has(params.runStatus)) {
    return "pending";
  }

  if (params.runStatus === "error" || params.runStatus === "cancelled") {
    return "error";
  }

  return "success";
}

function getHistoryTarget(params: {
  command: string | null;
  toolInput: Record<string, unknown> | null;
  toolResult: Record<string, unknown> | null;
  operationLabel: string;
}): string {
  const parsedCommand = params.command ? parseCliCommand(params.command) : null;
  const parsedTarget =
    pickTargetFromRecord(parsedCommand?.args ?? null) ?? parsedCommand?.positionalArgs[0] ?? null;
  const recordTarget =
    pickTargetFromRecord(params.toolInput) ?? pickTargetFromRecord(params.toolResult);

  return parsedTarget ?? recordTarget ?? params.operationLabel;
}

function getHistoryPreview(params: {
  command: string | null;
  toolInput: Record<string, unknown> | null;
  toolResult: Record<string, unknown> | null;
  updatedToolInput: Record<string, unknown> | null;
  status: CoworkerHistoryStatus;
  runErrorMessage: string | null;
}): Record<string, unknown> {
  const previewSource = params.updatedToolInput ?? params.toolInput ?? params.toolResult;
  const preview: Record<string, unknown> =
    previewSource && Object.keys(previewSource).length > 0
      ? { ...previewSource }
      : params.command
        ? (() => {
            const parsed = parseCliCommand(params.command);
            if (!parsed) {
              return { command: params.command };
            }

            return {
              command: parsed.rawCommand,
              args: parsed.args,
              positionalArgs: parsed.positionalArgs,
            };
          })()
        : {};

  if (params.status === "error" && params.runErrorMessage) {
    preview.error = params.runErrorMessage;
  }

  return preview;
}

function normalizeHistoryEntry(params: {
  run: HistoryRunRow;
  toolUseEvent: HistoryEventRow;
  toolResultEvent?: HistoryEventRow;
  pendingInterruptEvent?: HistoryEventRow;
  resolvedInterruptEvent?: HistoryEventRow;
  userInterruptEvent?: HistoryEventRow;
}): CoworkerHistoryEntry | null {
  const toolPayload = asRecord(params.toolUseEvent.payload);
  if (!toolPayload || toolPayload.type !== "tool_use" || toolPayload.isWrite !== true) {
    return null;
  }

  const toolUseId = getToolUseIdFromPayload(toolPayload, params.toolUseEvent.id);
  const pendingPayload = asRecord(params.pendingInterruptEvent?.payload);
  const resolvedPayload = asRecord(params.resolvedInterruptEvent?.payload);
  const userInterruptPayload = asRecord(params.userInterruptEvent?.payload);
  const resultPayload = asRecord(params.toolResultEvent?.payload);

  const pendingDisplay = asRecord(pendingPayload?.display);
  const resolvedDisplay = asRecord(resolvedPayload?.display);

  const command =
    asString(userInterruptPayload?.command) ??
    asString(pendingDisplay?.command) ??
    asString(resolvedDisplay?.command) ??
    asString(asRecord(toolPayload.toolInput)?.command);
  const parsedCommand = command ? parseCliCommand(command) : null;

  const integration =
    asString(userInterruptPayload?.integration) ??
    asString(pendingDisplay?.integration) ??
    asString(resolvedDisplay?.integration) ??
    asString(toolPayload.integration) ??
    parsedCommand?.integration ??
    null;
  const operation =
    asString(userInterruptPayload?.operation) ??
    asString(pendingDisplay?.operation) ??
    asString(resolvedDisplay?.operation) ??
    asString(toolPayload.operation) ??
    parsedCommand?.operation ??
    null;

  if (!integration || !operation || !HISTORY_INTEGRATIONS.has(integration)) {
    return null;
  }

  const toolInput =
    asRecord(userInterruptPayload?.updatedToolInput) ??
    asRecord(resolvedDisplay?.toolInput) ??
    asRecord(pendingDisplay?.toolInput) ??
    asRecord(toolPayload.toolInput);
  const updatedToolInput = asRecord(userInterruptPayload?.updatedToolInput);
  const toolResult = resultPayload ? asRecord(resultPayload.result) : null;
  const resolvedInterruptStatus = asString(resolvedPayload?.status);
  const status = getHistoryStatus({
    runStatus: params.run.status,
    hasToolResult: Boolean(params.toolResultEvent),
    resolvedInterruptStatus,
    hasPendingInterrupt: Boolean(params.pendingInterruptEvent),
  });
  const operationLabel = getOperationLabel(integration, operation);

  return {
    id: `${params.run.id}:${toolUseId}`,
    runId: params.run.id,
    toolUseId,
    timestamp: params.toolUseEvent.createdAt,
    coworker: params.run.coworker!,
    integration,
    operation,
    operationLabel,
    status,
    target: getHistoryTarget({
      command,
      toolInput,
      toolResult,
      operationLabel,
    }),
    preview: getHistoryPreview({
      command,
      toolInput,
      toolResult,
      updatedToolInput,
      status,
      runErrorMessage: params.run.errorMessage,
    }),
  };
}

export async function getCoworkerHistory(input: {
  database: CoworkerHistoryDatabase;
  userId: string;
  workspaceId: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}): Promise<{ entries: CoworkerHistoryEntry[]; nextCursor?: string }> {
  const cursor = decodeHistoryCursor(input.cursor);

  const dateFilters = [
    eq(coworkerRun.ownerId, input.userId),
    eq(coworkerRun.workspaceId, input.workspaceId),
    isNull(coworkerRun.syntheticKind),
    ...(input.from ? [gte(coworkerRun.startedAt, input.from)] : []),
    ...(input.to ? [lte(coworkerRun.startedAt, input.to)] : []),
    ...(cursor
      ? [
          or(
            lt(coworkerRun.startedAt, cursor.startedAt),
            and(eq(coworkerRun.startedAt, cursor.startedAt), lt(coworkerRun.id, cursor.runId)),
          ),
        ]
      : []),
  ];

  const pageSize = input.limit ?? COWORKER_HISTORY_PAGE_SIZE;
  const runs = (await input.database.query.coworkerRun.findMany({
    where: and(...dateFilters),
    orderBy: [desc(coworkerRun.startedAt), desc(coworkerRun.id)],
    limit: pageSize + 1,
    with: {
      coworker: {
        columns: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  })) as HistoryRunRow[];

  if (runs.length === 0) {
    return {
      entries: [],
      nextCursor: undefined,
    };
  }

  const hasMore = runs.length > pageSize;
  const pageRuns = hasMore ? runs.slice(0, -1) : runs;

  await reconcileStaleCoworkerRunsForCoworkers(
    Array.from(
      new Set(pageRuns.map((run) => run.coworker?.id).filter((id): id is string => Boolean(id))),
    ),
  );

  const runIds = pageRuns.map((run) => run.id);
  const events = (await input.database.query.coworkerRunEvent.findMany({
    where: inArray(coworkerRunEvent.coworkerRunId, runIds),
    orderBy: (event: typeof coworkerRunEvent, { asc }: CoworkerRunEventOrderHelpers) => [
      asc(event.createdAt),
    ],
  })) as HistoryEventRow[];

  const eventsByRunId = new Map<string, HistoryEventRow[]>();
  for (const event of events) {
    const current = eventsByRunId.get(event.coworkerRunId);
    if (current) {
      current.push(event);
    } else {
      eventsByRunId.set(event.coworkerRunId, [event]);
    }
  }

  const historyEntries = new Map<string, CoworkerHistoryEntry>();

  for (const run of pageRuns) {
    if (!run.coworker) {
      continue;
    }

    const runEvents = eventsByRunId.get(run.id) ?? [];
    const toolResultsById = new Map<string, HistoryEventRow>();
    const pendingInterruptsById = new Map<string, HistoryEventRow>();
    const resolvedInterruptsById = new Map<string, HistoryEventRow>();
    const userInterruptsById = new Map<string, HistoryEventRow>();

    for (const event of runEvents) {
      const payload = asRecord(event.payload);
      if (!payload) {
        continue;
      }

      if (event.type === "tool_result" && payload.type === "tool_result") {
        const toolUseId = asString(payload.toolUseId);
        if (toolUseId) {
          toolResultsById.set(toolUseId, event);
        }
        continue;
      }

      if (event.type === "interrupt_pending" && payload.type === "interrupt_pending") {
        const toolUseId = asString(payload.providerToolUseId);
        if (toolUseId) {
          pendingInterruptsById.set(toolUseId, event);
        }
        continue;
      }

      if (event.type === "interrupt_resolved" && payload.type === "interrupt_resolved") {
        const toolUseId = asString(payload.providerToolUseId);
        if (toolUseId) {
          resolvedInterruptsById.set(toolUseId, event);
        }
        continue;
      }

      if (event.type === "user_interrupt") {
        const toolUseId = asString(payload.toolUseId);
        if (toolUseId) {
          userInterruptsById.set(toolUseId, event);
        }
      }
    }

    for (const event of runEvents) {
      if (event.type !== "tool_use") {
        continue;
      }

      const payload = asRecord(event.payload);
      if (!payload) {
        continue;
      }

      const toolUseId = getToolUseIdFromPayload(payload, event.id);
      const entry = normalizeHistoryEntry({
        run,
        toolUseEvent: event,
        toolResultEvent: toolResultsById.get(toolUseId),
        pendingInterruptEvent: pendingInterruptsById.get(toolUseId),
        resolvedInterruptEvent: resolvedInterruptsById.get(toolUseId),
        userInterruptEvent: userInterruptsById.get(toolUseId),
      });

      if (entry) {
        historyEntries.set(entry.id, entry);
      }
    }
  }

  return {
    entries: Array.from(historyEntries.values()).toSorted(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    ),
    nextCursor: hasMore
      ? encodeHistoryCursor({
          startedAt: pageRuns[pageRuns.length - 1]!.startedAt,
          runId: pageRuns[pageRuns.length - 1]!.id,
        })
      : undefined,
  };
}
