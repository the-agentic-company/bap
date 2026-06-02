import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import { isAdminOnlyChatModel } from "@cmdclaw/core/lib/chat-model-policy";
import {
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  COWORKER_TOOL_ACCESS_MODES,
  normalizeCoworkerAllowedSkillSlugs,
  normalizeCoworkerToolAccessMode,
  type CoworkerToolAccessMode,
} from "@cmdclaw/core/lib/coworker-tool-policy";
import {
  buildCoworkerForwardingAddress,
  EMAIL_FORWARDED_TRIGGER_TYPE,
  generateCoworkerAliasLocalPart,
} from "@cmdclaw/core/lib/email-forwarding";
import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import {
  normalizeModelAuthSource,
  providerSupportsAuthSource,
  type ProviderAuthSource,
} from "@cmdclaw/core/lib/provider-auth-source";
import {
  listConfiguredRemoteIntegrationTargets,
  remoteIntegrationSourceSchema,
  remoteIntegrationTargetEnvSchema,
  searchRemoteIntegrationUsers,
} from "@cmdclaw/core/server/integrations/remote-integrations";
import {
  applyCoworkerEdit,
  coworkerBuilderEditSchema,
} from "@cmdclaw/core/server/services/coworker-builder-service";
import {
  generateCoworkerMetadataOnFirstPromptFill,
  normalizeAndEnsureUniqueCoworkerUsername,
} from "@cmdclaw/core/server/services/coworker-metadata";
import {
  removeCoworkerScheduleJob,
  syncCoworkerScheduleJob,
} from "@cmdclaw/core/server/services/coworker-scheduler";
import {
  reconcileStaleCoworkerRunsForCoworker,
  reconcileStaleCoworkerRunsForCoworkers,
  triggerCoworkerRun,
} from "@cmdclaw/core/server/services/coworker-service";
import { generationLifecyclePolicy } from "@cmdclaw/core/server/services/lifecycle-policy";
import { downloadFromS3 } from "@cmdclaw/core/server/storage/s3-client";
import {
  conversation,
  generation,
  user,
  coworker,
  coworkerDocument,
  coworkerEmailAlias,
  coworkerRun,
  coworkerRunEvent,
  coworkerTag,
  coworkerTagAssignment,
  workspaceMcpServer,
} from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getOperationLabel } from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";
import {
  deleteCoworkerDocument,
  uploadCoworkerDocument,
} from "@/server/services/coworker-document";
import { requireAppAdminActor } from "../app-admin-access";
import { protectedProcedure } from "../middleware";
import { queryCoworkerOverview } from "../shared/overview-queries";
import { queryUsageDashboard } from "../shared/usage-queries";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";

const integrationTypeSchema = z.enum([
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
  "reddit",
  "twitter",
]);
const DEFAULT_COWORKER_INTEGRATIONS = [...COWORKER_AVAILABLE_INTEGRATION_TYPES];
const toolAccessModeSchema = z.enum(COWORKER_TOOL_ACCESS_MODES);
const providerAuthSourceSchema = z.enum(["user", "shared"]);
const modelReferenceSchema = z
  .string()
  .min(3)
  .refine((value) => {
    try {
      parseModelReference(value);
      return true;
    } catch {
      return false;
    }
  }, "Model must use provider/model format");

const DISABLED_TRIGGER_TYPES = ["gmail.new_email"] as const;
const triggerTypeSchema = z.string().min(1).max(128);
const userInputPromptSchema = z.string().max(1000).nullish();
const COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS = 32;
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
]);
const HISTORY_INTEGRATIONS = new Set<string>(integrationTypeSchema.options);

type HistoryStatus = "success" | "denied" | "error" | "pending";

type HistoryCoworker = {
  id: string;
  name: string;
  username: string | null;
};

type HistoryEntry = {
  id: string;
  runId: string;
  toolUseId: string;
  timestamp: Date;
  coworker: HistoryCoworker;
  integration: string;
  operation: string;
  operationLabel: string;
  status: HistoryStatus;
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

type WorkspaceMcpLookupDatabase = {
  query: {
    workspaceMcpServer: {
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          namespace: string;
          createdAt: Date;
        }>
      >;
    };
  };
};

async function resolveSelectedWorkspaceMcpServerIds(input: {
  database: WorkspaceMcpLookupDatabase;
  workspaceId: string;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: string[];
  allowedWorkspaceMcpServerIds?: string[];
}): Promise<string[]> {
  const explicitWorkspaceMcpServerIds = input.allowedWorkspaceMcpServerIds ?? [];
  if (input.toolAccessMode !== "selected" || explicitWorkspaceMcpServerIds.length > 0) {
    return explicitWorkspaceMcpServerIds;
  }

  const allowedNamespaces = Array.from(new Set(input.allowedIntegrations));
  if (allowedNamespaces.length === 0) {
    return [];
  }

  const sources = await input.database.query.workspaceMcpServer.findMany({
    where: and(
      eq(workspaceMcpServer.workspaceId, input.workspaceId),
      eq(workspaceMcpServer.enabled, true),
      inArray(workspaceMcpServer.namespace, allowedNamespaces),
    ),
    columns: {
      id: true,
      namespace: true,
      createdAt: true,
    },
  });

  return sources
    .toSorted(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    )
    .map((source) => source.id);
}

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
}): HistoryStatus {
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
  status: HistoryStatus;
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
}): HistoryEntry | null {
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

function assertModelAllowedForRole(model: string, role: string | null | undefined): void {
  if (isAdminOnlyChatModel(model) && role !== "admin") {
    throw new ORPCError("FORBIDDEN", {
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  }
}

function getReceivingDomain(): string | null {
  const value = process.env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase();
  return value && value.length > 0 ? value : null;
}

function resolveCoworkerAuthSource(
  model: string,
  authSource?: ProviderAuthSource | null,
): ProviderAuthSource | null {
  const { providerID } = parseModelReference(model);
  if (authSource && !providerSupportsAuthSource(providerID, authSource)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Model provider "${providerID}" does not support auth source "${authSource}".`,
    });
  }
  return normalizeModelAuthSource({
    model,
    authSource,
  });
}

function normalizeDescriptionInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isDisabledTriggerType(triggerType: string): boolean {
  return DISABLED_TRIGGER_TYPES.includes(triggerType as (typeof DISABLED_TRIGGER_TYPES)[number]);
}

function assertNewTriggerTypeAllowed(triggerType: string): void {
  if (isDisabledTriggerType(triggerType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Coworker trigger type is disabled: ${triggerType}`,
    });
  }
}

function normalizeUserInputPromptInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertUserInputConfig(input: {
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
}): void {
  if (input.requiresUserInput && !normalizeUserInputPromptInput(input.userInputPrompt)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "User input prompt is required when user input is required.",
    });
  }
}

function normalizeCoworkerInstructionInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveCoworkerUsername(params: {
  database: unknown;
  coworkerId: string;
  username: string | null | undefined;
}): Promise<string | null> {
  if (typeof params.username !== "string") {
    return null;
  }

  const trimmed = params.username.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = await normalizeAndEnsureUniqueCoworkerUsername({
    database: params.database as {
      query: { coworker: { findFirst: (args: unknown) => Promise<unknown> } };
    },
    coworkerId: params.coworkerId,
    username: trimmed,
  });

  if (!normalized) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Username must contain letters, numbers, or hyphens",
    });
  }

  return normalized;
}

async function requireOwnedCoworkerInActiveWorkspace(
  context: {
    user: { id: string };
    db: typeof import("@cmdclaw/db/client").db;
    workspaceId?: string | null;
  },
  coworkerId: string,
) {
  const access = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const workspaceId = access.workspace.id;
  const coworkerRow = await context.db.query.coworker.findFirst({
    where: and(
      eq(coworker.id, coworkerId),
      eq(coworker.ownerId, context.user.id),
      eq(coworker.workspaceId, workspaceId),
    ),
  });

  if (!coworkerRow) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  return {
    coworker: coworkerRow,
    workspaceId,
    membershipRole: access.membership.role,
  };
}

async function requireAdminUser(context: {
  user: { id: string };
  db: typeof import("@cmdclaw/db/client").db;
}) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: {
      role: true,
      email: true,
    },
  });

  if (dbUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }

  return dbUser;
}

async function copyCoworkerDocuments(params: {
  context: {
    user: { id: string };
    db: typeof import("@cmdclaw/db/client").db;
  };
  sourceCoworkerId: string;
  targetCoworkerId: string;
  targetUserId: string;
}) {
  const documents = await params.context.db.query.coworkerDocument.findMany({
    where: eq(coworkerDocument.coworkerId, params.sourceCoworkerId),
    orderBy: (document, { asc }) => [asc(document.createdAt)],
  });

  await Promise.all(
    documents.map(async (document) => {
      const contentBase64 = (await downloadFromS3(document.storageKey)).toString("base64");
      await uploadCoworkerDocument({
        database: params.context.db as typeof import("@cmdclaw/db/client").db,
        userId: params.targetUserId,
        coworkerId: params.targetCoworkerId,
        filename: document.filename,
        mimeType: document.mimeType,
        contentBase64,
        description: document.description ?? undefined,
      });
    }),
  );
}

// Schedule configuration schema
const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    intervalMinutes: z.number().min(60).max(10080), // min 1 hour, max 1 week in minutes
  }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/), // HH:MM format
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    daysOfWeek: z.array(z.number().min(0).max(6)).min(1), // 0=Sunday, 6=Saturday
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    dayOfMonth: z.number().min(1).max(31),
    timezone: z.string().default("UTC"),
  }),
]);

const coworkerDefinitionDocumentSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  contentBase64: z.string().min(1),
});

const coworkerDefinitionSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  coworker: z.object({
    name: z.string().max(128),
    description: z.string().max(280).nullable(),
    username: z.string().max(128).nullable(),
    status: z.enum(["on", "off"]),
    triggerType: triggerTypeSchema,
    prompt: z.string().max(20000),
    model: modelReferenceSchema,
    authSource: providerAuthSourceSchema.nullable(),
    promptDo: z.string().max(2000).nullable(),
    promptDont: z.string().max(2000).nullable(),
    autoApprove: z.boolean(),
    toolAccessMode: toolAccessModeSchema,
    allowedIntegrations: z.array(integrationTypeSchema),
    allowedCustomIntegrations: z.array(z.string()),
    allowedWorkspaceMcpServerIds: z.array(z.string()),
    allowedSkillSlugs: z.array(z.string()),
    schedule: scheduleSchema.nullable(),
    requiresUserInput: z.boolean().default(false),
    userInputPrompt: userInputPromptSchema,
  }),
  documents: z.array(coworkerDefinitionDocumentSchema).default([]),
});

function getResolvedCoworkerToolPolicy(wf: {
  toolAccessMode: CoworkerToolAccessMode | null;
  allowedIntegrations: string[];
  allowedSkillSlugs: string[] | null;
}) {
  return {
    toolAccessMode: normalizeCoworkerToolAccessMode(wf.toolAccessMode, wf.allowedIntegrations),
    allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(wf.allowedSkillSlugs),
  };
}

function isBlankMetadataValue(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

async function ensureBuilderCoworkerMetadata(params: {
  context: {
    user: { id: string };
    db: unknown;
  };
  wf: typeof coworker.$inferSelect;
}): Promise<typeof coworker.$inferSelect> {
  const { context, wf } = params;
  const database = context.db as {
    query: {
      coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
    };
    update: (table: typeof coworker) => {
      set: (
        values: Partial<Pick<typeof coworker.$inferInsert, "name" | "description" | "username">>,
      ) => {
        where: (clause: unknown) => {
          returning: () => Promise<Array<typeof coworker.$inferSelect>>;
        };
      };
    };
  };

  if (!wf.builderConversationId || !wf.prompt?.trim()) {
    return wf;
  }

  if (
    !isBlankMetadataValue(wf.name) &&
    !isBlankMetadataValue(wf.description) &&
    !isBlankMetadataValue(wf.username)
  ) {
    return wf;
  }

  const coworkerQueryDatabase = database as {
    query: {
      coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
    };
  };
  const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
    database: coworkerQueryDatabase,
    current: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      username: wf.username,
      prompt: "",
      triggerType: wf.triggerType,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      schedule: wf.schedule ?? null,
      autoApprove: wf.autoApprove,
      promptDo: wf.promptDo ?? null,
      promptDont: wf.promptDont ?? null,
    },
    next: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      username: wf.username,
      prompt: wf.prompt,
      triggerType: wf.triggerType,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      schedule: wf.schedule ?? null,
      autoApprove: wf.autoApprove,
      promptDo: wf.promptDo ?? null,
      promptDont: wf.promptDont ?? null,
    },
  });

  if (Object.keys(metadataUpdates).length === 0) {
    return wf;
  }

  const [updated] = await database
    .update(coworker)
    .set(metadataUpdates)
    .where(
      wf.workspaceId
        ? and(
            eq(coworker.id, wf.id),
            eq(coworker.ownerId, context.user.id),
            eq(coworker.workspaceId, wf.workspaceId),
          )
        : and(eq(coworker.id, wf.id), eq(coworker.ownerId, context.user.id)),
    )
    .returning();

  return updated ?? { ...wf, ...metadataUpdates };
}

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(eq(coworker.ownerId, context.user.id), eq(coworker.workspaceId, workspaceId)),
    orderBy: (wf, { desc }) => [desc(wf.updatedAt)],
  });

  const coworkerIds = coworkers.map((row) => row.id);

  await reconcileStaleCoworkerRunsForCoworkers(coworkerIds);

  // Batch-fetch tag assignments for all coworkers
  const tagAssignments =
    coworkerIds.length > 0
      ? await context.db
          .select({
            coworkerId: coworkerTagAssignment.coworkerId,
            tagId: coworkerTag.id,
            tagName: coworkerTag.name,
            tagColor: coworkerTag.color,
          })
          .from(coworkerTagAssignment)
          .innerJoin(coworkerTag, eq(coworkerTagAssignment.tagId, coworkerTag.id))
          .where(inArray(coworkerTagAssignment.coworkerId, coworkerIds))
      : [];
  const tagsByCoworkerId = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const row of tagAssignments) {
    const tags = tagsByCoworkerId.get(row.coworkerId) ?? [];
    tags.push({ id: row.tagId, name: row.tagName, color: row.tagColor });
    tagsByCoworkerId.set(row.coworkerId, tags);
  }

  const rankedCoworkerRuns =
    coworkerIds.length > 0
      ? context.db
          .select({
            runId: coworkerRun.id,
            coworkerId: coworkerRun.coworkerId,
            status: coworkerRun.status,
            startedAt: coworkerRun.startedAt,
            triggerPayload: coworkerRun.triggerPayload,
            conversationId: sql<
              string | null
            >`coalesce(${coworkerRun.conversationId}, ${generation.conversationId})`.as(
              "conversation_id",
            ),
            rowNumber:
              sql<number>`row_number() over (partition by ${coworkerRun.coworkerId} order by ${coworkerRun.startedAt} desc)`.as(
                "row_number",
              ),
          })
          .from(coworkerRun)
          .leftJoin(generation, eq(coworkerRun.generationId, generation.id))
          .where(
            and(inArray(coworkerRun.coworkerId, coworkerIds), isNull(coworkerRun.syntheticKind)),
          )
          .as("ranked_coworker_runs")
      : null;

  const recentRunsByCoworkerId = new Map<
    string,
    Array<{
      id: string;
      status: string;
      startedAt: Date;
      conversationId: string | null;
      source: "trigger" | "manual";
    }>
  >();

  if (rankedCoworkerRuns) {
    const recentRunRows = await context.db
      .select({
        runId: rankedCoworkerRuns.runId,
        coworkerId: rankedCoworkerRuns.coworkerId,
        status: rankedCoworkerRuns.status,
        startedAt: rankedCoworkerRuns.startedAt,
        triggerPayload: rankedCoworkerRuns.triggerPayload,
        conversationId: rankedCoworkerRuns.conversationId,
      })
      .from(rankedCoworkerRuns)
      .where(lte(rankedCoworkerRuns.rowNumber, 20))
      .orderBy(desc(rankedCoworkerRuns.startedAt));

    for (const run of recentRunRows) {
      const payload =
        run.triggerPayload && typeof run.triggerPayload === "object"
          ? (run.triggerPayload as Record<string, unknown>)
          : null;
      const source = payload && Object.keys(payload).length > 0 ? "trigger" : "manual";
      const groupedRuns = recentRunsByCoworkerId.get(run.coworkerId) ?? [];
      groupedRuns.push({
        id: run.runId,
        status: run.status,
        startedAt: run.startedAt,
        conversationId: run.conversationId ?? null,
        source,
      });
      recentRunsByCoworkerId.set(run.coworkerId, groupedRuns);
    }
  }

  const items = await Promise.all(
    coworkers.map(async (coworkerRow) => {
      const wf = await ensureBuilderCoworkerMetadata({
        context,
        wf: coworkerRow,
      });
      const runs = recentRunsByCoworkerId.get(wf.id) ?? [];
      const lastRun = runs[0];
      const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);

      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        username: wf.username,
        folderId: wf.folderId,
        status: wf.status,
        autoApprove: wf.autoApprove,
        model: wf.model,
        authSource: wf.authSource,
        triggerType: wf.triggerType,
        integrations: wf.allowedIntegrations,
        toolAccessMode,
        allowedIntegrations: wf.allowedIntegrations,
        allowedCustomIntegrations: wf.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs,
        schedule: wf.schedule,
        requiresUserInput: wf.requiresUserInput,
        userInputPrompt: wf.userInputPrompt,
        isPinned: wf.isPinned,
        sharedAt: wf.sharedAt,
        updatedAt: wf.updatedAt,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.startedAt ?? null,
        tags: tagsByCoworkerId.get(wf.id) ?? [],
        recentRuns: runs,
      };
    }),
  );

  // Pinned coworkers first, then by updatedAt
  items.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return 0;
  });

  return items;
});

const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: coworkerRow } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    await reconcileStaleCoworkerRunsForCoworker(coworkerRow.id);

    const wf = await ensureBuilderCoworkerMetadata({
      context,
      wf: coworkerRow,
    });

    const runs = await context.db.query.coworkerRun.findMany({
      where: eq(coworkerRun.coworkerId, wf.id),
      orderBy: (run, { desc }) => [desc(run.startedAt)],
      limit: 20,
    });
    const documents = await context.db.query.coworkerDocument.findMany({
      where: eq(coworkerDocument.coworkerId, wf.id),
      orderBy: (document, { desc }) => [desc(document.createdAt)],
    });
    const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);

    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      username: wf.username,
      folderId: wf.folderId,
      status: wf.status,
      autoApprove: wf.autoApprove,
      model: wf.model,
      authSource: wf.authSource,
      triggerType: wf.triggerType,
      prompt: wf.prompt,
      promptDo: wf.promptDo,
      promptDont: wf.promptDont,
      toolAccessMode,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
      allowedSkillSlugs,
      schedule: wf.schedule,
      requiresUserInput: wf.requiresUserInput,
      userInputPrompt: wf.userInputPrompt,
      sharedAt: wf.sharedAt,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
      documents: documents.map((document) => ({
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        description: document.description,
        createdAt: document.createdAt,
      })),
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorMessage: run.errorMessage,
      })),
    };
  });

const getImpersonationTarget = protectedProcedure
  .input(z.object({ coworkerId: z.string() }))
  .handler(async ({ input, context }) => {
    await requireAppAdminActor(context);

    const wf = await context.db.query.coworker.findFirst({
      where: eq(coworker.id, input.coworkerId),
      columns: {
        id: true,
        name: true,
        username: true,
        ownerId: true,
      },
      with: {
        owner: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!wf?.ownerId || !wf.owner) {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }

    return {
      resourceType: "coworker" as const,
      resourceId: wf.id,
      resourceLabel: wf.username ? `@${wf.username}` : wf.name,
      owner: {
        id: wf.owner.id,
        name: wf.owner.name,
        email: wf.owner.email,
        image: wf.owner.image,
      },
    };
  });

const create = protectedProcedure
  .input(
    z.object({
      name: z.string().max(128).optional(),
      description: z.string().max(280).nullish(),
      username: z.string().max(128).nullish(),
      triggerType: triggerTypeSchema,
      prompt: z.string().max(20000),
      model: modelReferenceSchema.default(DEFAULT_CONNECTED_CHATGPT_MODEL),
      authSource: providerAuthSourceSchema.nullish(),
      promptDo: z.string().max(2000).optional(),
      promptDont: z.string().max(2000).optional(),
      autoApprove: z.boolean().optional(),
      toolAccessMode: toolAccessModeSchema.default("all"),
      allowedIntegrations: z.array(integrationTypeSchema).default(DEFAULT_COWORKER_INTEGRATIONS),
      allowedCustomIntegrations: z.array(z.string()).default([]),
      allowedWorkspaceMcpServerIds: z.array(z.string()).default([]),
      allowedSkillSlugs: z.array(z.string()).default([]),
      schedule: scheduleSchema.nullish(),
      requiresUserInput: z.boolean().optional(),
      userInputPrompt: userInputPromptSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    assertUserInputConfig({
      requiresUserInput: input.requiresUserInput ?? false,
      userInputPrompt: input.userInputPrompt ?? null,
    });
    const coworkerId = crypto.randomUUID();
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });
    assertModelAllowedForRole(input.model, dbUser?.role);
    const resolvedAuthSource = resolveCoworkerAuthSource(input.model, input.authSource);
    const coworkerQueryDatabase = context.db as unknown as {
      query: {
        coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
      };
    };
    const providedName = input.name?.trim();
    const nameToSave = providedName && providedName.length > 0 ? providedName : "";
    const descriptionToSave = normalizeDescriptionInput(input.description);
    const usernameToSave = await resolveCoworkerUsername({
      database: coworkerQueryDatabase,
      coworkerId,
      username: input.username,
    });
    assertNewTriggerTypeAllowed(input.triggerType);
    const allowedWorkspaceMcpServerIds = await resolveSelectedWorkspaceMcpServerIds({
      database: context.db as WorkspaceMcpLookupDatabase,
      workspaceId,
      toolAccessMode: input.toolAccessMode,
      allowedIntegrations: input.allowedIntegrations,
      allowedWorkspaceMcpServerIds: input.allowedWorkspaceMcpServerIds,
    });

    const [created] = await context.db
      .insert(coworker)
      .values({
        id: coworkerId,
        name: nameToSave,
        description: descriptionToSave,
        username: usernameToSave,
        ownerId: context.user.id,
        workspaceId,
        status: "on",
        triggerType: input.triggerType,
        prompt: input.prompt,
        model: input.model,
        authSource: resolvedAuthSource,
        promptDo: input.promptDo,
        promptDont: input.promptDont,
        autoApprove: input.autoApprove ?? true,
        allowedIntegrations: input.allowedIntegrations,
        allowedCustomIntegrations: input.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds,
        toolAccessMode: input.toolAccessMode,
        allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(input.allowedSkillSlugs),
        schedule: input.schedule ?? null,
        requiresUserInput: input.requiresUserInput ?? false,
        userInputPrompt: normalizeUserInputPromptInput(input.userInputPrompt),
      })
      .returning();

    if (created.triggerType === "schedule") {
      try {
        await syncCoworkerScheduleJob(created);
      } catch (error) {
        console.error(`[coworker] failed to sync scheduler after create (${created.id})`, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Coworker created but failed to sync schedule job",
        });
      }
    }

    return {
      id: created.id,
      name: created.name,
      description: created.description,
      username: created.username,
      status: created.status,
    };
  });

const update = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      name: z.string().max(128).optional(),
      description: z.string().max(280).nullish(),
      username: z.string().max(128).nullish(),
      status: z.enum(["on", "off"]).optional(),
      triggerType: triggerTypeSchema.optional(),
      prompt: z.string().max(20000).optional(),
      model: modelReferenceSchema.optional(),
      authSource: providerAuthSourceSchema.nullish(),
      promptDo: z.string().max(2000).nullish(),
      promptDont: z.string().max(2000).nullish(),
      autoApprove: z.boolean().optional(),
      isPinned: z.boolean().optional(),
      toolAccessMode: toolAccessModeSchema.optional(),
      allowedIntegrations: z.array(integrationTypeSchema).optional(),
      allowedCustomIntegrations: z.array(z.string()).optional(),
      allowedWorkspaceMcpServerIds: z.array(z.string()).optional(),
      allowedSkillSlugs: z.array(z.string()).optional(),
      schedule: scheduleSchema.nullish(),
      requiresUserInput: z.boolean().optional(),
      userInputPrompt: userInputPromptSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: existing, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    if (input.model !== undefined) {
      const dbUser = await context.db.query.user.findFirst({
        where: eq(user.id, context.user.id),
        columns: { role: true },
      });
      assertModelAllowedForRole(input.model, dbUser?.role);
    }

    const updates: Partial<typeof coworker.$inferInsert> = {};
    const nextPrompt = input.prompt ?? existing.prompt;
    const nextName = input.name !== undefined ? input.name.trim() : (existing.name ?? "");
    const nextDescription =
      input.description !== undefined
        ? normalizeDescriptionInput(input.description)
        : existing.description;
    const coworkerQueryDatabase = context.db as unknown as {
      query: {
        coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
      };
    };
    const nextUsername =
      input.username !== undefined
        ? await resolveCoworkerUsername({
            database: coworkerQueryDatabase,
            coworkerId: existing.id,
            username: input.username,
          })
        : existing.username;
    const nextRequiresUserInput = input.requiresUserInput ?? existing.requiresUserInput;
    const nextUserInputPrompt =
      input.userInputPrompt !== undefined
        ? normalizeUserInputPromptInput(input.userInputPrompt)
        : existing.userInputPrompt;
    assertUserInputConfig({
      requiresUserInput: nextRequiresUserInput,
      userInputPrompt: nextUserInputPrompt,
    });

    if (input.name !== undefined) {
      updates.name = nextName;
    }
    if (input.description !== undefined) {
      updates.description = nextDescription;
    }
    if (input.username !== undefined) {
      updates.username = nextUsername;
    }
    if (input.status !== undefined) {
      updates.status = input.status;
    }
    if (input.triggerType !== undefined) {
      if (input.triggerType !== existing.triggerType) {
        assertNewTriggerTypeAllowed(input.triggerType);
      }
      updates.triggerType = input.triggerType;
    }
    if (input.prompt !== undefined) {
      updates.prompt = input.prompt;
    }
    if (input.model !== undefined) {
      updates.model = input.model;
      updates.authSource = resolveCoworkerAuthSource(
        input.model,
        input.authSource ?? existing.authSource,
      );
    } else if (input.authSource !== undefined) {
      updates.authSource = resolveCoworkerAuthSource(existing.model, input.authSource);
    }
    if (input.promptDo !== undefined) {
      updates.promptDo = input.promptDo ?? null;
    }
    if (input.promptDont !== undefined) {
      updates.promptDont = input.promptDont ?? null;
    }
    if (input.autoApprove !== undefined) {
      updates.autoApprove = input.autoApprove;
    }
    if (input.isPinned !== undefined) {
      updates.isPinned = input.isPinned;
    }
    if (input.toolAccessMode !== undefined) {
      updates.toolAccessMode = input.toolAccessMode;
    }
    if (input.allowedIntegrations !== undefined) {
      updates.allowedIntegrations = input.allowedIntegrations;
    }
    if (input.allowedCustomIntegrations !== undefined) {
      updates.allowedCustomIntegrations = input.allowedCustomIntegrations;
    }
    if (input.allowedWorkspaceMcpServerIds !== undefined) {
      updates.allowedWorkspaceMcpServerIds = input.allowedWorkspaceMcpServerIds;
    }
    if (input.allowedSkillSlugs !== undefined) {
      updates.allowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(input.allowedSkillSlugs);
    }
    if (input.schedule !== undefined) {
      updates.schedule = input.schedule ?? null;
    }
    if (input.requiresUserInput !== undefined) {
      updates.requiresUserInput = input.requiresUserInput;
    }
    if (input.userInputPrompt !== undefined) {
      updates.userInputPrompt = nextUserInputPrompt;
    }

    const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
      database: coworkerQueryDatabase,
      current: {
        id: existing.id,
        name: existing.name,
        description: existing.description,
        username: existing.username,
        prompt: existing.prompt,
        triggerType: existing.triggerType,
        allowedIntegrations: existing.allowedIntegrations,
        allowedCustomIntegrations: existing.allowedCustomIntegrations,
        schedule: existing.schedule ?? null,
        autoApprove: existing.autoApprove,
        promptDo: existing.promptDo ?? null,
        promptDont: existing.promptDont ?? null,
      },
      next: {
        id: existing.id,
        name: nextName,
        description: nextDescription,
        username: nextUsername,
        prompt: nextPrompt,
        triggerType: input.triggerType ?? existing.triggerType,
        allowedIntegrations: input.allowedIntegrations ?? existing.allowedIntegrations,
        allowedCustomIntegrations:
          input.allowedCustomIntegrations ?? existing.allowedCustomIntegrations,
        schedule: input.schedule === undefined ? existing.schedule : (input.schedule ?? null),
        autoApprove: input.autoApprove ?? existing.autoApprove,
        promptDo: input.promptDo === undefined ? existing.promptDo : (input.promptDo ?? null),
        promptDont:
          input.promptDont === undefined ? existing.promptDont : (input.promptDont ?? null),
      },
    });
    Object.assign(updates, metadataUpdates);

    const result = await context.db
      .update(coworker)
      .set(updates)
      .where(
        and(
          eq(coworker.id, input.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      )
      .returning({
        id: coworker.id,
        status: coworker.status,
        triggerType: coworker.triggerType,
        schedule: coworker.schedule,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }

    const shouldSyncSchedule =
      input.status !== undefined || input.triggerType !== undefined || input.schedule !== undefined;

    if (shouldSyncSchedule) {
      try {
        await syncCoworkerScheduleJob(result[0]!);
      } catch (error) {
        console.error(`[coworker] failed to sync scheduler after update (${input.id})`, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Coworker updated but failed to sync schedule job",
        });
      }
    }

    return { success: true };
  });

const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: existing, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    if (existing.triggerType === "schedule") {
      try {
        await removeCoworkerScheduleJob(input.id);
      } catch (error) {
        console.error(`[coworker] failed to remove scheduler before delete (${input.id})`, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to remove coworker schedule job",
        });
      }
    }

    const result = await context.db
      .delete(coworker)
      .where(
        and(
          eq(coworker.id, input.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      )
      .returning({ id: coworker.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }

    return { success: true };
  });

const edit = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      baseUpdatedAt: z.string().datetime({ offset: true }),
      changes: coworkerBuilderEditSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    await requireOwnedCoworkerInActiveWorkspace(context, input.coworkerId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    const result = await applyCoworkerEdit({
      database: context.db as unknown,
      userId: context.user.id,
      userRole: dbUser?.role ?? null,
      coworkerId: input.coworkerId,
      baseUpdatedAt: input.baseUpdatedAt,
      changes: input.changes,
    });

    return result;
  });

const uploadDocument = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      filename: z.string().min(1).max(256),
      mimeType: z.string().min(1),
      content: z.string().min(1),
      description: z.string().max(1024).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireOwnedCoworkerInActiveWorkspace(context, input.coworkerId);
    return uploadCoworkerDocument({
      database: context.db as typeof import("@cmdclaw/db/client").db,
      userId: context.user.id,
      coworkerId: input.coworkerId,
      filename: input.filename,
      mimeType: input.mimeType,
      contentBase64: input.content,
      description: input.description,
    });
  });

const deleteDocument = protectedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existingDocument = await context.db.query.coworkerDocument.findFirst({
      where: eq(coworkerDocument.id, input.id),
      columns: { coworkerId: true },
    });

    if (!existingDocument) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await requireOwnedCoworkerInActiveWorkspace(context, existingDocument.coworkerId);
    return deleteCoworkerDocument({
      database: context.db as typeof import("@cmdclaw/db/client").db,
      userId: context.user.id,
      documentId: input.id,
    });
  });

const getDocumentUrl = protectedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existingDocument = await context.db.query.coworkerDocument.findFirst({
      where: eq(coworkerDocument.id, input.id),
      columns: {
        coworkerId: true,
        filename: true,
        mimeType: true,
        storageKey: true,
      },
    });

    if (!existingDocument) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await requireOwnedCoworkerInActiveWorkspace(context, existingDocument.coworkerId);
    return {
      url: `/api/coworkers/documents/${encodeURIComponent(input.id)}/download`,
      filename: existingDocument.filename,
      mimeType: existingDocument.mimeType,
    };
  });

const trigger = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      payload: z.unknown().optional(),
      fileAttachments: z
        .array(
          z.object({
            name: z.string(),
            mimeType: z.string(),
            dataUrl: z.string(),
          }),
        )
        .optional(),
      trustedUserInput: z.string().max(100000).optional(),
      remoteIntegrationSource: remoteIntegrationSourceSchema
        .pick({
          targetEnv: true,
          remoteUserId: true,
        })
        .optional(),
      debugRunDeadlineMs: z
        .number()
        .int()
        .min(1_000)
        .max(generationLifecyclePolicy.runDeadlineMs)
        .optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireOwnedCoworkerInActiveWorkspace(context, input.id);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true, email: true },
    });

    if (input.remoteIntegrationSource && dbUser?.role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
    }

    return triggerCoworkerRun({
      coworkerId: input.id,
      triggerPayload: input.payload ?? {},
      trustedUserInput: input.trustedUserInput,
      fileAttachments: input.fileAttachments,
      userId: context.user.id,
      userRole: dbUser?.role ?? null,
      debugRunDeadlineMs: input.debugRunDeadlineMs,
      remoteIntegrationSource: input.remoteIntegrationSource
        ? {
            ...input.remoteIntegrationSource,
            requestedByUserId: context.user.id,
            requestedByEmail: dbUser?.email ?? null,
          }
        : undefined,
    });
  });

const listRemoteIntegrationTargets = protectedProcedure.handler(async ({ context }) => {
  await requireAdminUser(context);
  return {
    targets: listConfiguredRemoteIntegrationTargets(),
  };
});

const searchRemoteIntegrationUsersProcedure = protectedProcedure
  .input(
    z.object({
      targetEnv: remoteIntegrationTargetEnvSchema,
      query: z.string().default(""),
      limit: z.number().int().min(1).max(25).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAdminUser(context);

    return {
      users: await searchRemoteIntegrationUsers({
        targetEnv: input.targetEnv,
        query: input.query,
        limit: input.limit,
      }),
    };
  });

const getRun = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const runFilter = and(
      eq(coworkerRun.id, input.id),
      eq(coworkerRun.ownerId, context.user.id),
      eq(coworkerRun.workspaceId, workspaceId),
      isNull(coworkerRun.syntheticKind),
    );

    const initialRun = await context.db.query.coworkerRun.findFirst({
      where: runFilter,
    });

    if (!initialRun) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }

    await reconcileStaleCoworkerRunsForCoworker(initialRun.coworkerId);

    const run = await context.db.query.coworkerRun.findFirst({
      where: runFilter,
    });

    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }

    const wf = await context.db.query.coworker.findFirst({
      where: and(
        eq(coworker.id, run.coworkerId),
        eq(coworker.ownerId, context.user.id),
        eq(coworker.workspaceId, workspaceId),
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

    const events = await context.db.query.coworkerRunEvent.findMany({
      where: eq(coworkerRunEvent.coworkerRunId, run.id),
      orderBy: (evt, { asc }) => [asc(evt.createdAt)],
    });
    const gen = run.generationId
      ? await context.db.query.generation.findFirst({
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
  });

const getRunImpersonationTarget = protectedProcedure
  .input(
    z.object({
      runId: z.string(),
      coworkerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAppAdminActor(context);

    const filters = [eq(coworkerRun.id, input.runId)];
    if (input.coworkerId) {
      filters.push(eq(coworkerRun.coworkerId, input.coworkerId));
    }

    const run = await context.db.query.coworkerRun.findFirst({
      where: and(...filters),
      columns: {
        id: true,
        coworkerId: true,
        ownerId: true,
      },
      with: {
        owner: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        coworker: {
          columns: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!run?.ownerId || !run.owner) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }

    return {
      resourceType: "coworker_run" as const,
      resourceId: run.id,
      resourceLabel: run.coworker?.username
        ? `@${run.coworker.username}`
        : (run.coworker?.name ?? "Coworker run"),
      owner: {
        id: run.owner.id,
        name: run.owner.name,
        email: run.owner.email,
        image: run.owner.image,
      },
    };
  });

const listRuns = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      limit: z.number().min(1).max(50).default(20),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );

    await reconcileStaleCoworkerRunsForCoworker(wf.id);

    const runs = await context.db.query.coworkerRun.findMany({
      where: and(
        eq(coworkerRun.coworkerId, wf.id),
        eq(coworkerRun.ownerId, context.user.id),
        eq(coworkerRun.workspaceId, workspaceId),
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
  });

const listWorkspaceRuns = protectedProcedure
  .input(
    z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      status: z
        .enum([
          "needs_user_input",
          "running",
          "awaiting_approval",
          "awaiting_auth",
          "paused",
          "completed",
          "error",
          "cancelled",
        ])
        .optional(),
      coworkerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const cursor = decodeHistoryCursor(input.cursor);
    const runs = await context.db.query.coworkerRun.findMany({
      where: and(
        eq(coworkerRun.ownerId, context.user.id),
        eq(coworkerRun.workspaceId, workspaceId),
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
        ? encodeHistoryCursor({
            startedAt: pageRuns[pageRuns.length - 1]!.startedAt,
            runId: pageRuns[pageRuns.length - 1]!.id,
          })
        : undefined,
    };
  });

const getHistory = protectedProcedure
  .input(
    z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(200).default(COWORKER_HISTORY_PAGE_SIZE),
      })
      .optional(),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const cursor = decodeHistoryCursor(input?.cursor);

    const dateFilters = [
      eq(coworkerRun.ownerId, context.user.id),
      eq(coworkerRun.workspaceId, workspaceId),
      isNull(coworkerRun.syntheticKind),
      ...(input?.from ? [gte(coworkerRun.startedAt, input.from)] : []),
      ...(input?.to ? [lte(coworkerRun.startedAt, input.to)] : []),
      ...(cursor
        ? [
            or(
              lt(coworkerRun.startedAt, cursor.startedAt),
              and(eq(coworkerRun.startedAt, cursor.startedAt), lt(coworkerRun.id, cursor.runId)),
            ),
          ]
        : []),
    ];

    const pageSize = input?.limit ?? COWORKER_HISTORY_PAGE_SIZE;
    const runs = (await context.db.query.coworkerRun.findMany({
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
        entries: [] as HistoryEntry[],
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
    const events = (await context.db.query.coworkerRunEvent.findMany({
      where: inArray(coworkerRunEvent.coworkerRunId, runIds),
      orderBy: (event, { asc }) => [asc(event.createdAt)],
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

    const historyEntries = new Map<string, HistoryEntry>();

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
  });

const getForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    const receivingDomain = getReceivingDomain();
    if (!receivingDomain || wf.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
      return {
        receivingDomain,
        activeAlias: null,
        forwardingAddress: null,
      };
    }

    const activeAlias = await context.db.query.coworkerEmailAlias.findFirst({
      where: and(
        eq(coworkerEmailAlias.coworkerId, wf.id),
        eq(coworkerEmailAlias.domain, receivingDomain),
        eq(coworkerEmailAlias.status, "active"),
      ),
      columns: {
        id: true,
        localPart: true,
        domain: true,
        status: true,
        createdAt: true,
      },
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });

    return {
      receivingDomain,
      activeAlias,
      forwardingAddress: activeAlias
        ? buildCoworkerForwardingAddress(activeAlias.localPart, receivingDomain)
        : null,
    };
  });

const createForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const receivingDomain = getReceivingDomain();
    if (!receivingDomain) {
      throw new ORPCError("BAD_REQUEST", {
        message: "RESEND_RECEIVING_DOMAIN is not configured",
      });
    }

    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    if (wf.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Coworker trigger must be email.forwarded to create an email alias",
      });
    }

    const existing = await context.db.query.coworkerEmailAlias.findFirst({
      where: and(
        eq(coworkerEmailAlias.coworkerId, wf.id),
        eq(coworkerEmailAlias.domain, receivingDomain),
        eq(coworkerEmailAlias.status, "active"),
      ),
      columns: {
        id: true,
        localPart: true,
        domain: true,
        status: true,
        createdAt: true,
      },
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });

    if (existing) {
      return {
        alias: existing,
        forwardingAddress: buildCoworkerForwardingAddress(existing.localPart, receivingDomain),
      };
    }

    const insertAlias = async (
      attempt = 0,
    ): Promise<{
      id: string;
      localPart: string;
      domain: string;
      status: "active" | "disabled" | "rotated" | "deleted";
      createdAt: Date;
    } | null> => {
      if (attempt >= COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS) {
        return null;
      }

      const localPart =
        attempt < COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS / 2
          ? generateCoworkerAliasLocalPart()
          : `${generateCoworkerAliasLocalPart()}-${crypto.randomUUID().slice(0, 6)}`;
      const created = await context.db
        .insert(coworkerEmailAlias)
        .values({
          coworkerId: wf.id,
          localPart,
          domain: receivingDomain,
          status: "active" as const,
        })
        .onConflictDoNothing({
          target: [coworkerEmailAlias.localPart, coworkerEmailAlias.domain],
        })
        .returning({
          id: coworkerEmailAlias.id,
          localPart: coworkerEmailAlias.localPart,
          domain: coworkerEmailAlias.domain,
          status: coworkerEmailAlias.status,
          createdAt: coworkerEmailAlias.createdAt,
        });

      if (created[0]) {
        return created[0];
      }

      return insertAlias(attempt + 1);
    };

    const created = await insertAlias();

    if (created) {
      return {
        alias: created,
        forwardingAddress: buildCoworkerForwardingAddress(created.localPart, receivingDomain),
      };
    }

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Failed to create unique forwarding alias",
    });
  });

const disableForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    const activeAlias = await context.db.query.coworkerEmailAlias.findFirst({
      where: and(eq(coworkerEmailAlias.coworkerId, wf.id), eq(coworkerEmailAlias.status, "active")),
      columns: { id: true },
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });

    if (!activeAlias) {
      return { success: true, disabled: false };
    }

    await context.db
      .update(coworkerEmailAlias)
      .set({
        status: "disabled",
        disabledAt: new Date(),
        disabledReason: "manual_disable",
      })
      .where(eq(coworkerEmailAlias.id, activeAlias.id));

    return { success: true, disabled: true };
  });

const rotateForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const receivingDomain = getReceivingDomain();
    if (!receivingDomain) {
      throw new ORPCError("BAD_REQUEST", {
        message: "RESEND_RECEIVING_DOMAIN is not configured",
      });
    }

    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    if (wf.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Coworker trigger must be email.forwarded to rotate an email alias",
      });
    }

    const result = await context.db.transaction(async (tx) => {
      const currentActive = await tx.query.coworkerEmailAlias.findFirst({
        where: and(
          eq(coworkerEmailAlias.coworkerId, wf.id),
          eq(coworkerEmailAlias.domain, receivingDomain),
          eq(coworkerEmailAlias.status, "active"),
        ),
        columns: { id: true, localPart: true },
        orderBy: (row, { desc }) => [desc(row.createdAt)],
      });

      const insertAlias = async (
        attempt = 0,
      ): Promise<{
        id: string;
        localPart: string;
        domain: string;
        status: "active" | "disabled" | "rotated" | "deleted";
        createdAt: Date;
      } | null> => {
        if (attempt >= COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS) {
          return null;
        }

        const localPart =
          attempt < COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS / 2
            ? generateCoworkerAliasLocalPart()
            : `${generateCoworkerAliasLocalPart()}-${crypto.randomUUID().slice(0, 6)}`;
        const created = await tx
          .insert(coworkerEmailAlias)
          .values({
            coworkerId: wf.id,
            localPart,
            domain: receivingDomain,
            status: "active" as const,
          })
          .onConflictDoNothing({
            target: [coworkerEmailAlias.localPart, coworkerEmailAlias.domain],
          })
          .returning({
            id: coworkerEmailAlias.id,
            localPart: coworkerEmailAlias.localPart,
            domain: coworkerEmailAlias.domain,
            status: coworkerEmailAlias.status,
            createdAt: coworkerEmailAlias.createdAt,
          });

        if (created[0]) {
          return created[0];
        }

        return insertAlias(attempt + 1);
      };

      const created = await insertAlias();

      if (!created) {
        return null;
      }

      if (currentActive) {
        await tx
          .update(coworkerEmailAlias)
          .set({
            status: "rotated",
            disabledAt: new Date(),
            disabledReason: "rotated",
            replacedByAliasId: created.id,
          })
          .where(eq(coworkerEmailAlias.id, currentActive.id));
      }

      return created;
    });

    if (!result) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to rotate forwarding alias",
      });
    }

    return {
      alias: result,
      forwardingAddress: buildCoworkerForwardingAddress(result.localPart, receivingDomain),
    };
  });

const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    const [shared] = await context.db
      .update(coworker)
      .set({ sharedAt: new Date() })
      .where(
        and(
          eq(coworker.id, wf.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      )
      .returning({ id: coworker.id, sharedAt: coworker.sharedAt });

    return {
      success: true,
      id: shared?.id ?? wf.id,
      sharedAt: shared?.sharedAt ?? new Date(),
    };
  });

const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    await context.db
      .update(coworker)
      .set({ sharedAt: null })
      .where(
        and(
          eq(coworker.id, wf.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  });

const listShared = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(eq(coworker.workspaceId, workspaceId)),
    with: {
      owner: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      documents: {
        columns: { id: true },
      },
    },
    orderBy: (wf, { desc }) => [desc(wf.sharedAt), desc(wf.updatedAt)],
  });

  return coworkers
    .filter((wf) => wf.sharedAt)
    .map((wf) => {
      const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);
      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        username: wf.username,
        triggerType: wf.triggerType,
        toolAccessMode,
        allowedIntegrations: wf.allowedIntegrations,
        allowedSkillSlugs,
        allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
        prompt: wf.prompt,
        model: wf.model,
        sharedAt: wf.sharedAt,
        updatedAt: wf.updatedAt,
        owner: {
          id: wf.owner.id,
          name: wf.owner.name,
          email: wf.owner.email,
        },
        documentCount: wf.documents.length,
        isOwnedByCurrentUser: wf.ownerId === context.user.id,
      };
    });
});

const exportDefinition = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: coworkerRow } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    const wf = await ensureBuilderCoworkerMetadata({
      context,
      wf: coworkerRow,
    });
    const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);
    const documents = await context.db.query.coworkerDocument.findMany({
      where: eq(coworkerDocument.coworkerId, wf.id),
      orderBy: (document, { asc }) => [asc(document.createdAt)],
    });

    return {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      coworker: {
        name: wf.name ?? "",
        description: wf.description,
        username: wf.username,
        status: wf.status,
        triggerType: wf.triggerType,
        prompt: wf.prompt,
        model: wf.model,
        authSource: wf.authSource,
        promptDo: wf.promptDo,
        promptDont: wf.promptDont,
        autoApprove: wf.autoApprove,
        toolAccessMode,
        allowedIntegrations: wf.allowedIntegrations,
        allowedCustomIntegrations: wf.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs,
        schedule: wf.schedule ?? null,
        requiresUserInput: wf.requiresUserInput,
        userInputPrompt: wf.userInputPrompt,
      },
      documents: await Promise.all(
        documents.map(async (document) => ({
          filename: document.filename,
          mimeType: document.mimeType,
          description: document.description,
          contentBase64: (await downloadFromS3(document.storageKey)).toString("base64"),
        })),
      ),
    };
  });

const importShared = protectedProcedure
  .input(
    z.object({
      sourceCoworkerId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    const source = await context.db.query.coworker.findFirst({
      where: and(eq(coworker.id, input.sourceCoworkerId), eq(coworker.workspaceId, workspaceId)),
    });

    if (!source || !source.sharedAt) {
      throw new ORPCError("NOT_FOUND", {
        message: "Shared coworker not found",
      });
    }

    assertModelAllowedForRole(source.model, dbUser?.role);

    const coworkerId = crypto.randomUUID();
    const coworkerQueryDatabase = context.db as unknown as {
      query: {
        coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
      };
    };
    const username = await resolveCoworkerUsername({
      database: coworkerQueryDatabase,
      coworkerId,
      username: source.username,
    });

    const [created] = await context.db
      .insert(coworker)
      .values({
        id: coworkerId,
        name: source.name,
        description: source.description,
        username,
        ownerId: context.user.id,
        workspaceId,
        status: "off",
        triggerType: source.triggerType,
        prompt: source.prompt,
        model: source.model,
        authSource: source.authSource,
        promptDo: source.promptDo,
        promptDont: source.promptDont,
        autoApprove: source.autoApprove,
        toolAccessMode: source.toolAccessMode,
        allowedIntegrations: source.allowedIntegrations,
        allowedCustomIntegrations: source.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: source.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs: source.allowedSkillSlugs,
        schedule: source.schedule,
        requiresUserInput: source.requiresUserInput,
        userInputPrompt: source.userInputPrompt,
        sharedAt: null,
      })
      .returning({
        id: coworker.id,
        name: coworker.name,
        description: coworker.description,
        username: coworker.username,
        status: coworker.status,
      });

    await copyCoworkerDocuments({
      context,
      sourceCoworkerId: source.id,
      targetCoworkerId: coworkerId,
      targetUserId: context.user.id,
    });

    return created;
  });

const importDefinition = protectedProcedure
  .input(
    z.object({
      definitionJson: z.string().min(2).max(50_000_000),
    }),
  )
  .handler(async ({ input, context }) => {
    let parsedDefinition: unknown;

    try {
      parsedDefinition = JSON.parse(input.definitionJson);
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Coworker JSON is not valid JSON.",
      });
    }

    const definition = coworkerDefinitionSchema.parse(parsedDefinition);
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    assertModelAllowedForRole(definition.coworker.model, dbUser?.role);
    assertUserInputConfig({
      requiresUserInput: definition.coworker.requiresUserInput,
      userInputPrompt: definition.coworker.userInputPrompt,
    });

    const coworkerId = crypto.randomUUID();
    const coworkerQueryDatabase = context.db as unknown as {
      query: {
        coworker: { findFirst: (...args: unknown[]) => Promise<unknown> };
      };
    };
    const username = await resolveCoworkerUsername({
      database: coworkerQueryDatabase,
      coworkerId,
      username: definition.coworker.username,
    });
    const resolvedAuthSource = resolveCoworkerAuthSource(
      definition.coworker.model,
      definition.coworker.authSource,
    );

    const [created] = await context.db
      .insert(coworker)
      .values({
        id: coworkerId,
        name: definition.coworker.name.trim(),
        description: normalizeDescriptionInput(definition.coworker.description),
        username,
        ownerId: context.user.id,
        workspaceId,
        status: "off",
        triggerType: definition.coworker.triggerType,
        prompt: definition.coworker.prompt,
        model: definition.coworker.model,
        authSource: resolvedAuthSource,
        promptDo: normalizeCoworkerInstructionInput(definition.coworker.promptDo),
        promptDont: normalizeCoworkerInstructionInput(definition.coworker.promptDont),
        autoApprove: definition.coworker.autoApprove,
        toolAccessMode: definition.coworker.toolAccessMode,
        allowedIntegrations: definition.coworker.allowedIntegrations,
        allowedCustomIntegrations: definition.coworker.allowedCustomIntegrations,
        allowedWorkspaceMcpServerIds: definition.coworker.allowedWorkspaceMcpServerIds,
        allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(
          definition.coworker.allowedSkillSlugs,
        ),
        schedule: definition.coworker.schedule,
        requiresUserInput: definition.coworker.requiresUserInput,
        userInputPrompt: normalizeUserInputPromptInput(definition.coworker.userInputPrompt),
        sharedAt: null,
      })
      .returning({
        id: coworker.id,
        name: coworker.name,
        description: coworker.description,
        username: coworker.username,
        status: coworker.status,
      });

    await Promise.all(
      definition.documents.map((document) =>
        uploadCoworkerDocument({
          database: context.db as typeof import("@cmdclaw/db/client").db,
          userId: context.user.id,
          coworkerId,
          filename: document.filename,
          mimeType: document.mimeType,
          contentBase64: document.contentBase64,
          description: document.description ?? undefined,
        }),
      ),
    );

    return created;
  });

const adminListWorkspaceCoworkers = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAdmin(context.user.id);
  const coworkers = await context.db.query.coworker.findMany({
    where: eq(coworker.workspaceId, workspaceId),
    with: {
      owner: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: (wf, { desc }) => [desc(wf.updatedAt)],
  });

  return coworkers.map((wf) => ({
    id: wf.id,
    name: wf.name,
    description: wf.description,
    status: wf.status,
    triggerType: wf.triggerType,
    sharedAt: wf.sharedAt,
    updatedAt: wf.updatedAt,
    owner: wf.owner,
  }));
});

const adminGetWorkspaceRun = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAdmin(context.user.id);
    const run = await context.db.query.coworkerRun.findFirst({
      where: and(eq(coworkerRun.id, input.id), eq(coworkerRun.workspaceId, workspaceId)),
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

    const events = await context.db.query.coworkerRunEvent.findMany({
      where: eq(coworkerRunEvent.coworkerRunId, run.id),
      orderBy: (evt, { asc }) => [asc(evt.createdAt)],
    });
    const gen = run.generationId
      ? await context.db.query.generation.findFirst({
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
  });

const getOrCreateBuilderConversation = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: ownedCoworker, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    const wf = {
      id: ownedCoworker.id,
      name: ownedCoworker.name,
      builderConversationId: ownedCoworker.builderConversationId,
      model: ownedCoworker.model,
      authSource: ownedCoworker.authSource,
    };

    // Return existing conversation if it still exists
    if (wf.builderConversationId) {
      const existing = await context.db.query.conversation.findFirst({
        where: eq(conversation.id, wf.builderConversationId),
        columns: {
          id: true,
          autoApprove: true,
          workspaceId: true,
          userId: true,
          type: true,
        },
      });
      if (existing) {
        if (existing.autoApprove) {
          await context.db
            .update(conversation)
            .set({ autoApprove: false })
            .where(
              and(
                eq(conversation.id, existing.id),
                eq(conversation.userId, context.user.id),
                eq(conversation.workspaceId, workspaceId),
                eq(conversation.type, "coworker"),
              ),
            );
        }
        if (
          existing.userId === context.user.id &&
          existing.workspaceId === workspaceId &&
          existing.type === "coworker"
        ) {
          return { conversationId: existing.id };
        }
      }
    }

    // Create a new builder conversation
    const [created] = await context.db
      .insert(conversation)
      .values({
        userId: context.user.id,
        workspaceId,
        type: "coworker",
        title: `${wf.name || "Coworker"} – Chat`,
        model: wf.model,
        authSource: wf.authSource,
        autoApprove: false,
      })
      .returning({ id: conversation.id });

    if (!created) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create conversation",
      });
    }

    await context.db
      .update(coworker)
      .set({ builderConversationId: created.id })
      .where(
        and(
          eq(coworker.id, wf.id),
          eq(coworker.ownerId, context.user.id),
          eq(coworker.workspaceId, workspaceId),
        ),
      );

    return { conversationId: created.id };
  });

// ---------------------------------------------------------------------------
// Overview / dashboard aggregation
// ---------------------------------------------------------------------------

const getOverview = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  return queryCoworkerOverview(context.db, {
    workspaceId,
    ownerId: context.user.id,
  });
});

const getUsageDashboard = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  return queryUsageDashboard(context.db, workspaceId);
});

export const coworkerRouter = {
  list,
  get,
  getHistory,
  getOverview,
  getUsageDashboard,
  getImpersonationTarget,
  create,
  update,
  edit,
  uploadDocument,
  getDocumentUrl,
  deleteDocument,
  delete: del,
  trigger,
  listRemoteIntegrationTargets,
  searchRemoteIntegrationUsers: searchRemoteIntegrationUsersProcedure,
  getRun,
  getRunImpersonationTarget,
  listRuns,
  listWorkspaceRuns,
  getForwardingAlias,
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
  share,
  unshare,
  listShared,
  exportDefinition,
  importShared,
  importDefinition,
  adminListWorkspaceCoworkers,
  adminGetWorkspaceRun,
  getOrCreateBuilderConversation,
};
