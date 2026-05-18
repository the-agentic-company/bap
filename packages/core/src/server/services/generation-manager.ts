import { createHash } from "node:crypto";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  conversationQueuedMessage,
  generation,
  message,
  messageAttachment,
  user,
  coworker,
  coworkerRun,
  coworkerRunEvent,
  type ContentPart,
  type GenerationExecutionPolicy,
  type MessageTiming,
  type PendingApproval,
  type PendingAuth,
  type QueuedMessageAttachment,
} from "@cmdclaw/db/schema";
import { customIntegrationCredential } from "@cmdclaw/db/schema";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import IORedis from "ioredis";
import path from "path";
import type { IntegrationType } from "../oauth/config";
import type {
  RuntimeEvent,
  RuntimeHarnessClient,
  RuntimePart,
  RuntimePermissionRequest,
  RuntimePromptPart,
  RuntimeQuestionRequest,
} from "../sandbox/core/types";
import type { SandboxBackend } from "../sandbox/types";
import { env } from "../../env";
import {
  type CoworkerEditApplyEnvelope,
  parseCoworkerEditApplyEnvelope,
  parseCoworkerInvocationEnvelope,
} from "../../lib/coworker-runtime-cli";
import { aggregateConversationUsageFromSessionMessages } from "./conversation-usage-service";
import {
  CUSTOM_SKILL_PREFIX,
  normalizeCoworkerAllowedSkillSlugs,
  splitCoworkerAllowedSkillSlugs,
} from "../../lib/coworker-tool-policy";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "../../lib/chat-model-defaults";
import { START_GENERATION_ERROR_CODES } from "../../lib/generation-errors";
import { isAdminOnlyChatModel } from "../../lib/chat-model-policy";
import { parseModelReference } from "../../lib/model-reference";
import { CMDCLAW_RUNTIME_CONTEXT_PATH, type RuntimeContextFile } from "../../lib/runtime-context";
import {
  getProviderAuthProviderID,
  getProviderDisplayName,
  normalizeModelAuthSource,
  providerSupportsAuthSource,
  resolveProviderAuthAvailability,
  type ProviderAuthAvailability,
  type ProviderAuthSource,
} from "../../lib/provider-auth-source";
import { listOpencodeFreeModels, resolveDefaultOpencodeFreeModel } from "../ai/opencode-models";
import { parseBashCommand } from "../ai/permission-checker";
import { getProviderModels } from "../ai/subscription-providers";
import { trackGenerationBilling } from "../billing/service";
import { hasConnectedProviderAuthForUser } from "../control-plane/subscription-providers";
import {
  filterCliEnvToAllowedIntegrations,
  getCliEnvForUser,
  getCliInstructionsWithCustom,
  getEnabledIntegrationTypes,
} from "../integrations/cli-env";
import {
  getRemoteIntegrationCredentials,
  remoteIntegrationSourceSchema,
  type RemoteIntegrationSource,
} from "../integrations/remote-integrations";
import {
  composeOpencodePromptSpec,
  type OpencodePromptCompositionInput,
  type ResolvedPromptSpec,
} from "../prompts/opencode-runtime-prompt";
import {
  buildQueueJobId,
  CHAT_GENERATION_JOB_NAME,
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  COWORKER_GENERATION_JOB_NAME,
  getQueue,
} from "../queues";
import { prefixRedisKey } from "../instance";
import { buildRedisOptions } from "../redis/connection-options";
import {
  generationStreamExists,
  getLatestGenerationStreamEnvelope,
  getLatestGenerationStreamCursor,
  publishGenerationStreamEvent,
  readGenerationStreamAfter,
  type GenerationStreamEnvelope,
} from "../redis/generation-event-bus";
import {
  getOrCreateConversationSandbox,
  getOrCreateConversationRuntime,
} from "../sandbox/core/orchestrator";
import { writeCoworkerDocumentsToSandbox } from "../sandbox/prep/coworker-documents-prep";
import { buildMemorySystemPrompt, syncMemoryFilesToSandbox } from "../sandbox/prep/memory-prep";
import {
  prepareExecutorInSandbox,
  type ExecutorOauthSourceStatus,
} from "../sandbox/prep/executor-prep";
import {
  resolveSandboxRuntimeAppUrl,
  syncRuntimeEnvToSandbox,
} from "../sandbox/prep/runtime-env-prep";
import {
  getIntegrationSkillsSystemPrompt,
  getSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox,
  writeSkillsToSandbox,
} from "../sandbox/prep/skills-prep";
import { generateConversationTitle } from "../utils/generate-title";
import { createTraceId, logServerEvent } from "../utils/observability";
import {
  resolveCoworkerBuilderContextByConversation,
  type CoworkerBuilderContext,
} from "./coworker-builder-service";
import { generateCoworkerMetadataOnFirstPromptFill } from "./coworker-metadata";
import {
  generationInterruptService,
  type GenerationInterruptEventPayload,
  type GenerationInterruptRecord,
} from "./generation-interrupt-service";
import { captureGenerationFailureAlert } from "./failure-alert-service";
import { GenerationStartError } from "./generation-start-error";
import { createCommunityIntegrationSkill } from "./integration-skill-service";
import { writeSessionTranscriptFromConversation } from "./memory-service";
import {
  buildOpencodeExportCommand,
  clearConversationSessionSnapshot,
  extractEmbeddedJsonObject,
  saveConversationSessionSnapshot,
} from "./opencode-session-snapshot-service";
import { resolveSelectedPlatformSkillSlugs } from "./platform-skill-service";
import { uploadSandboxFile, collectNewSandboxFiles } from "./sandbox-file-service";
import { getSandboxSlotManager } from "./sandbox-slot-manager";
import { SESSION_BOUNDARY_PREFIX } from "./session-constants";
import { conversationRuntimeService } from "./conversation-runtime-service";
import { listAccessibleEnabledSkillMetadataForUser } from "./workspace-skill-service";
import {
  canAttemptRecovery,
  classifyRuntimeFailure,
  createGenerationLifecycle,
  generationLifecyclePolicy,
  isApprovalExpired,
  isAuthExpired,
  isRunExpired,
  resolveGenerationDeadlineAt,
  type GenerationCompletionReason,
  type RuntimeExportState,
  type RuntimeFailureClassification,
} from "./lifecycle-policy";
import { sendTaskDonePush } from "./web-push-service";

const OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS = 2;
const OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS = 8_000;
const OPENCODE_STATUS_POLL_INTERVAL_MS = 500;

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function coerceToolOutputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  return JSON.stringify(value);
}

async function writeRuntimeContextToSandbox(
  runtimeSandbox: {
    exec: (
      command: string,
      opts?: { timeoutMs?: number; env?: Record<string, string> },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
  runtimeContext: RuntimeContextFile,
): Promise<void> {
  const payload = Buffer.from(JSON.stringify(runtimeContext, null, 2), "utf8").toString("base64");
  const targetPath = CMDCLAW_RUNTIME_CONTEXT_PATH;
  const targetDir = path.posix.dirname(targetPath);
  const tempPath = `${targetPath}.next`;
  const command = [
    `mkdir -p ${escapeShellArg(targetDir)}`,
    "python3 - <<'PY'",
    "import base64",
    "from pathlib import Path",
    `payload = ${JSON.stringify(payload)}`,
    `target_path = Path(${JSON.stringify(targetPath)})`,
    `temp_path = Path(${JSON.stringify(tempPath)})`,
    "temp_path.write_bytes(base64.b64decode(payload))",
    "temp_path.replace(target_path)",
    "PY",
  ].join("\n");
  const result = await runtimeSandbox.exec(command, { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Runtime context write failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

async function writeRuntimeEnvToSandbox(
  runtimeSandbox: {
    exec: (
      command: string,
      opts?: { timeoutMs?: number; env?: Record<string, string> },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
  runtimeEnv: Record<string, string | null | undefined>,
): Promise<void> {
  await syncRuntimeEnvToSandbox({
    sandbox: runtimeSandbox,
    runtimeEnv,
  });
}

function buildRuntimeEnvSourcedCommand(params: { command: string; workdir?: string }): string {
  const workdir = params.workdir?.trim() || "/app";
  const script = [
    "set -o allexport",
    "[ ! -f /app/.cmdclaw/runtime-env.sh ] || . /app/.cmdclaw/runtime-env.sh",
    "set +o allexport",
    `cd ${escapeShellArg(workdir)}`,
    params.command,
  ].join("\n");
  return `bash -lc ${escapeShellArg(script)}`;
}

let cachedDefaultCoworkerModelPromise: Promise<string> | undefined;

async function resolveCoworkerModel(model?: string): Promise<string> {
  const configured = model?.trim();
  if (configured) {
    parseModelReference(configured);
    return configured;
  }

  if (!cachedDefaultCoworkerModelPromise) {
    cachedDefaultCoworkerModelPromise = resolveDefaultOpencodeFreeModel();
  }

  return cachedDefaultCoworkerModelPromise;
}

function resolveModelAuthSource(params: {
  model: string;
  authSource?: ProviderAuthSource | null;
}): ProviderAuthSource | null {
  return normalizeModelAuthSource({
    model: params.model,
    authSource: params.authSource,
  });
}

// Event types for generation stream
export type GenerationEvent =
  | { type: "text"; content: string }
  | { type: "system"; content: string; coworkerId?: string }
  | {
      type: "tool_use";
      toolName: string;
      toolInput: unknown;
      toolUseId?: string;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "tool_result"; toolName: string; result: unknown; toolUseId?: string }
  | { type: "thinking"; content: string; thinkingId: string }
  | ({ type: "interrupt_pending" } & GenerationInterruptEventPayload)
  | ({ type: "interrupt_resolved" } & GenerationInterruptEventPayload)
  | {
      type: "sandbox_file";
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes: number | null;
    }
  | {
      type: "done";
      generationId: string;
      conversationId: string;
      messageId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalCostUsd: number;
      };
      artifacts?: {
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
    }
  | { type: "error"; message: string; diagnosticMessage?: string }
  | {
      type: "cancelled";
      generationId: string;
      conversationId: string;
      messageId?: string;
    }
  | {
      type: "status_change";
      status: string;
      metadata?: {
        runtimeId?: string;
        sandboxProvider?: "e2b" | "daytona" | "docker";
        runtimeHarness?: "opencode" | "agent-sdk";
        runtimeProtocolVersion?: "opencode-v2" | "sandbox-agent-v1";
        sandboxId?: string;
        sessionId?: string;
        parkedInterruptId?: string;
        releasedSandboxId?: string;
      };
    };

type GenerationStreamEvent = GenerationEvent & {
  cursor?: string;
};

type GenerationStatus =
  | "running"
  | "awaiting_approval"
  | "awaiting_auth"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";
type GenerationRunMode = "normal_run" | "recovery_reattach";

class GenerationSuspendedError extends Error {
  constructor(
    readonly interruptId: string,
    readonly kind: "approval" | "auth",
  ) {
    super(`Generation suspended for ${kind} interrupt ${interruptId}`);
    this.name = "GenerationSuspendedError";
  }
}

type BackendType = "opencode";
type OpenCodeTrackedEvent = Extract<
  RuntimeEvent,
  {
    type: "message.updated" | "message.part.updated" | "session.updated" | "session.status";
  }
>;
type OpenCodeActionableEvent = Extract<
  RuntimeEvent,
  { type: "message.part.updated" | "permission.asked" | "question.asked" }
>;
type ApprovalCapableClient =
  | RuntimeHarnessClient
  | {
      permission: {
        reply: (input: { requestID: string; reply: "always" | "reject" }) => Promise<void>;
      };
      question: {
        reply: (input: { requestID: string; answers: string[][] }) => Promise<void>;
        reject: (input: { requestID: string }) => Promise<void>;
      };
    };

interface GenerationContext {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  workspaceId?: string | null;
  sandboxId?: string;
  status: GenerationStatus;
  executionPolicy: GenerationExecutionPolicy;
  deadlineAt: Date;
  remainingRunMs: number;
  approvalHotWaitMs: number;
  suspendedAt?: Date | null;
  resumeInterruptId?: string | null;
  lastRuntimeEventAt: Date;
  recoveryAttempts: number;
  completionReason?: GenerationCompletionReason | null;
  debugInfo?: GenerationDebugInfo;
  contentParts: ContentPart[];
  assistantContent: string;
  abortController: AbortController;
  pendingApproval: PendingApproval | null;
  approvalTimeoutId?: ReturnType<typeof setTimeout>;
  approvalParkTimeoutId?: ReturnType<typeof setTimeout>;
  externalInterruptPollIntervalId?: ReturnType<typeof setInterval>;
  approvalResolver?: (decision: "allow" | "deny") => void;
  pendingAuth: PendingAuth | null;
  authTimeoutId?: ReturnType<typeof setTimeout>;
  authResolver?: (result: { success: boolean; userId?: string }) => void;
  currentInterruptId?: string;
  runtimeCallbackToken?: string;
  runtimeId?: string;
  runtimeTurnSeq?: number;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  sessionId?: string;
  errorMessage?: string;
  startedAt: Date;
  lastSaveAt: Date;
  saveDebounceId?: ReturnType<typeof setTimeout>;
  isNewConversation: boolean;
  model: string;
  authSource?: ProviderAuthSource | null;
  userMessageContent: string;
  // File attachments from user
  attachments?: UserFileAttachment[];
  // Track assistant message IDs to filter out user message parts
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<
    string,
    {
      firstQueuedAtMs: number;
      parts: RuntimePart[];
    }
  >;
  openCodeRuntimeTools: Map<string, OpenCodeRuntimeToolRef>;
  backendType: BackendType;
  sandboxProviderOverride?: "e2b" | "daytona" | "docker";
  // Coworker fields
  coworkerId?: string;
  coworkerRunId?: string;
  allowedIntegrations?: IntegrationType[];
  autoApprove: boolean;
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  coworkerPrompt?: string;
  coworkerPromptDo?: string;
  coworkerPromptDont?: string;
  triggerPayload?: unknown;
  builderCoworkerContext?: CoworkerBuilderContext | null;
  selectedPlatformSkillSlugs?: string[];
  // Sandbox file collection
  generationMarkerTime?: number;
  sandbox?: SandboxBackend;
  sentFilePaths?: Set<string>;
  userStagedFilePaths?: Set<string>;
  uploadedSandboxFileIds?: Set<string>;
  agentInitStartedAt?: number;
  agentInitReadyAt?: number;
  agentInitFailedAt?: number;
  agentSandboxReadyAt?: number;
  agentSandboxMode?: "created" | "reused" | "unknown";
  phaseMarks?: Record<string, number>;
  phaseTimeline?: Array<{
    phase: string;
    atMs: number;
    elapsedMs: number;
  }>;
  streamSequence: number;
  streamPublishedCount: number;
  streamDeliveredCount: number;
  streamLastCursor?: string;
  streamFirstVisiblePublishedAt?: number;
  streamTerminalPublishedAt?: number;
  lastCancellationCheckAt?: number;
  isFinalizing?: boolean;
  sandboxSlotLeaseToken?: string;
  sandboxSlotLeaseRenewId?: ReturnType<typeof setInterval>;
  abortForInterruptPark?: boolean;
}

type ModelAccessCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      userMessage: string;
    };

type ToolUseMetadata = {
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

type OpenCodeRuntimeToolRef = NonNullable<
  NonNullable<GenerationInterruptRecord["display"]["runtimeTool"]>
>;

type PrePromptCacheRecord = {
  version: 1;
  cacheKey: string;
  writtenSkills: string[];
  writtenIntegrationSkills: string[];
  updatedAt: string;
};

const PRE_PROMPT_CACHE_PATH = "/app/.opencode/pre-prompt-cache.json";
const DEFAULT_MODEL_REFERENCE = DEFAULT_CONNECTED_CHATGPT_MODEL;

async function getDoneArtifacts(messageId: string): Promise<
  | {
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
    }
  | undefined
> {
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

const APPROVAL_TIMEOUT_MS = generationLifecyclePolicy.approvalTimeoutMs;
const AUTH_TIMEOUT_MS = generationLifecyclePolicy.authTimeoutMs;
const PARKED_INTERRUPT_TIMEOUT_MS = generationLifecyclePolicy.explicitPauseRetentionMs;
const CANCELLATION_POLL_INTERVAL_MS = 1000;
const AGENT_PREPARING_TIMEOUT_MS = generationLifecyclePolicy.bootstrapTimeoutMs;
const OPENCODE_PROMPT_TIMEOUT_MS = generationLifecyclePolicy.runDeadlineMs;
const OPENCODE_PROMPT_TIMEOUT_LABEL = `${Math.ceil(OPENCODE_PROMPT_TIMEOUT_MS / 60_000)}m`;
// Save debounce interval for text chunks
const SAVE_DEBOUNCE_MS = 2000;
const RUN_DEADLINE_ABORT_TIMEOUT_MS = 5_000;
const RUN_DEADLINE_SNAPSHOT_TIMEOUT_MS = 15_000;
const SESSION_RESET_COMMANDS = new Set(["/new"]);
type GenerationTimeoutKind = "approval" | "auth";
const STALE_REAPER_RUNNING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;
const STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS = 60 * 60 * 1000;
const PENDING_MESSAGE_PARTS_MAX_PER_MESSAGE = 100;
const PENDING_MESSAGE_PARTS_TTL_MS = 5 * 60 * 1000;
const MAX_TOOL_RESULT_CONTENT_CHARS = 100_000;
const SANDBOX_SLOT_RETRY_DELAY_MS = 2_000;
const GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS = Number.parseInt(
  process.env.GEN_STREAM_SUBSCRIBE_MAX_WAIT_MS ?? "180000",
  10,
);
const GEN_STREAM_DB_RECOVERY_POLL_MS = Number.parseInt(
  process.env.GEN_STREAM_DB_RECOVERY_POLL_MS ?? "1500",
  10,
);
const GEN_QUEUE_SELF_HEAL_DELAY_MS = Number.parseInt(
  process.env.GEN_QUEUE_SELF_HEAL_DELAY_MS ?? "5000",
  10,
);

type AutoCollectedSandboxFile = {
  path: string;
  content: Buffer;
};

function extractFinalAnswerTextForFileHeuristic(
  ctx: Pick<GenerationContext, "assistantContent" | "contentParts">,
): string {
  const textFromParts = ctx.contentParts.flatMap((part) => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const record = part as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      return [record.text];
    }
    if (record.type === "system" && typeof record.content === "string") {
      return [record.content];
    }
    return [];
  });

  const segments = [ctx.assistantContent, ...textFromParts].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return segments.join("\n");
}

function filterAutoCollectedFilesMentionedInAnswer(
  files: AutoCollectedSandboxFile[],
  finalAnswerText: string,
): AutoCollectedSandboxFile[] {
  // This heuristic is only for auto-collected files discovered after generation.
  // Files explicitly exposed via the send_file tool bypass this path and are always kept.
  const haystack = finalAnswerText.toLowerCase();
  if (!haystack.trim()) {
    return [];
  }

  return files.filter((file) => {
    const filename = path.basename(file.path).toLowerCase();
    const fullPath = file.path.toLowerCase();
    return haystack.includes(filename) || haystack.includes(fullPath);
  });
}

function extractAssistantTextFromSessionMessagesPayload(payload: unknown): string | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  for (let i = payload.length - 1; i >= 0; i -= 1) {
    const item = payload[i];
    if (!item || typeof item !== "object") {
      continue;
    }
    const info = (item as Record<string, unknown>).info as Record<string, unknown> | undefined;
    if (info?.role !== "assistant") {
      continue;
    }
    const parts = (item as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    const text = parts
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const entry = part as Record<string, unknown>;
        if (entry.type === "text" && typeof entry.text === "string") {
          return entry.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("");

    if (text.trim()) {
      return text;
    }
  }

  return null;
}

function extractAssistantTextFromPromptResultData(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const info = record.info as Record<string, unknown> | undefined;
  if (info?.role && info.role !== "assistant") {
    return null;
  }

  const parts = record.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const entry = part as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("");

  return text.trim() ? text : null;
}

function getRuntimeStatusTypeForSession(payload: unknown, sessionId: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const entry = (payload as Record<string, unknown>)[sessionId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const type = (entry as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function buildExecutionPolicy(params: {
  allowedIntegrations?: IntegrationType[];
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  queuedFileAttachments?: UserFileAttachment[];
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
}): GenerationExecutionPolicy {
  return {
    allowedIntegrations: params.allowedIntegrations,
    allowedCustomIntegrations: params.allowedCustomIntegrations,
    allowedExecutorSourceIds: params.allowedExecutorSourceIds,
    allowedSkillSlugs: params.allowedSkillSlugs,
    remoteIntegrationSource: params.remoteIntegrationSource,
    autoApprove: params.autoApprove,
    sandboxProvider: params.sandboxProvider,
    selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs,
    allowSnapshotRestoreOnRun: true,
    queuedFileAttachments: params.queuedFileAttachments,
    debugRunDeadlineMs: params.debugRunDeadlineMs,
    debugApprovalHotWaitMs: params.debugApprovalHotWaitMs,
  };
}

function computeExpiryIso(timeoutMs: number): string {
  return new Date(Date.now() + timeoutMs).toISOString();
}

function resolveGenerationRunDeadlineMs(debugRunDeadlineMs: number | undefined): number {
  if (debugRunDeadlineMs === undefined) {
    return generationLifecyclePolicy.runDeadlineMs;
  }
  if (
    !Number.isInteger(debugRunDeadlineMs) ||
    debugRunDeadlineMs < 1_000 ||
    debugRunDeadlineMs > generationLifecyclePolicy.runDeadlineMs
  ) {
    throw new Error(
      `debugRunDeadlineMs must be an integer between 1000 and ${generationLifecyclePolicy.runDeadlineMs}`,
    );
  }
  return debugRunDeadlineMs;
}

function resolveApprovalHotWaitMs(debugApprovalHotWaitMs: number | undefined): number {
  if (debugApprovalHotWaitMs === undefined) {
    return generationLifecyclePolicy.approvalHotWaitMs;
  }
  if (
    !Number.isInteger(debugApprovalHotWaitMs) ||
    debugApprovalHotWaitMs < 1_000 ||
    debugApprovalHotWaitMs > generationLifecyclePolicy.runDeadlineMs
  ) {
    throw new Error(
      `debugApprovalHotWaitMs must be an integer between 1000 and ${generationLifecyclePolicy.runDeadlineMs}`,
    );
  }
  return debugApprovalHotWaitMs;
}

function computeParkedInterruptExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + PARKED_INTERRUPT_TIMEOUT_MS);
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function hashStableProviderRequestPayload(payload: unknown): string {
  return createHash("sha256").update(stableJsonStringify(payload)).digest("hex").slice(0, 24);
}

function extractOpenCodeCallIdFromProviderRequestId(
  providerRequestId: string | null | undefined,
): string | null {
  const marker = ":opencode:";
  if (!providerRequestId?.includes(marker)) {
    return null;
  }
  const callId = providerRequestId.slice(providerRequestId.lastIndexOf(marker) + marker.length);
  return callId.length > 0 ? callId : null;
}

function getRuntimeToolRefForInterrupt(
  ctx:
    | Pick<GenerationContext, "contentParts" | "openCodeRuntimeTools" | "sessionId">
    | null
    | undefined,
  params: {
    providerRequestId?: string | null;
    runtimeTool?: OpenCodeRuntimeToolRef;
    command: string;
  },
): OpenCodeRuntimeToolRef | undefined {
  if (params.runtimeTool) {
    return params.runtimeTool;
  }
  const callId = extractOpenCodeCallIdFromProviderRequestId(params.providerRequestId);
  if (callId) {
    const fromMap = ctx?.openCodeRuntimeTools.get(callId);
    if (fromMap) {
      return fromMap;
    }
  }
  const matchingToolUse = ctx?.contentParts.find(
    (part): part is ContentPart & { type: "tool_use" } =>
      part.type === "tool_use" &&
      typeof part.input.command === "string" &&
      part.input.command === params.command,
  );
  if (!matchingToolUse) {
    return undefined;
  }
  return ctx?.openCodeRuntimeTools.get(matchingToolUse.id);
}

function resolveExpiryMs(
  expiresAt: string | undefined,
  requestedAt: string | undefined,
  timeoutMs: number,
): number {
  const explicit = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const requested = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  if (Number.isFinite(requested)) {
    return requested + timeoutMs;
  }
  return Date.now() + timeoutMs;
}

function normalizePermissionPattern(pattern: string): string {
  return pattern.replace(/[\s*]+$/g, "").replace(/\/+$/, "");
}

function shouldAutoApproveOpenCodePermission(
  permissionType: string,
  patterns: string[] | undefined,
): boolean {
  if (!patterns?.length) {
    return false;
  }

  return patterns.every((pattern) => {
    const normalized = normalizePermissionPattern(pattern);

    // Allow common sandbox working directories without interactive approval.
    if (
      permissionType === "external_directory" &&
      (normalized.startsWith("/tmp") ||
        normalized.startsWith("/app") ||
        normalized.startsWith("/home"))
    ) {
      return true;
    }

    return false;
  });
}

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function isOpenCodeTrackedEvent(event: RuntimeEvent): event is OpenCodeTrackedEvent {
  return (
    event.type === "message.updated" ||
    event.type === "message.part.updated" ||
    event.type === "session.updated" ||
    event.type === "session.status"
  );
}

function isOpenCodeActionableEvent(event: RuntimeEvent): event is OpenCodeActionableEvent {
  return (
    event.type === "message.part.updated" ||
    event.type === "permission.asked" ||
    event.type === "question.asked"
  );
}

export function buildDefaultQuestionAnswers(request: RuntimeQuestionRequest): string[][] {
  if (request.questions.length === 0) {
    return [["default answer"]];
  }

  return request.questions.map((question) => [question.options?.[0]?.label ?? "default answer"]);
}

export function buildQuestionCommand(request: RuntimeQuestionRequest): string {
  const primaryQuestion = request.questions[0];
  if (!primaryQuestion) {
    return "Question";
  }

  const options = (primaryQuestion.options ?? []).map((option) => option.label).filter(Boolean);
  const optionsText = options.length > 0 ? ` [${options.join(" | ")}]` : "";
  const remainingCount = Math.max(0, request.questions.length - 1);
  const remainingText = remainingCount > 0 ? ` (+${remainingCount} more)` : "";
  return `Question: ${primaryQuestion.question}${optionsText}${remainingText}`;
}

type UserFileAttachment = { name: string; mimeType: string; dataUrl: string };

type ConversationQueuedMessageRecord = {
  id: string;
  content: string;
  fileAttachments?: QueuedMessageAttachment[];
  selectedPlatformSkillSlugs?: string[];
  status: "queued" | "processing";
  createdAt: Date;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = extractStructuredErrorMessage(error);
    if (message) {
      return message;
    }
    const json = safeJsonStringify(error);
    if (json) {
      return json;
    }
  }
  return String(error);
}

function extractStructuredErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  const nestedCandidates = [record.error, record.data, record.details];
  for (const candidate of nestedCandidates) {
    const nested = extractStructuredErrorMessage(candidate);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function summarizeUnknownValue(value: unknown, maxLength = 500): string {
  const raw =
    typeof value === "string" ? value : (safeJsonStringify(value) ?? formatErrorMessage(value));
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}

function describeSessionMessagesPayload(payload: unknown): string {
  if (Array.isArray(payload)) {
    return `array(${payload.length})`;
  }
  if (payload === null) {
    return "null";
  }
  if (payload && typeof payload === "object") {
    return `object(${Object.keys(payload as Record<string, unknown>)
      .slice(0, 8)
      .join(",")})`;
  }
  return typeof payload;
}

function describePromptResultData(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }
  if (Array.isArray(data)) {
    return `array(${data.length})`;
  }
  if (typeof data === "object") {
    return `object(${Object.keys(data as Record<string, unknown>)
      .slice(0, 8)
      .join(",")})`;
  }
  return typeof data;
}

function isOpaqueDiagnosticMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim();
  return !normalized || normalized === "{}" || normalized === "[]" || normalized === "null";
}

function tailLogText(text: string, maxLines = 80, maxChars = 4_000): string {
  const lines = text.split("\n");
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length > maxChars ? `...${tail.slice(-maxChars)}` : tail;
}

function isBootstrapTimeoutError(error: unknown): boolean {
  return formatErrorMessage(error).startsWith("Error: Agent preparation timed out after ");
}

class ExecutorPromptReadyError extends Error {
  override cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ExecutorPromptReadyError";
    this.cause = cause;
  }
}

function buildExecutorSourceHealthInstructions(
  statuses: ExecutorOauthSourceStatus[],
): string | null {
  if (statuses.length === 0) {
    return null;
  }

  const unavailableSources = statuses.filter((source) => source.status !== "available");
  const lines = [
    "Executor source health after refresh:",
    ...statuses.map((source) => {
      if (source.status === "available") {
        return `- ${source.namespace} (${source.name}): available${
          source.toolCount === null
            ? ""
            : `, ${source.toolCount} tool${source.toolCount === 1 ? "" : "s"}`
        }`;
      }
      return `- ${source.namespace} (${source.name}): ${source.status}, reason=${source.reason}, error=${source.error}`;
    }),
  ];

  if (unavailableSources.length > 0) {
    lines.push(
      "Unavailable Executor source policy:",
      "If the user asks for one of the unavailable sources above, keep the agent loop alive and make the failure visible inside the Executor tool loop.",
      "The next action must be an `executor_execute` tool call that lists Executor sources and throws an error for the matching source. Use this pattern:",
      "```js",
      "const sources = await tools.executor.sources.list();",
      "const source = sources.find((entry) => entry.id === '<namespace>' || entry.name === '<namespace>');",
      "throw new Error(`Executor source ${source?.id ?? '<namespace>'} is unavailable (toolCount=${source?.toolCount ?? 'unknown'}). Refresh/reconnect the source before using it.`);",
      "```",
      "After that Executor tool error, report the source as unavailable and ask the user to reconnect or refresh it.",
      "Do not use `bash` executor CLI commands, GraphQL addSource, coworkers, global searches, or unrelated source tools as a fallback for that request.",
    );
  }

  return lines.join("\n");
}

function isMissingSandboxError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return (
    message.includes("sandbox") &&
    (message.includes("not found") ||
      message.includes("not_running") ||
      message.includes("not running") ||
      message.includes("dead") ||
      message.includes("paused"))
  );
}

function phaseDurationMs(
  phaseMarks: Record<string, number>,
  startPhase: string,
  endPhase: string,
): number | undefined {
  const start = phaseMarks[startPhase];
  const end = phaseMarks[endPhase];
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return Math.max(0, end - start);
}

type RemoteRunDebugPhase =
  | "remote_credentials_fetched"
  | "sandbox_created"
  | "prompt_sent"
  | "session_error";

type GenerationDebugInfo = {
  originalErrorMessage?: string | null;
  originalErrorName?: string | null;
  originalErrorPhase?: string | null;
  originalErrorAt?: string | null;
  runtimeFailure?: RuntimeFailureClassification | null;
  remoteRun?: {
    targetEnv?: RemoteIntegrationSource["targetEnv"];
    remoteUserId?: string;
    remoteUserEmail?: string | null;
    allowedIntegrations?: string[];
    attachedTokenEnvVarNames?: string[];
    phases?: Partial<Record<RemoteRunDebugPhase, string>>;
    sessionErrorMessage?: string | null;
  } | null;
};

function buildInitialDebugInfo(
  remoteIntegrationSource?: RemoteIntegrationSource,
  allowedIntegrations?: IntegrationType[],
): GenerationDebugInfo | undefined {
  if (!remoteIntegrationSource) {
    return undefined;
  }

  return {
    remoteRun: {
      targetEnv: remoteIntegrationSource.targetEnv,
      remoteUserId: remoteIntegrationSource.remoteUserId,
      remoteUserEmail: remoteIntegrationSource.remoteUserEmail ?? null,
      allowedIntegrations: allowedIntegrations ? [...allowedIntegrations] : undefined,
      phases: {},
    },
  };
}

function getGenerationDiagnosticMessage(
  debugInfo: GenerationDebugInfo | null | undefined,
): string | undefined {
  const message = debugInfo?.originalErrorMessage?.trim();
  return message && message.length > 0 ? message : undefined;
}

function formatGenerationErrorMessage(message: string, diagnosticMessage?: string): string {
  const normalizedMessage = message.trim();
  const normalizedDiagnostic = diagnosticMessage?.trim();
  if (!normalizedDiagnostic) {
    return normalizedMessage;
  }
  if (normalizedMessage.includes(normalizedDiagnostic)) {
    return normalizedMessage;
  }
  return `${normalizedMessage}\nUnderlying error: ${normalizedDiagnostic}`;
}

type ExportedAssistantPart = {
  type?: string;
  tool?: string;
  reason?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
  };
};

function isExportedToolWaitingForApproval(part: ExportedAssistantPart): boolean {
  return part.type === "tool" && part.tool === "question";
}

function isExportedToolWaitingForAuth(part: ExportedAssistantPart): boolean {
  if (part.type !== "tool") {
    return false;
  }

  const toolName = part.tool?.toLowerCase() ?? "";
  if (toolName.includes("auth")) {
    return true;
  }

  const input = part.state?.input;
  if (!input || typeof input !== "object") {
    return false;
  }

  return (
    Array.isArray(input.integrations) ||
    Array.isArray(input.connectedIntegrations) ||
    typeof input.integration === "string"
  );
}

function isExportedToolInFlight(part: ExportedAssistantPart): boolean {
  if (part.type !== "tool") {
    return false;
  }

  const status = part.state?.status;
  return status === "pending" || status === "running";
}

function getLastExportedAssistantParts(payload: unknown): ExportedAssistantPart[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as {
    messages?: Array<{
      info?: { role?: string };
      parts?: ExportedAssistantPart[];
    }>;
  };
  const assistantMessages = (record.messages ?? []).filter(
    (messageRecord) => messageRecord?.info?.role === "assistant",
  );
  return assistantMessages.at(-1)?.parts ?? [];
}

export function extractRuntimeExportState(payload: unknown): RuntimeExportState {
  const parts = getLastExportedAssistantParts(payload);

  if (parts.some((part) => part?.type === "step-finish" && part.reason === "complete")) {
    return "terminal_completed";
  }
  if (parts.some((part) => part?.type === "step-finish" && part.reason === "error")) {
    return "terminal_failed";
  }
  if (parts.length === 0) {
    return "broken";
  }
  const stoppedForInput = parts.some(
    (part) => part?.type === "step-finish" && part.reason === "stop",
  );
  const inFlightTools = parts.filter(isExportedToolInFlight);
  if (stoppedForInput) {
    if (inFlightTools.some(isExportedToolWaitingForAuth)) {
      return "waiting_auth";
    }
    if (inFlightTools.some(isExportedToolWaitingForApproval)) {
      return "waiting_approval";
    }
  }
  if (inFlightTools.length > 0) {
    return "non_terminal";
  }
  return "non_terminal";
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... (output truncated)`;
}

function limitToolResultContent(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateString(value, MAX_TOOL_RESULT_CONTENT_CHARS);
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_TOOL_RESULT_CONTENT_CHARS) {
      return value;
    }
    return truncateString(serialized, MAX_TOOL_RESULT_CONTENT_CHARS);
  } catch {
    return truncateString(String(value), MAX_TOOL_RESULT_CONTENT_CHARS);
  }
}

const QUEUEABLE_CONVERSATION_TYPES = ["chat", "coworker"] as const;

class GenerationManager {
  private activeGenerations = new Map<string, GenerationContext>();
  private activeSubscriptionCounts = new Map<string, number>();
  private queuedGenerationSelfHealTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private streamCounters = {
    opened: 0,
    closed: 0,
    timedOut: 0,
    deduped: 0,
  };

  private getSubscriptionKey(generationId: string, userId: string): string {
    return `${generationId}:${userId}`;
  }

  private async enqueueConversationQueuedMessageProcess(conversationId: string): Promise<void> {
    const queue = getQueue();
    await queue.add(
      CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME,
      { conversationId },
      {
        jobId: buildQueueJobId([CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME, conversationId]),
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private isActiveGenerationStartError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("Generation already in progress");
  }

  private async persistMessageAttachments(params: {
    conversationId: string;
    messageId: string;
    attachments?: UserFileAttachment[];
  }): Promise<void> {
    const attachments = params.attachments;
    if (!attachments || attachments.length === 0) {
      return;
    }

    const { uploadToS3, ensureBucket } = await import("../storage/s3-client");
    await ensureBucket();

    await Promise.all(
      attachments.map(async (attachment) => {
        const base64Data = attachment.dataUrl.split(",")[1] || "";
        const buffer = Buffer.from(base64Data, "base64");
        const sanitizedFilename = attachment.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storageKey = `attachments/${params.conversationId}/${params.messageId}/${Date.now()}-${sanitizedFilename}`;
        await uploadToS3(storageKey, buffer, attachment.mimeType);
        await db.insert(messageAttachment).values({
          messageId: params.messageId,
          filename: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: buffer.length,
          storageKey,
        });
      }),
    );
  }

  async enqueueConversationMessage(params: {
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
    replaceExisting?: boolean;
  }): Promise<{ queuedMessageId: string }> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, params.conversationId),
        eq(conversation.userId, params.userId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      throw new Error("Conversation not found");
    }

    if (params.replaceExisting ?? false) {
      await db
        .delete(conversationQueuedMessage)
        .where(
          and(
            eq(conversationQueuedMessage.conversationId, params.conversationId),
            eq(conversationQueuedMessage.userId, params.userId),
            inArray(conversationQueuedMessage.status, ["queued", "failed"]),
          ),
        );
    }

    const [queued] = await db
      .insert(conversationQueuedMessage)
      .values({
        conversationId: params.conversationId,
        userId: params.userId,
        content: params.content,
        fileAttachments: params.fileAttachments,
        selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs,
        status: "queued",
      })
      .returning({ id: conversationQueuedMessage.id });

    await this.enqueueConversationQueuedMessageProcess(params.conversationId);
    return { queuedMessageId: queued.id };
  }

  async listConversationQueuedMessages(
    conversationId: string,
    userId: string,
  ): Promise<ConversationQueuedMessageRecord[]> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, conversationId),
        eq(conversation.userId, userId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      return [];
    }

    const rows = await db.query.conversationQueuedMessage.findMany({
      where: and(
        eq(conversationQueuedMessage.conversationId, conversationId),
        eq(conversationQueuedMessage.userId, userId),
        inArray(conversationQueuedMessage.status, ["queued", "processing"]),
      ),
      orderBy: [asc(conversationQueuedMessage.createdAt)],
      columns: {
        id: true,
        content: true,
        fileAttachments: true,
        selectedPlatformSkillSlugs: true,
        status: true,
        createdAt: true,
      },
    });

    return rows
      .filter(
        (
          row,
        ): row is typeof row & {
          status: "queued" | "processing";
        } => row.status === "queued" || row.status === "processing",
      )
      .map((row) => ({
        id: row.id,
        content: row.content,
        fileAttachments: row.fileAttachments ?? undefined,
        selectedPlatformSkillSlugs: row.selectedPlatformSkillSlugs ?? undefined,
        status: row.status,
        createdAt: row.createdAt,
      }));
  }

  async removeConversationQueuedMessage(
    queuedMessageId: string,
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const deleted = await db
      .delete(conversationQueuedMessage)
      .where(
        and(
          eq(conversationQueuedMessage.id, queuedMessageId),
          eq(conversationQueuedMessage.conversationId, conversationId),
          eq(conversationQueuedMessage.userId, userId),
          inArray(conversationQueuedMessage.status, ["queued", "failed"]),
        ),
      )
      .returning({ id: conversationQueuedMessage.id });
    return deleted.length > 0;
  }

  async updateConversationQueuedMessage(params: {
    queuedMessageId: string;
    conversationId: string;
    userId: string;
    content: string;
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
  }): Promise<boolean> {
    const updated = await db
      .update(conversationQueuedMessage)
      .set({
        content: params.content,
        fileAttachments: params.fileAttachments ?? null,
        selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs ?? null,
      })
      .where(
        and(
          eq(conversationQueuedMessage.id, params.queuedMessageId),
          eq(conversationQueuedMessage.conversationId, params.conversationId),
          eq(conversationQueuedMessage.userId, params.userId),
          eq(conversationQueuedMessage.status, "queued"),
        ),
      )
      .returning({ id: conversationQueuedMessage.id });
    return updated.length > 0;
  }

  async processConversationQueuedMessages(conversationId: string): Promise<void> {
    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, conversationId),
        inArray(conversation.type, QUEUEABLE_CONVERSATION_TYPES),
      ),
      columns: {
        id: true,
      },
    });

    if (!conv) {
      return;
    }

    const active = await db.query.generation.findFirst({
      where: and(
        eq(generation.conversationId, conversationId),
        inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
      ),
      columns: {
        id: true,
      },
    });

    if (active) {
      return;
    }

    const processNext = async (): Promise<void> => {
      const nextQueued = await db.query.conversationQueuedMessage.findFirst({
        where: and(
          eq(conversationQueuedMessage.conversationId, conversationId),
          eq(conversationQueuedMessage.status, "queued"),
        ),
        orderBy: [asc(conversationQueuedMessage.createdAt)],
        columns: {
          id: true,
        },
      });

      if (!nextQueued) {
        return;
      }

      const [claimed] = await db
        .update(conversationQueuedMessage)
        .set({
          status: "processing",
          processingStartedAt: new Date(),
          errorMessage: null,
        })
        .where(
          and(
            eq(conversationQueuedMessage.id, nextQueued.id),
            eq(conversationQueuedMessage.status, "queued"),
          ),
        )
        .returning({
          id: conversationQueuedMessage.id,
          userId: conversationQueuedMessage.userId,
          content: conversationQueuedMessage.content,
          fileAttachments: conversationQueuedMessage.fileAttachments,
          selectedPlatformSkillSlugs: conversationQueuedMessage.selectedPlatformSkillSlugs,
        });

      if (!claimed) {
        return processNext();
      }

      try {
        const started = await this.startGeneration({
          conversationId,
          userId: claimed.userId,
          content: claimed.content,
          fileAttachments: claimed.fileAttachments ?? undefined,
          selectedPlatformSkillSlugs: claimed.selectedPlatformSkillSlugs ?? undefined,
        });

        await db
          .update(conversationQueuedMessage)
          .set({
            status: "sent",
            generationId: started.generationId,
            sentAt: new Date(),
            processingStartedAt: null,
            errorMessage: null,
          })
          .where(eq(conversationQueuedMessage.id, claimed.id));
        return;
      } catch (error) {
        if (this.isActiveGenerationStartError(error)) {
          await db
            .update(conversationQueuedMessage)
            .set({
              status: "queued",
              processingStartedAt: null,
              errorMessage: null,
            })
            .where(eq(conversationQueuedMessage.id, claimed.id));
          return;
        }

        await db
          .update(conversationQueuedMessage)
          .set({
            status: "failed",
            processingStartedAt: null,
            errorMessage: formatErrorMessage(error),
          })
          .where(eq(conversationQueuedMessage.id, claimed.id));
        return processNext();
      }
    };

    await processNext();
  }

  getStreamCountersSnapshot(): {
    opened: number;
    closed: number;
    timedOut: number;
    deduped: number;
    active: number;
  } {
    let active = 0;
    for (const value of this.activeSubscriptionCounts.values()) {
      active += value;
    }
    return {
      ...this.streamCounters,
      active,
    };
  }

  private evictActiveGenerationContext(generationId: string): void {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return;
    }

    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
    }
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.stopExternalInterruptPolling(ctx);
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
    }
    if (ctx.sandboxSlotLeaseRenewId) {
      clearInterval(ctx.sandboxSlotLeaseRenewId);
      ctx.sandboxSlotLeaseRenewId = undefined;
    }

    ctx.pendingMessageParts.clear();

    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
    this.activeGenerations.delete(generationId);
  }

  private pruneStalePendingMessageParts(ctx: GenerationContext): void {
    const now = Date.now();
    for (const [messageID, queued] of ctx.pendingMessageParts.entries()) {
      if (now - queued.firstQueuedAtMs > PENDING_MESSAGE_PARTS_TTL_MS) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
        ctx.pendingMessageParts.delete(messageID);
      }
    }
  }

  private getLockRedis(): IORedis {
    const globalForLocks = globalThis as typeof globalThis & {
      __cmdclawGenerationLockRedis?: IORedis;
    };
    if (!globalForLocks.__cmdclawGenerationLockRedis) {
      globalForLocks.__cmdclawGenerationLockRedis = new IORedis(
        buildRedisOptions(process.env.REDIS_URL ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
      );
    }
    return globalForLocks.__cmdclawGenerationLockRedis;
  }

  private async acquireGenerationLease(generationId: string): Promise<string | null> {
    if (process.env.NODE_ENV === "test") {
      return `local-${generationId}`;
    }
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for durable generation lease locking.");
    }
    const token = crypto.randomUUID();
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const result = await this.getLockRedis().set(leaseKey, token, "PX", 120_000, "NX");
    return result === "OK" ? token : null;
  }

  private async renewGenerationLease(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await this.getLockRedis().get(leaseKey);
    if (owner !== token) {
      return;
    }
    await this.getLockRedis().pexpire(leaseKey, 120_000);
  }

  private async releaseGenerationLease(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await this.getLockRedis().get(leaseKey);
    if (owner === token) {
      await this.getLockRedis().del(leaseKey);
    }
  }

  private async isGenerationLeaseHeld(generationId: string): Promise<boolean> {
    if (process.env.NODE_ENV === "test") {
      return this.activeGenerations.has(generationId);
    }
    if (!process.env.REDIS_URL) {
      return false;
    }
    const leaseKey = prefixRedisKey(`locks:generation:${generationId}`);
    const owner = await this.getLockRedis().get(leaseKey);
    return Boolean(owner);
  }

  private async enqueueGenerationRun(
    generationId: string,
    type: "chat" | "coworker",
    options?: {
      delayMs?: number;
      dedupeKey?: string;
      runMode?: GenerationRunMode;
    },
  ): Promise<void> {
    const queue = getQueue();
    const jobName = type === "coworker" ? COWORKER_GENERATION_JOB_NAME : CHAT_GENERATION_JOB_NAME;
    await queue.add(
      jobName,
      { generationId, runMode: options?.runMode ?? "normal_run" },
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
    if (this.activeGenerations.has(input.generationId)) {
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
      logServerEvent(
        "warn",
        "GENERATION_QUEUE_SELF_HEAL_STREAM_CHECK_FAILED",
        {
          error: formatErrorMessage(error),
        },
        {
          source: "generation-manager",
          generationId: input.generationId,
          conversationId: genRecord.conversationId,
        },
      );
      return false;
    });

    if (streamPresent) {
      return;
    }

    logServerEvent(
      "warn",
      "GENERATION_QUEUE_SELF_HEAL_TRIGGERED",
      {
        runMode: input.runMode,
      },
      {
        source: "generation-manager",
        generationId: input.generationId,
        conversationId: genRecord.conversationId,
      },
    );

    await this.runQueuedGeneration(input.generationId, input.runMode);
  }

  private getGenerationRunType(ctx: Pick<GenerationContext, "coworkerRunId">): "chat" | "coworker" {
    return ctx.coworkerRunId ? "coworker" : "chat";
  }

  private async enqueueResolvedInterruptResume(params: {
    generationId: string;
    conversationId: string;
    interrupt: GenerationInterruptRecord;
    runType: "chat" | "coworker";
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

    await db
      .update(generation)
      .set({
        status: "running",
        resumeInterruptId: params.interrupt.id,
        deadlineAt,
        suspendedAt: null,
        isPaused: false,
        pendingApproval: null,
        pendingAuth: null,
      })
      .where(eq(generation.id, params.generationId));
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, params.conversationId));

    if (params.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, params.coworkerRunId));
    }

    await this.enqueueGenerationRun(params.generationId, params.runType, {
      dedupeKey: `resume-interrupt-${params.interrupt.id}`,
    });
  }

  private async touchConversationLastUserVisibleAction(conversationId: string): Promise<void> {
    await db
      .update(conversation)
      .set({ sandboxLastUserVisibleActionAt: new Date() })
      .where(eq(conversation.id, conversationId));
  }

  private markRuntimeActivity(ctx: GenerationContext, at = new Date()): void {
    ctx.lastRuntimeEventAt = at;
  }

  private setCompletionReason(
    ctx: GenerationContext,
    reason: GenerationCompletionReason | null | undefined,
  ): void {
    ctx.completionReason = reason ?? null;
  }

  private getCurrentPhase(ctx: GenerationContext): string | null {
    const latestPhase = ctx.phaseTimeline?.[ctx.phaseTimeline.length - 1];
    return latestPhase?.phase ?? null;
  }

  private updateDebugInfo(ctx: GenerationContext, patch: Partial<GenerationDebugInfo>): void {
    const existing = ctx.debugInfo ?? {};
    const remoteRunPatch = patch.remoteRun;

    ctx.debugInfo = {
      ...existing,
      ...patch,
      remoteRun:
        remoteRunPatch === undefined
          ? existing.remoteRun
          : {
              ...(existing.remoteRun ?? {}),
              ...remoteRunPatch,
              phases: {
                ...(existing.remoteRun?.phases ?? {}),
                ...(remoteRunPatch?.phases ?? {}),
              },
            },
    };
  }

  private ensureRemoteRunDebugInfo(ctx: GenerationContext): void {
    if (!ctx.remoteIntegrationSource) {
      return;
    }

    this.updateDebugInfo(ctx, {
      remoteRun: {
        targetEnv: ctx.remoteIntegrationSource.targetEnv,
        remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
        remoteUserEmail: ctx.remoteIntegrationSource.remoteUserEmail ?? null,
        allowedIntegrations: ctx.allowedIntegrations ? [...ctx.allowedIntegrations] : undefined,
      },
    });
  }

  private recordRemoteRunPhase(
    ctx: GenerationContext,
    phase: RemoteRunDebugPhase,
    extra?: Partial<NonNullable<GenerationDebugInfo["remoteRun"]>>,
  ): void {
    if (!ctx.remoteIntegrationSource) {
      return;
    }

    this.ensureRemoteRunDebugInfo(ctx);
    this.updateDebugInfo(ctx, {
      remoteRun: {
        ...extra,
        phases: {
          [phase]: new Date().toISOString(),
        },
      },
    });
    this.scheduleSave(ctx);

    logServerEvent(
      "info",
      "REMOTE_RUN_PHASE",
      {
        phase,
        targetEnv: ctx.remoteIntegrationSource.targetEnv,
        remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
        allowedIntegrations: ctx.allowedIntegrations ?? null,
        attachedTokenEnvVarNames: extra?.attachedTokenEnvVarNames ?? null,
        sessionErrorMessage: extra?.sessionErrorMessage ?? null,
      },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );
  }

  private captureOriginalError(
    ctx: GenerationContext,
    error: unknown,
    options?: {
      phase?: string | null;
      runtimeFailure?: RuntimeFailureClassification | null;
    },
  ): void {
    const phase = options?.phase ?? this.getCurrentPhase(ctx);
    const formatted = formatErrorMessage(error);
    const capturedAt = new Date().toISOString();

    if (!ctx.debugInfo?.originalErrorMessage) {
      this.updateDebugInfo(ctx, {
        originalErrorMessage: formatted,
        originalErrorName: error instanceof Error ? error.name : null,
        originalErrorPhase: phase,
        originalErrorAt: capturedAt,
      });
    }
    if (options?.runtimeFailure !== undefined) {
      this.updateDebugInfo(ctx, {
        runtimeFailure: options.runtimeFailure,
      });
    }
    this.scheduleSave(ctx);

    logServerEvent(
      "error",
      "GENERATION_CAUGHT_ERROR",
      {
        phase,
        originalErrorAt: capturedAt,
        runtimeFailure: options?.runtimeFailure ?? null,
        originalErrorMessage: formatted,
        originalErrorName: error instanceof Error ? error.name : null,
      },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );
  }

  private async collectEmptyCompletionDiagnostics(
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ): Promise<{
    sessionGetError: string | null;
    sessionGetErrorDetail: string | null;
    sessionGetDataShape: string | null;
    sessionGetDataDetail: string | null;
    opencodeLogTail: string | null;
    opencodeLogReadError: string | null;
  }> {
    let sessionGetError: string | null = null;
    let sessionGetErrorDetail: string | null = null;
    let sessionGetDataShape: string | null = null;
    let sessionGetDataDetail: string | null = null;
    let opencodeLogTail: string | null = null;
    let opencodeLogReadError: string | null = null;

    try {
      const sessionResult = await runtimeClient.getSession({ sessionID: sessionId });
      if (sessionResult.error) {
        sessionGetError = formatErrorMessage(sessionResult.error);
        sessionGetErrorDetail = summarizeUnknownValue(sessionResult.error, 1_500);
      } else {
        sessionGetDataShape = describePromptResultData(sessionResult.data);
        sessionGetDataDetail =
          sessionResult.data === null || sessionResult.data === undefined
            ? null
            : summarizeUnknownValue(sessionResult.data, 1_500);
      }
    } catch (error) {
      sessionGetError = formatErrorMessage(error);
      sessionGetErrorDetail = summarizeUnknownValue(error, 1_500);
    }

    if (ctx.sandbox) {
      try {
        const rawLog = await ctx.sandbox.readFile("/tmp/opencode.log");
        opencodeLogTail = rawLog.trim() ? tailLogText(rawLog) : null;
      } catch (error) {
        opencodeLogReadError = formatErrorMessage(error);
      }
    }

    return {
      sessionGetError,
      sessionGetErrorDetail,
      sessionGetDataShape,
      sessionGetDataDetail,
      opencodeLogTail,
      opencodeLogReadError,
    };
  }

  private getRemainingRunTimeMs(ctx: Pick<GenerationContext, "deadlineAt">): number {
    return Math.max(0, ctx.deadlineAt.getTime() - Date.now());
  }

  private async waitForOpenCodeTerminalStateAfterEarlyStreamEnd(
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
    onEvent: (event: RuntimeEvent) => Promise<"continue" | "idle" | "error">,
  ): Promise<"idle" | "error" | "timed_out" | "aborted" | "unknown"> {
    for (let attempt = 1; attempt <= OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS; attempt += 1) {
      const remainingRunTimeMs = this.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        return "timed_out";
      }

      const reattachController = new AbortController();
      const reattachTimeoutId = setTimeout(
        () => reattachController.abort(),
        Math.min(remainingRunTimeMs, OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS),
      );
      try {
        const eventResult = await runtimeClient.subscribe(
          {},
          {
            signal: reattachController.signal,
          },
        );
        for await (const rawEvent of eventResult.stream) {
          const event = rawEvent as RuntimeEvent;
          const eventOutcome = await onEvent(event);
          if (eventOutcome !== "continue") {
            return eventOutcome;
          }
          if (ctx.abortController.signal.aborted) {
            return "aborted";
          }
        }
      } catch (error) {
        if (!reattachController.signal.aborted) {
          console.warn(
            `[GenerationManager] OpenCode terminal reattach failed attempt=${attempt} generationId=${ctx.id}:`,
            error,
          );
        }
      } finally {
        clearTimeout(reattachTimeoutId);
      }
    }

    if (!runtimeClient.status) {
      return "unknown";
    }

    let observedActiveStatus = false;
    while (true) {
      const remainingRunTimeMs = this.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        return "timed_out";
      }
      if (ctx.abortController.signal.aborted || (await this.refreshCancellationSignal(ctx))) {
        return "aborted";
      }
      await this.pollExternalInterruptAndSuspendIfNeeded(ctx);

      try {
        const statusResult = await runtimeClient.status();
        if (statusResult.error) {
          console.warn(
            "[GenerationManager] OpenCode status poll returned an error:",
            statusResult.error,
          );
          return "unknown";
        }

        const statusType = getRuntimeStatusTypeForSession(statusResult.data, sessionId);
        if (statusType === "idle") {
          return "idle";
        }
        if (statusType === "busy" || statusType === "retry") {
          observedActiveStatus = true;
        } else {
          const messagesResult = await runtimeClient.messages({ sessionID: sessionId, limit: 20 });
          if (
            !messagesResult.error &&
            extractAssistantTextFromSessionMessagesPayload(messagesResult.data)
          ) {
            return "idle";
          }
          if (observedActiveStatus) {
            return "idle";
          }
        }
      } catch (error) {
        console.warn("[GenerationManager] OpenCode status reconciliation failed:", error);
        return "unknown";
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(OPENCODE_STATUS_POLL_INTERVAL_MS, remainingRunTimeMs)),
      );
    }
  }

  private refreshRemainingRunBudget(ctx: GenerationContext, now = new Date()): number {
    const remainingRunMs = Math.max(0, ctx.deadlineAt.getTime() - now.getTime());
    ctx.remainingRunMs = remainingRunMs;
    return remainingRunMs;
  }

  private resumeDeadlineFromRemainingBudget(ctx: GenerationContext, now = new Date()): Date {
    const remainingRunMs =
      ctx.remainingRunMs && ctx.remainingRunMs > 0
        ? ctx.remainingRunMs
        : generationLifecyclePolicy.runDeadlineMs;
    ctx.deadlineAt = new Date(now.getTime() + remainingRunMs);
    return ctx.deadlineAt;
  }

  private getApprovalHotWaitMs(ctx: Pick<GenerationContext, "approvalHotWaitMs">): number {
    return Math.max(1_000, ctx.approvalHotWaitMs);
  }

  private async resolveSandboxRuntimeEnvForContext(
    ctx: GenerationContext,
  ): Promise<Record<string, string | null | undefined>> {
    const userTimezonePromise =
      typeof db.query.user?.findFirst === "function"
        ? db.query.user.findFirst({
            where: eq(user.id, ctx.userId),
            columns: { timezone: true },
          })
        : Promise.resolve(null);
    const [cliEnv, enabledIntegrations, dbUser] = await Promise.all([
      getCliEnvForUser(ctx.userId),
      getEnabledIntegrationTypes(ctx.userId),
      userTimezonePromise,
    ]);
    const allowedIntegrations = ctx.allowedIntegrations ?? enabledIntegrations;
    let filteredCliEnv = filterCliEnvToAllowedIntegrations(cliEnv, ctx.allowedIntegrations);

    if (ctx.remoteIntegrationSource && allowedIntegrations.length > 0) {
      const remoteCredentials = await getRemoteIntegrationCredentials({
        targetEnv: ctx.remoteIntegrationSource.targetEnv,
        remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
        integrationTypes: allowedIntegrations,
        requestedByUserId: ctx.remoteIntegrationSource.requestedByUserId,
        requestedByEmail: ctx.remoteIntegrationSource.requestedByEmail ?? null,
      });
      filteredCliEnv = {
        ...filteredCliEnv,
        ...remoteCredentials.tokens,
      };
    }

    if (ctx.allowedIntegrations !== undefined) {
      filteredCliEnv.ALLOWED_INTEGRATIONS = ctx.allowedIntegrations.join(",");
    }
    if (dbUser?.timezone) {
      filteredCliEnv.CMDCLAW_USER_TIMEZONE = dbUser.timezone;
    }

    return {
      ...filteredCliEnv,
      APP_URL: resolveSandboxRuntimeAppUrl(),
      CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
      CONVERSATION_ID: ctx.conversationId,
    };
  }

  private broadcastApprovalParked(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
    releasedSandboxId?: string,
  ): void {
    this.broadcast(ctx, {
      type: "status_change",
      status: "approval_parked",
      metadata: {
        runtimeId: ctx.runtimeId,
        sandboxId: releasedSandboxId,
        releasedSandboxId,
        parkedInterruptId: interrupt.id,
      },
    });
  }

  private async refreshInterruptForPark(
    interrupt: GenerationInterruptRecord,
  ): Promise<GenerationInterruptRecord> {
    if (interrupt.status !== "pending") {
      return interrupt;
    }
    return (
      (await generationInterruptService.refreshInterruptExpiry(
        interrupt.id,
        computeParkedInterruptExpiryDate(),
      )) ?? interrupt
    );
  }

  private async enrichPluginWriteInterruptRuntimeTool(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<GenerationInterruptRecord> {
    if (interrupt.kind !== "plugin_write" || interrupt.display.runtimeTool) {
      return interrupt;
    }
    const command = interrupt.display.command;
    if (!command) {
      return interrupt;
    }
    const runtimeTool = getRuntimeToolRefForInterrupt(ctx, {
      providerRequestId: interrupt.providerRequestId,
      command,
    });
    if (!runtimeTool) {
      return interrupt;
    }
    return (
      (await generationInterruptService.updateInterruptDisplay(interrupt.id, {
        ...interrupt.display,
        runtimeTool,
      })) ?? interrupt
    );
  }

  private async parkGenerationForInterrupt(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<never> {
    const latest = await generationInterruptService.getInterrupt(interrupt.id);
    if (!latest || latest.status !== "pending") {
      throw new GenerationSuspendedError(
        interrupt.id,
        interrupt.kind === "auth" ? "auth" : "approval",
      );
    }

    const enrichedInterrupt = await this.enrichPluginWriteInterruptRuntimeTool(ctx, latest);
    const parkedInterrupt = await this.refreshInterruptForPark(enrichedInterrupt);
    const releasedSandboxId = ctx.sandboxId;
    this.broadcastApprovalParked(ctx, parkedInterrupt, releasedSandboxId);
    return await this.suspendGenerationForInterrupt(ctx, parkedInterrupt);
  }

  private scheduleApprovalPark(ctx: GenerationContext, interrupt: GenerationInterruptRecord): void {
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
    }
    ctx.approvalParkTimeoutId = setTimeout(() => {
      ctx.approvalParkTimeoutId = undefined;
      void (async () => {
        const activeCtx = this.activeGenerations.get(ctx.id);
        if (!activeCtx || activeCtx.currentInterruptId !== interrupt.id) {
          return;
        }
        const latest = await generationInterruptService.getInterrupt(interrupt.id);
        if (!latest || latest.status !== "pending") {
          return;
        }
        activeCtx.abortForInterruptPark = true;
        try {
          await this.parkGenerationForInterrupt(activeCtx, latest);
        } catch (error) {
          if (error instanceof GenerationSuspendedError) {
            activeCtx.abortController.abort();
            return;
          }
          activeCtx.abortForInterruptPark = false;
          console.error("[GenerationManager] Failed to park approval interrupt:", error);
        }
      })();
    }, this.getApprovalHotWaitMs(ctx));
    ctx.approvalParkTimeoutId.unref?.();
  }

  private startExternalInterruptPolling(ctx: GenerationContext): void {
    if (ctx.externalInterruptPollIntervalId) {
      return;
    }

    ctx.externalInterruptPollIntervalId = setInterval(() => {
      const activeCtx = this.activeGenerations.get(ctx.id);
      if (!activeCtx) {
        this.stopExternalInterruptPolling(ctx);
        return;
      }
      void this.pollExternalInterruptAndSuspendIfNeeded(activeCtx).catch((error) => {
        if (error instanceof GenerationSuspendedError) {
          activeCtx.abortController.abort();
          return;
        }
        console.error("[GenerationManager] External interrupt poll failed:", error);
      });
    }, 1_000);
    ctx.externalInterruptPollIntervalId.unref?.();
  }

  private stopExternalInterruptPolling(ctx: GenerationContext): void {
    if (!ctx.externalInterruptPollIntervalId) {
      return;
    }
    clearInterval(ctx.externalInterruptPollIntervalId);
    ctx.externalInterruptPollIntervalId = undefined;
  }

  private async recordRecoveryAttempt(ctx: GenerationContext): Promise<void> {
    ctx.recoveryAttempts += 1;
    await db
      .update(generation)
      .set({
        recoveryAttempts: ctx.recoveryAttempts,
      })
      .where(eq(generation.id, ctx.id));
  }

  private async finalizeDetachedGenerationError(params: {
    generationId: string;
    conversationId: string;
    runtimeId?: string;
    coworkerRunId?: string;
    message: string;
    completionReason: GenerationCompletionReason;
  }): Promise<void> {
    await generationInterruptService.cancelInterruptsForGeneration(params.generationId);
    await db
      .update(generation)
      .set({
        status: "error",
        pendingApproval: null,
        pendingAuth: null,
        isPaused: false,
        resumeInterruptId: null,
        suspendedAt: null,
        cancelRequestedAt: null,
        errorMessage: params.message,
        completionReason: params.completionReason,
        completedAt: new Date(),
      })
      .where(eq(generation.id, params.generationId));
    await db
      .update(conversation)
      .set({
        generationStatus: "error",
      })
      .where(eq(conversation.id, params.conversationId));
    if (params.runtimeId) {
      await conversationRuntimeService.clearActiveGeneration({
        runtimeId: params.runtimeId,
        generationId: params.generationId,
      });
    }
    if (params.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: new Date(),
          errorMessage: params.message,
        })
        .where(eq(coworkerRun.id, params.coworkerRunId));
    }
    await this.publishDetachedGenerationStreamEvent({
      generationId: params.generationId,
      conversationId: params.conversationId,
      event: {
        type: "error",
        message: params.message,
      },
    });
  }

  private async inspectRuntimeFailureState(
    ctx: GenerationContext,
    client?: RuntimeHarnessClient,
  ): Promise<{
    classification: RuntimeFailureClassification;
    exportState: RuntimeExportState;
    exportedPayload?: unknown;
  }> {
    const pendingInterrupt = await generationInterruptService.getPendingInterruptForGeneration(
      ctx.id,
    );
    if (pendingInterrupt?.kind === "auth") {
      return {
        classification: "waiting_auth",
        exportState: "waiting_auth",
      };
    }
    if (pendingInterrupt) {
      return {
        classification: "waiting_approval",
        exportState: "waiting_approval",
      };
    }

    let sandboxState: "live" | "missing" | "paused" | "dead" | "unknown" = ctx.sandbox
      ? "live"
      : "unknown";
    let exportState: RuntimeExportState = "non_terminal";
    let exportedPayload: unknown;

    if (ctx.sessionId && client) {
      try {
        const sessionResult = await client.getSession({ sessionID: ctx.sessionId });
        if (sessionResult.error) {
          if (isMissingSandboxError(sessionResult.error)) {
            sandboxState = "missing";
          }
        } else if (sessionResult.data && sandboxState === "unknown") {
          sandboxState = "live";
        }
      } catch (error) {
        if (isMissingSandboxError(error)) {
          sandboxState = "missing";
        }
      }
    }

    if (ctx.sandbox && ctx.sessionId) {
      try {
        const exportResult = await ctx.sandbox.execute(buildOpencodeExportCommand(ctx.sessionId), {
          timeout: 15_000,
        });
        if (exportResult.exitCode === 0) {
          exportedPayload = JSON.parse(extractEmbeddedJsonObject(exportResult.stdout));
          exportState = extractRuntimeExportState(exportedPayload);
          sandboxState = "live";
        } else if (isMissingSandboxError(exportResult.stderr || exportResult.stdout)) {
          sandboxState = "missing";
        } else {
          exportState = "broken";
        }
      } catch (error) {
        if (isMissingSandboxError(error)) {
          sandboxState = "missing";
        } else {
          exportState = "broken";
        }
      }
    } else if (sandboxState === "unknown") {
      sandboxState = "missing";
    }

    return {
      classification: classifyRuntimeFailure({
        exportState,
        sandboxState,
        canRecover: canAttemptRecovery(ctx),
      }),
      exportState,
      exportedPayload,
    };
  }

  private async resolveRuntimeFailure(
    ctx: GenerationContext,
    client?: RuntimeHarnessClient,
  ): Promise<RuntimeFailureClassification> {
    const inspected = await this.inspectRuntimeFailureState(ctx, client);
    if (inspected.classification !== "recoverable_live_runtime") {
      return inspected.classification;
    }

    await this.recordRecoveryAttempt(ctx);
    return inspected.classification;
  }

  private async setSnapshotRestoreAllowance(
    ctx: Pick<GenerationContext, "id" | "executionPolicy">,
    allow: boolean,
  ): Promise<void> {
    const current = ctx.executionPolicy.allowSnapshotRestoreOnRun ?? true;
    if (current === allow) {
      return;
    }

    ctx.executionPolicy = {
      ...ctx.executionPolicy,
      allowSnapshotRestoreOnRun: allow,
    };
    await db
      .update(generation)
      .set({
        executionPolicy: ctx.executionPolicy,
      })
      .where(eq(generation.id, ctx.id));
  }

  private scheduleRecoveryReattach(ctx: GenerationContext): void {
    const delayMs = generationLifecyclePolicy.recoveryObserveWindowMs;
    void this.enqueueGenerationRun(ctx.id, this.getGenerationRunType(ctx), {
      delayMs,
      dedupeKey: `recovery-${ctx.recoveryAttempts}`,
      runMode: "recovery_reattach",
    }).catch((error) => {
      console.error(
        `[GenerationManager] Failed to enqueue recovery attempt for generation ${ctx.id}:`,
        error,
      );
    });
  }

  private async releaseSandboxSlotLease(ctx: GenerationContext): Promise<void> {
    if (ctx.sandboxSlotLeaseRenewId) {
      clearInterval(ctx.sandboxSlotLeaseRenewId);
      ctx.sandboxSlotLeaseRenewId = undefined;
    }
    if (!ctx.sandboxSlotLeaseToken) {
      return;
    }

    const token = ctx.sandboxSlotLeaseToken;
    ctx.sandboxSlotLeaseToken = undefined;
    await getSandboxSlotManager().releaseLease(ctx.id, token);
  }

  private async ensureSandboxSlotLease(
    ctx: GenerationContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued" | "waiting"> {
    if (ctx.sandboxSlotLeaseToken) {
      return "acquired";
    }

    const acquired = await getSandboxSlotManager().acquireLease(ctx.id);
    if (acquired.granted) {
      ctx.sandboxSlotLeaseToken = acquired.token;
      ctx.sandboxSlotLeaseRenewId = setInterval(() => {
        if (!ctx.sandboxSlotLeaseToken) {
          return;
        }
        void getSandboxSlotManager()
          .renewLease(ctx.id, ctx.sandboxSlotLeaseToken)
          .catch((error) => {
            console.error(
              `[GenerationManager] Failed to renew sandbox slot for generation ${ctx.id}:`,
              error,
            );
          });
      }, 30_000);
      return "acquired";
    }

    if (options?.allowWorkerRequeue ?? false) {
      await this.enqueueGenerationRun(ctx.id, this.getGenerationRunType(ctx), {
        delayMs: SANDBOX_SLOT_RETRY_DELAY_MS,
        dedupeKey: `slot-${Date.now()}`,
        runMode: options?.runMode ?? "normal_run",
      });
      this.evictActiveGenerationContext(ctx.id);
      return "requeued";
    }

    return "waiting";
  }

  private async waitForSandboxSlotLease(
    ctx: GenerationContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued"> {
    while (true) {
      const status = await this.ensureSandboxSlotLease(ctx, options);
      if (status === "acquired" || status === "requeued") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, SANDBOX_SLOT_RETRY_DELAY_MS));
    }
  }

  private async enqueueGenerationTimeout(
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

  private async enqueuePreparingStuckCheck(generationId: string): Promise<void> {
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
      logServerEvent(
        "warn",
        "GENERATION_PREPARING_STUCK_CHECK_ENQUEUE_FAILED",
        {
          generationId,
          error: formatErrorMessage(error),
        },
        { source: "generation-manager" },
      );
    }
  }

  private getExecutionPolicyFromRecord(
    genRecord: typeof generation.$inferSelect,
    fallbackAutoApprove: boolean,
  ): {
    allowedIntegrations?: IntegrationType[];
    allowedCustomIntegrations?: string[];
    allowedExecutorSourceIds?: string[];
    allowedSkillSlugs?: string[];
    remoteIntegrationSource?: RemoteIntegrationSource;
    autoApprove?: boolean;
    sandboxProvider?: "e2b" | "daytona" | "docker";
    selectedPlatformSkillSlugs?: string[];
    allowSnapshotRestoreOnRun?: boolean;
    debugRunDeadlineMs?: number;
    debugApprovalHotWaitMs?: number;
    queuedFileAttachments?: UserFileAttachment[];
  } {
    const policy =
      (genRecord.executionPolicy as GenerationExecutionPolicy | null | undefined) ?? undefined;
    const allowedIntegrations = Array.isArray(policy?.allowedIntegrations)
      ? (policy.allowedIntegrations.filter(
          (entry): entry is IntegrationType => typeof entry === "string",
        ) as IntegrationType[])
      : undefined;
    const remoteIntegrationSource = remoteIntegrationSourceSchema.safeParse(
      policy?.remoteIntegrationSource,
    );
    return {
      allowedIntegrations,
      allowedCustomIntegrations: policy?.allowedCustomIntegrations,
      allowedExecutorSourceIds: policy?.allowedExecutorSourceIds,
      allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(policy?.allowedSkillSlugs),
      remoteIntegrationSource: remoteIntegrationSource.success
        ? remoteIntegrationSource.data
        : undefined,
      autoApprove: policy?.autoApprove ?? fallbackAutoApprove,
      sandboxProvider:
        policy?.sandboxProvider === "e2b" ||
        policy?.sandboxProvider === "daytona" ||
        policy?.sandboxProvider === "docker"
          ? policy.sandboxProvider
          : undefined,
      selectedPlatformSkillSlugs: Array.isArray(policy?.selectedPlatformSkillSlugs)
        ? policy.selectedPlatformSkillSlugs.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : undefined,
      allowSnapshotRestoreOnRun: policy?.allowSnapshotRestoreOnRun ?? true,
      debugRunDeadlineMs: policy?.debugRunDeadlineMs,
      debugApprovalHotWaitMs: policy?.debugApprovalHotWaitMs,
      queuedFileAttachments: Array.isArray(policy?.queuedFileAttachments)
        ? policy.queuedFileAttachments.filter(
            (entry): entry is UserFileAttachment =>
              !!entry &&
              typeof entry === "object" &&
              typeof entry.name === "string" &&
              typeof entry.mimeType === "string" &&
              typeof entry.dataUrl === "string",
          )
        : undefined,
    };
  }

  private markPhase(ctx: GenerationContext, phase: string): void {
    const now = Date.now();
    const startedAtMs = ctx.startedAt.getTime();
    if (!ctx.phaseMarks) {
      ctx.phaseMarks = {};
    }
    if (!ctx.phaseTimeline) {
      ctx.phaseTimeline = [];
    }
    if (ctx.phaseMarks[phase] === undefined) {
      ctx.phaseMarks[phase] = now;
    }
    ctx.phaseTimeline.push({
      phase,
      atMs: now,
      elapsedMs: Math.max(0, now - startedAtMs),
    });
  }

  private async checkModelAccessForUser(params: {
    userId: string;
    model: string;
    authSource?: ProviderAuthSource | null;
  }): Promise<ModelAccessCheckResult> {
    const { providerID, modelID } = parseModelReference(params.model);
    const authSource = resolveModelAuthSource({
      model: params.model,
      authSource: params.authSource,
    });

    if (providerID === "opencode") {
      const models = await listOpencodeFreeModels();
      if (models.some((model) => model.id === params.model)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: "opencode_model_unavailable",
        userMessage:
          "Selected OpenCode model is no longer available. Choose another model and retry.",
      };
    }

    if (isAdminOnlyChatModel(params.model)) {
      const dbUser =
        "user" in db.query
          ? await db.query.user.findFirst({
              where: eq(user.id, params.userId),
              columns: { role: true },
            })
          : null;
      if (dbUser?.role !== "admin") {
        return {
          allowed: false,
          reason: "admin_only_model",
          userMessage:
            "Claude Sonnet 4.6 is only available to admins. Choose another model and retry.",
        };
      }
    }

    const authProviderID = getProviderAuthProviderID(providerID);
    if (authSource !== null || authProviderID !== null) {
      const availabilityChecks: ProviderAuthAvailability =
        authProviderID === null
          ? resolveProviderAuthAvailability({
              providerID,
              sharedConnectedProviderIds: env.ANTHROPIC_API_KEY ? ["anthropic"] : [],
            })
          : authSource === "user"
            ? {
                user: await hasConnectedProviderAuthForUser(params.userId, authProviderID, "user"),
                shared: false,
              }
            : authSource === "shared"
              ? {
                  user: false,
                  shared: await hasConnectedProviderAuthForUser(
                    params.userId,
                    authProviderID,
                    "shared",
                  ),
                }
              : {
                  user: await hasConnectedProviderAuthForUser(
                    params.userId,
                    authProviderID,
                    "user",
                  ),
                  shared: await hasConnectedProviderAuthForUser(
                    params.userId,
                    authProviderID,
                    "shared",
                  ),
                };
      const hasAuth = authSource ? availabilityChecks[authSource] : true;
      if (!hasAuth) {
        const providerLabel = getProviderDisplayName(providerID);
        return {
          allowed: false,
          reason: `${providerID}_not_connected`,
          userMessage:
            authSource === "shared"
              ? `This ${providerLabel} model requires the shared workspace connection. Ask an admin to reconnect it, then retry.`
              : `This ${providerLabel} model requires your connected account. Connect it in Settings > Connected AI Account, then retry.`,
        };
      }
    }

    if (authProviderID === "openai" || authProviderID === "google" || authProviderID === "kimi") {
      const allowedIDs = new Set(getProviderModels(authProviderID).map((model) => model.id));
      if (!allowedIDs.has(modelID)) {
        const providerLabel = getProviderDisplayName(providerID);
        return {
          allowed: false,
          reason: `${providerID}_model_not_allowed`,
          userMessage: `Selected ${providerLabel} model is not available for your current connection. Choose another model and retry.`,
        };
      }
      return { allowed: true };
    }

    if (providerID === "anthropic") {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: "provider_not_supported",
      userMessage: `Selected model provider "${providerID}" is not supported in this environment.`,
    };
  }

  private buildMessageTiming(ctx: GenerationContext): MessageTiming {
    const generationCompletedAt = Date.now();
    const generationStartedAt = ctx.startedAt.getTime();
    const phaseMarks = ctx.phaseMarks ?? {};
    const phaseTimeline = ctx.phaseTimeline ?? [];
    const messageTiming: MessageTiming = {
      generationDurationMs: Math.max(0, generationCompletedAt - generationStartedAt),
    };
    const sandboxInitMs =
      phaseMarks.sandbox_init_started !== undefined && phaseMarks.agent_init_started !== undefined
        ? Math.max(0, phaseMarks.agent_init_started - phaseMarks.sandbox_init_started)
        : undefined;
    const sandboxConnectStartMs =
      phaseMarks.sandbox_init_checking_cache ?? phaseMarks.sandbox_init_started;
    const sandboxConnectEndMs = phaseMarks.sandbox_init_reused ?? phaseMarks.sandbox_init_created;
    const sandboxConnectOrCreateMs =
      sandboxConnectStartMs !== undefined && sandboxConnectEndMs !== undefined
        ? Math.max(0, sandboxConnectEndMs - sandboxConnectStartMs)
        : undefined;
    const sandboxCreateMs = phaseDurationMs(
      phaseMarks,
      "sandbox_init_creating",
      "sandbox_init_created",
    );
    const opencodeReadyStartMs =
      phaseMarks.agent_init_opencode_starting ?? phaseMarks.agent_init_started;
    const opencodeReadyMs =
      opencodeReadyStartMs !== undefined && phaseMarks.agent_init_opencode_ready !== undefined
        ? Math.max(0, phaseMarks.agent_init_opencode_ready - opencodeReadyStartMs)
        : undefined;
    const sessionReadyMs =
      phaseMarks.agent_init_session_reused !== undefined &&
      phaseMarks.agent_init_started !== undefined
        ? Math.max(0, phaseMarks.agent_init_session_reused - phaseMarks.agent_init_started)
        : phaseMarks.agent_init_session_creating !== undefined &&
            phaseMarks.agent_init_session_init_completed !== undefined
          ? Math.max(
              0,
              phaseMarks.agent_init_session_init_completed - phaseMarks.agent_init_session_creating,
            )
          : undefined;
    const legacySandboxStartupMs =
      ctx.agentInitStartedAt && ctx.agentSandboxReadyAt
        ? Math.max(0, ctx.agentSandboxReadyAt - ctx.agentInitStartedAt)
        : undefined;
    const resolvedSandboxStartupMs = sandboxConnectOrCreateMs ?? legacySandboxStartupMs;
    if (resolvedSandboxStartupMs !== undefined) {
      messageTiming.sandboxStartupDurationMs = resolvedSandboxStartupMs;
      messageTiming.sandboxStartupMode = ctx.agentSandboxMode ?? "unknown";
    }

    const agentInitMs =
      phaseMarks.agent_init_started !== undefined && phaseMarks.agent_init_ready !== undefined
        ? Math.max(0, phaseMarks.agent_init_ready - phaseMarks.agent_init_started)
        : undefined;
    const prePromptSetupMs =
      phaseMarks.pre_prompt_setup_started !== undefined && phaseMarks.prompt_sent !== undefined
        ? Math.max(0, phaseMarks.prompt_sent - phaseMarks.pre_prompt_setup_started)
        : undefined;
    const prePromptMemorySyncMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_memory_sync_started",
      "pre_prompt_memory_sync_completed",
    );
    const prePromptRuntimeContextWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_runtime_context_write_started",
      "pre_prompt_runtime_context_write_completed",
    );
    const prePromptExecutorPrepareMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_prepare_started",
      "pre_prompt_executor_prepare_completed",
    );
    const prePromptExecutorBootstrapLoadMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_bootstrap_load_started",
      "pre_prompt_executor_bootstrap_load_completed",
    );
    const prePromptExecutorConfigWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_config_write_started",
      "pre_prompt_executor_config_write_completed",
    );
    const prePromptExecutorServerProbeMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_server_probe_started",
      "pre_prompt_executor_server_probe_completed",
    );
    const prePromptExecutorServerWaitReadyMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_server_wait_ready_started",
      "pre_prompt_executor_server_wait_ready_completed",
    );
    const prePromptExecutorStatusCheckMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_status_check_started",
      "pre_prompt_executor_status_check_completed",
    );
    const prePromptExecutorOauthReconcileMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_executor_oauth_reconcile_started",
      "pre_prompt_executor_oauth_reconcile_completed",
    );
    const prePromptSkillsAndCredsLoadMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_skills_and_creds_load_started",
      "pre_prompt_skills_and_creds_load_completed",
    );
    const prePromptCacheReadMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_cache_read_started",
      "pre_prompt_cache_read_completed",
    );
    const prePromptSkillsWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_skills_write_started",
      "pre_prompt_skills_write_completed",
    );
    const prePromptCustomIntegrationCliWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_custom_integration_cli_write_started",
      "pre_prompt_custom_integration_cli_write_completed",
    );
    const prePromptCustomIntegrationPermissionsWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_custom_integration_permissions_write_started",
      "pre_prompt_custom_integration_permissions_write_completed",
    );
    const prePromptIntegrationSkillsWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_integration_skills_write_started",
      "pre_prompt_integration_skills_write_completed",
    );
    const prePromptCacheWriteMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_cache_write_started",
      "pre_prompt_cache_write_completed",
    );
    const prePromptPromptSpecComposeMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_prompt_spec_compose_started",
      "pre_prompt_prompt_spec_compose_completed",
    );
    const prePromptEventStreamSubscribeMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_event_stream_subscribe_started",
      "pre_prompt_event_stream_subscribe_completed",
    );
    const prePromptCoworkerDocsStageMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_coworker_docs_stage_started",
      "pre_prompt_coworker_docs_stage_completed",
    );
    const prePromptAttachmentsStageMs = phaseDurationMs(
      phaseMarks,
      "pre_prompt_attachments_stage_started",
      "pre_prompt_attachments_stage_completed",
    );
    const waitForFirstEventMs =
      phaseMarks.prompt_sent !== undefined && phaseMarks.first_event_received !== undefined
        ? Math.max(0, phaseMarks.first_event_received - phaseMarks.prompt_sent)
        : undefined;
    const firstTokenAtMs = phaseMarks.first_token_emitted;
    const firstVisibleOutputAtMs =
      phaseMarks.first_visible_output_emitted ?? phaseMarks.first_token_emitted;
    const promptToFirstTokenMs =
      phaseMarks.prompt_sent !== undefined && firstTokenAtMs !== undefined
        ? Math.max(0, firstTokenAtMs - phaseMarks.prompt_sent)
        : undefined;
    const generationToFirstTokenMs =
      phaseMarks.generation_started !== undefined && firstTokenAtMs !== undefined
        ? Math.max(0, firstTokenAtMs - phaseMarks.generation_started)
        : undefined;
    const promptToFirstVisibleOutputMs =
      phaseMarks.prompt_sent !== undefined && firstVisibleOutputAtMs !== undefined
        ? Math.max(0, firstVisibleOutputAtMs - phaseMarks.prompt_sent)
        : undefined;
    const generationToFirstVisibleOutputMs =
      phaseMarks.generation_started !== undefined && firstVisibleOutputAtMs !== undefined
        ? Math.max(0, firstVisibleOutputAtMs - phaseMarks.generation_started)
        : undefined;
    const streamFinishedAt = phaseMarks.session_idle ?? phaseMarks.prompt_completed;
    const modelStreamMs =
      phaseMarks.first_event_received !== undefined && streamFinishedAt !== undefined
        ? Math.max(0, streamFinishedAt - phaseMarks.first_event_received)
        : undefined;
    const postProcessingMs =
      phaseMarks.post_processing_started !== undefined &&
      phaseMarks.post_processing_completed !== undefined
        ? Math.max(0, phaseMarks.post_processing_completed - phaseMarks.post_processing_started)
        : undefined;

    const phaseDurationsMs = {
      sandboxInitMs,
      sandboxConnectOrCreateMs,
      sandboxCreateMs,
      opencodeReadyMs,
      sessionReadyMs,
      agentInitMs,
      prePromptSetupMs,
      prePromptMemorySyncMs,
      prePromptRuntimeContextWriteMs,
      prePromptExecutorPrepareMs,
      prePromptExecutorBootstrapLoadMs,
      prePromptExecutorConfigWriteMs,
      prePromptExecutorServerProbeMs,
      prePromptExecutorServerWaitReadyMs,
      prePromptExecutorStatusCheckMs,
      prePromptExecutorOauthReconcileMs,
      prePromptSkillsAndCredsLoadMs,
      prePromptCacheReadMs,
      prePromptSkillsWriteMs,
      prePromptCustomIntegrationCliWriteMs,
      prePromptCustomIntegrationPermissionsWriteMs,
      prePromptIntegrationSkillsWriteMs,
      prePromptCacheWriteMs,
      prePromptPromptSpecComposeMs,
      prePromptEventStreamSubscribeMs,
      prePromptCoworkerDocsStageMs,
      prePromptAttachmentsStageMs,
      waitForFirstEventMs,
      promptToFirstTokenMs,
      generationToFirstTokenMs,
      promptToFirstVisibleOutputMs,
      generationToFirstVisibleOutputMs,
      modelStreamMs,
      postProcessingMs,
    };
    if (Object.values(phaseDurationsMs).some((value) => value !== undefined)) {
      messageTiming.phaseDurationsMs = phaseDurationsMs;
    }

    if (phaseTimeline.length > 0) {
      messageTiming.phaseTimestamps = phaseTimeline.map((entry) => ({
        phase: entry.phase,
        at: new Date(entry.atMs).toISOString(),
        elapsedMs: entry.elapsedMs,
      }));
    }

    return messageTiming;
  }

  /**
   * Start a new generation for a conversation
   */
  async startGeneration(params: {
    conversationId?: string;
    content: string;
    model?: string;
    authSource?: ProviderAuthSource | null;
    userId: string;
    autoApprove?: boolean;
    sandboxProvider?: "e2b" | "daytona" | "docker";
    resumePausedGenerationId?: string;
    debugRunDeadlineMs?: number;
    debugApprovalHotWaitMs?: number;
    allowedIntegrations?: IntegrationType[];
    fileAttachments?: UserFileAttachment[];
    selectedPlatformSkillSlugs?: string[];
    remoteIntegrationSource?: RemoteIntegrationSource;
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model, autoApprove } = params;
    const runDeadlineMs = resolveGenerationRunDeadlineMs(params.debugRunDeadlineMs);
    const debugApprovalHotWaitMs =
      params.debugApprovalHotWaitMs === undefined
        ? undefined
        : resolveApprovalHotWaitMs(params.debugApprovalHotWaitMs);
    const fileAttachments = params.fileAttachments;
    const requestedModel = model?.trim();
    if (requestedModel) {
      const { providerID } = parseModelReference(requestedModel);
      if (params.authSource && !providerSupportsAuthSource(providerID, params.authSource)) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
          rpcCode: "BAD_REQUEST",
          message: `Model provider "${providerID}" does not support auth source "${params.authSource}".`,
        });
      }
    }
    const requestedAuthSource = requestedModel
      ? resolveModelAuthSource({
          model: requestedModel,
          authSource: params.authSource,
        })
      : null;
    const traceId = createTraceId();
    const startGenerationStartedAt = Date.now();
    const logContext = {
      source: "generation-manager",
      traceId,
      userId,
      conversationId: params.conversationId,
    };
    logServerEvent(
      "info",
      "START_GENERATION_REQUESTED",
      {
        hasConversationId: Boolean(params.conversationId),
        requestedModel: requestedModel ?? null,
        hasAllowedIntegrations: params.allowedIntegrations !== undefined,
        sandboxProviderOverride: params.sandboxProvider ?? null,
        fileAttachmentsCount: fileAttachments?.length ?? 0,
        selectedPlatformSkillCount: params.selectedPlatformSkillSlugs?.length ?? 0,
      },
      logContext,
    );

    if (params.conversationId) {
      // Cross-instance guard (DB is source of truth).
      const existing = await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, params.conversationId),
          inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        ),
        columns: {
          id: true,
          status: true,
          completionReason: true,
        },
      });
      const requestedContinuation = params.content.trim().replace(/\s+/g, " ").toLowerCase();
      const canResumePausedRunDeadline =
        existing?.status === "paused" &&
        existing.completionReason === "run_deadline" &&
        (params.resumePausedGenerationId === existing.id ||
          (requestedContinuation === "continue" &&
            (params.resumePausedGenerationId === undefined ||
              params.resumePausedGenerationId === existing.id)));
      if (existing && !canResumePausedRunDeadline) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.ACTIVE_GENERATION_EXISTS,
          rpcCode: "BAD_REQUEST",
          message: `Generation already in progress for this conversation (${existing.id}, status=${existing.status})`,
        });
      }
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "active_generation_check",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      logContext,
    );

    // Get or create conversation
    let conv: typeof conversation.$inferSelect;
    let isNewConversation = false;

    if (params.conversationId) {
      const existing = await db.query.conversation.findFirst({
        where: eq(conversation.id, params.conversationId),
      });
      if (!existing) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.CONVERSATION_NOT_FOUND,
          rpcCode: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      if (existing.userId !== userId) {
        throw new GenerationStartError({
          generationErrorCode: START_GENERATION_ERROR_CODES.ACCESS_DENIED,
          rpcCode: "FORBIDDEN",
          message: "Access denied",
        });
      }
      conv = existing;
    } else {
      isNewConversation = true;
      const resolvedModel = requestedModel ?? DEFAULT_MODEL_REFERENCE;
      const resolvedAuthSource = resolveModelAuthSource({
        model: resolvedModel,
        authSource: requestedAuthSource,
      });
      const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      const dbUser =
        "user" in db.query
          ? await db.query.user.findFirst({
              where: eq(user.id, userId),
              columns: {
                activeWorkspaceId: true,
              },
            })
          : null;
      const [newConv] = await db
        .insert(conversation)
        .values({
          userId,
          workspaceId: dbUser?.activeWorkspaceId ?? null,
          title,
          type: "chat",
          model: resolvedModel,
          authSource: resolvedAuthSource,
          autoApprove: false,
        })
        .returning();
      conv = newConv;
    }
    const resolvedModel = requestedModel ?? conv.model ?? DEFAULT_MODEL_REFERENCE;
    const resolvedAuthSource = resolveModelAuthSource({
      model: resolvedModel,
      authSource: requestedAuthSource ?? conv.authSource,
    });
    if (requestedModel || conv.authSource !== resolvedAuthSource) {
      const [updatedConv] = await db
        .update(conversation)
        .set({
          model: resolvedModel,
          authSource: resolvedAuthSource,
        })
        .where(eq(conversation.id, conv.id))
        .returning();
      if (updatedConv) {
        conv = updatedConv;
      }
    }
    const accessCheck = await this.checkModelAccessForUser({
      userId,
      model: resolvedModel,
      authSource: resolvedAuthSource,
    });
    if (!accessCheck.allowed) {
      logServerEvent(
        "warn",
        "START_GENERATION_MODEL_ACCESS_DENIED",
        {
          requestedModel: requestedModel ?? null,
          resolvedModel,
          reason: accessCheck.reason,
        },
        { ...logContext, conversationId: conv.id },
      );
      throw new GenerationStartError({
        generationErrorCode: START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
        rpcCode: "BAD_REQUEST",
        message: accessCheck.userMessage,
      });
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "model_access_validated",
        elapsedMs: Date.now() - startGenerationStartedAt,
        resolvedModel,
        resolvedAuthSource,
      },
      { ...logContext, conversationId: conv.id },
    );
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_ready",
        elapsedMs: Date.now() - startGenerationStartedAt,
        resolvedConversationId: conv.id,
        isNewConversation,
      },
      { ...logContext, conversationId: conv.id },
    );

    const selectedPlatformSkillSlugs = await resolveSelectedPlatformSkillSlugs(
      params.selectedPlatformSkillSlugs,
    );
    let builderCoworkerContext =
      conv.type === "coworker"
        ? await resolveCoworkerBuilderContextByConversation({
            database: db,
            userId,
            conversationId: conv.id,
          })
        : null;

    // Save user message
    const [userMsg] = await db
      .insert(message)
      .values({
        conversationId: conv.id,
        role: "user",
        content,
      })
      .returning();

    if (builderCoworkerContext) {
      const coworkerMetadataRow = await db.query.coworker.findFirst({
        where: and(
          eq(coworker.id, builderCoworkerContext.coworkerId),
          eq(coworker.ownerId, userId),
        ),
        columns: {
          id: true,
          name: true,
          description: true,
          username: true,
          prompt: true,
          triggerType: true,
          allowedIntegrations: true,
          allowedCustomIntegrations: true,
          schedule: true,
          autoApprove: true,
          promptDo: true,
          promptDont: true,
        },
      });

      if (coworkerMetadataRow) {
        const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
          database: db,
          current: coworkerMetadataRow,
          next: {
            ...coworkerMetadataRow,
            prompt: content,
          },
        });
        const persistedMetadataUpdates = Object.fromEntries(
          Object.entries(metadataUpdates).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );

        if (Object.keys(persistedMetadataUpdates).length > 0) {
          await db
            .update(coworker)
            .set(persistedMetadataUpdates)
            .where(eq(coworker.id, builderCoworkerContext.coworkerId));

          builderCoworkerContext =
            (await resolveCoworkerBuilderContextByConversation({
              database: db,
              userId,
              conversationId: conv.id,
            })) ?? builderCoworkerContext;
        }
      }
    }

    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "message_saved",
        elapsedMs: Date.now() - startGenerationStartedAt,
        messageId: userMsg.id,
      },
      { ...logContext, conversationId: conv.id },
    );

    // Upload user file attachments to S3 and save metadata
    if (fileAttachments && fileAttachments.length > 0) {
      try {
        await this.persistMessageAttachments({
          conversationId: conv.id,
          messageId: userMsg.id,
          attachments: fileAttachments,
        });
        logServerEvent(
          "info",
          "START_GENERATION_PHASE_DONE",
          {
            phase: "attachments_uploaded",
            elapsedMs: Date.now() - startGenerationStartedAt,
            fileAttachmentsCount: fileAttachments.length,
          },
          { ...logContext, conversationId: conv.id },
        );
      } catch (err) {
        logServerEvent(
          "error",
          "START_GENERATION_ATTACHMENTS_UPLOAD_FAILED",
          {
            elapsedMs: Date.now() - startGenerationStartedAt,
            error: formatErrorMessage(err),
          },
          { ...logContext, conversationId: conv.id },
        );
      }
    }

    // Create generation record
    const executionPolicy = buildExecutionPolicy({
      allowedIntegrations: params.allowedIntegrations,
      remoteIntegrationSource: params.remoteIntegrationSource,
      autoApprove: autoApprove ?? conv.autoApprove,
      sandboxProvider: params.sandboxProvider,
      selectedPlatformSkillSlugs,
      queuedFileAttachments: fileAttachments,
      debugRunDeadlineMs: params.debugRunDeadlineMs,
      debugApprovalHotWaitMs,
    });
    const lifecycle = createGenerationLifecycle();
    lifecycle.deadlineAt = new Date(lifecycle.lastRuntimeEventAt.getTime() + runDeadlineMs);
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: conv.id,
        status: "running",
        executionPolicy,
        debugInfo: buildInitialDebugInfo(
          params.remoteIntegrationSource,
          params.allowedIntegrations,
        ),
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
        deadlineAt: lifecycle.deadlineAt,
        remainingRunMs: runDeadlineMs,
        lastRuntimeEventAt: lifecycle.lastRuntimeEventAt,
        recoveryAttempts: lifecycle.recoveryAttempts,
        completionReason: lifecycle.completionReason,
      })
      .returning();
    const runtimeBinding = await conversationRuntimeService.bindGenerationToRuntime({
      conversationId: conv.id,
      generationId: genRecord.id,
    });
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "generation_record_created",
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: genRecord.id,
        runtimeId: runtimeBinding.runtimeId,
        turnSeq: runtimeBinding.turnSeq,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    // Update conversation status
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: genRecord.id,
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, conv.id));
    await this.enqueuePreparingStuckCheck(genRecord.id);
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_status_updated",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    const backendType: BackendType = "opencode";
    await this.enqueueGenerationRun(genRecord.id, "chat");

    logServerEvent(
      "info",
      "GENERATION_ENQUEUED",
      {
        backendType,
        delivery: "queue",
        enqueuedAttachmentsCount: fileAttachments?.length ?? 0,
      },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: conv.id,
        userId,
      },
    );
    logServerEvent(
      "info",
      "START_GENERATION_RETURNING",
      {
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: genRecord.id,
      },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: conv.id,
        userId,
      },
    );

    return {
      generationId: genRecord.id,
      conversationId: conv.id,
    };
  }

  /**
   * Start a new coworker generation.
   */
  async startCoworkerGeneration(params: {
    coworkerId: string;
    coworkerRunId: string;
    content: string;
    model?: string;
    authSource?: ProviderAuthSource | null;
    userId: string;
    workspaceId?: string | null;
    autoApprove: boolean;
    sandboxProvider?: "e2b" | "daytona" | "docker";
    allowedIntegrations: IntegrationType[];
    allowedCustomIntegrations?: string[];
    allowedExecutorSourceIds?: string[];
    allowedSkillSlugs?: string[];
    fileAttachments?: UserFileAttachment[];
    remoteIntegrationSource?: RemoteIntegrationSource;
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model } = params;
    const resolvedModel = await resolveCoworkerModel(model);
    const resolvedAuthSource = resolveModelAuthSource({
      model: resolvedModel,
      authSource: params.authSource,
    });
    const accessCheck = await this.checkModelAccessForUser({
      userId,
      model: resolvedModel,
      authSource: resolvedAuthSource,
    });
    if (!accessCheck.allowed) {
      throw new Error(accessCheck.userMessage);
    }
    const normalizedAllowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(
      params.allowedSkillSlugs,
    );
    const { platformSkillSlugs } = splitCoworkerAllowedSkillSlugs(normalizedAllowedSkillSlugs);
    const selectedPlatformSkillSlugs = await resolveSelectedPlatformSkillSlugs(platformSkillSlugs);

    const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    const [newConv] = await db
      .insert(conversation)
      .values({
        userId,
        workspaceId: params.workspaceId ?? null,
        title: title || "Coworker run",
        type: "coworker",
        model: resolvedModel,
        authSource: resolvedAuthSource,
        autoApprove: params.autoApprove,
      })
      .returning();

    const [userMessage] = await db
      .insert(message)
      .values({
        conversationId: newConv.id,
        role: "user",
        content,
      })
      .returning({ id: message.id });

    if (!userMessage?.id) {
      throw new Error("Failed to create coworker user message");
    }

    if (params.fileAttachments && params.fileAttachments.length > 0) {
      await this.persistMessageAttachments({
        conversationId: newConv.id,
        messageId: userMessage.id,
        attachments: params.fileAttachments,
      });
    }

    const executionPolicy = buildExecutionPolicy({
      allowedIntegrations: params.allowedIntegrations,
      allowedCustomIntegrations: params.allowedCustomIntegrations,
      allowedExecutorSourceIds: params.allowedExecutorSourceIds,
      allowedSkillSlugs: normalizedAllowedSkillSlugs,
      remoteIntegrationSource: params.remoteIntegrationSource,
      autoApprove: params.autoApprove,
      sandboxProvider: params.sandboxProvider,
      selectedPlatformSkillSlugs,
      queuedFileAttachments: params.fileAttachments,
    });
    const lifecycle = createGenerationLifecycle();
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: newConv.id,
        status: "running",
        executionPolicy,
        debugInfo: buildInitialDebugInfo(
          params.remoteIntegrationSource,
          params.allowedIntegrations,
        ),
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
        deadlineAt: lifecycle.deadlineAt,
        remainingRunMs: generationLifecyclePolicy.runDeadlineMs,
        lastRuntimeEventAt: lifecycle.lastRuntimeEventAt,
        recoveryAttempts: lifecycle.recoveryAttempts,
        completionReason: lifecycle.completionReason,
      })
      .returning();
    const runtimeBinding = await conversationRuntimeService.bindGenerationToRuntime({
      conversationId: newConv.id,
      generationId: genRecord.id,
    });

    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: genRecord.id,
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, newConv.id));

    const traceId = createTraceId();
    await this.enqueueGenerationRun(genRecord.id, "coworker");

    logServerEvent(
      "info",
      "COWORKER_GENERATION_ENQUEUED",
      { delivery: "queue" },
      {
        source: "generation-manager",
        traceId,
        generationId: genRecord.id,
        conversationId: newConv.id,
        userId,
      },
    );

    return {
      generationId: genRecord.id,
      conversationId: newConv.id,
    };
  }

  async runQueuedGeneration(
    generationId: string,
    runMode: GenerationRunMode = "normal_run",
  ): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return;
    }
    if (!genRecord.conversation.userId) {
      return;
    }

    let leaseToken: string | null = null;
    try {
      leaseToken = await this.acquireGenerationLease(generationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: message,
          completionReason: "runtime_error",
          completedAt: new Date(),
        })
        .where(eq(generation.id, generationId));
      return;
    }
    if (!leaseToken) {
      return;
    }

    try {
      const latestUserMessage = await db.query.message.findFirst({
        where: and(eq(message.conversationId, genRecord.conversationId), eq(message.role, "user")),
        orderBy: (fields, { desc }) => [desc(fields.createdAt)],
        columns: { content: true },
      });
      const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
        where: eq(coworkerRun.generationId, generationId),
        columns: { id: true, coworkerId: true, triggerPayload: true },
      });
      const linkedCoworker = linkedCoworkerRun
        ? await db.query.coworker.findFirst({
            where: eq(coworker.id, linkedCoworkerRun.coworkerId),
            columns: {
              allowedIntegrations: true,
              allowedCustomIntegrations: true,
              allowedExecutorSourceIds: true,
              allowedSkillSlugs: true,
              prompt: true,
              promptDo: true,
              promptDont: true,
              autoApprove: true,
            },
          })
        : null;
      const executionPolicy = this.getExecutionPolicyFromRecord(
        genRecord,
        linkedCoworker?.autoApprove ?? genRecord.conversation.autoApprove,
      );
      const linkedCoworkerAllowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(
        linkedCoworker?.allowedSkillSlugs,
      );
      const linkedCoworkerPlatformSkillSlugs = linkedCoworkerAllowedSkillSlugs.filter(
        (entry) => !entry.startsWith(CUSTOM_SKILL_PREFIX),
      );
      const builderCoworkerContext =
        genRecord.conversation.type === "coworker"
          ? await resolveCoworkerBuilderContextByConversation({
              database: db,
              userId: genRecord.conversation.userId,
              conversationId: genRecord.conversationId,
            })
          : null;
      const pendingInterrupt =
        await generationInterruptService.getPendingInterruptForGeneration(generationId);
      const runtimeRecord = genRecord.runtimeId
        ? await conversationRuntimeService.getRuntime(genRecord.runtimeId)
        : await conversationRuntimeService.getRuntimeForConversation(genRecord.conversationId);

      if (
        genRecord.runtimeId &&
        (!runtimeRecord ||
          runtimeRecord.status !== "active" ||
          runtimeRecord.activeGenerationId !== genRecord.id)
      ) {
        logServerEvent(
          "warn",
          "QUEUED_GENERATION_RUNTIME_STALE",
          {
            generationId: genRecord.id,
            runtimeId: genRecord.runtimeId,
            runtimeStatus: runtimeRecord?.status ?? null,
            runtimeActiveGenerationId: runtimeRecord?.activeGenerationId ?? null,
          },
          {
            source: "generation-manager",
            generationId: genRecord.id,
            conversationId: genRecord.conversationId,
            userId: genRecord.conversation.userId,
          },
        );
        return;
      }

      const ctx: GenerationContext = {
        id: genRecord.id,
        traceId: createTraceId(),
        conversationId: genRecord.conversationId,
        userId: genRecord.conversation.userId,
        workspaceId: genRecord.conversation.workspaceId ?? null,
        status: genRecord.status,
        executionPolicy,
        deadlineAt: resolveGenerationDeadlineAt({
          startedAt: genRecord.startedAt,
          deadlineAt: genRecord.deadlineAt,
        }),
        remainingRunMs:
          genRecord.remainingRunMs && genRecord.remainingRunMs > 0
            ? genRecord.remainingRunMs
            : generationLifecyclePolicy.runDeadlineMs,
        approvalHotWaitMs: resolveApprovalHotWaitMs(executionPolicy.debugApprovalHotWaitMs),
        suspendedAt: genRecord.suspendedAt ?? null,
        resumeInterruptId: genRecord.resumeInterruptId ?? null,
        lastRuntimeEventAt: genRecord.lastRuntimeEventAt ?? genRecord.startedAt,
        recoveryAttempts: genRecord.recoveryAttempts ?? 0,
        completionReason: (genRecord.completionReason as GenerationCompletionReason | null) ?? null,
        debugInfo: (genRecord.debugInfo as GenerationDebugInfo | null) ?? undefined,
        contentParts: (genRecord.contentParts as ContentPart[] | null) ?? [],
        assistantContent: "",
        abortController: new AbortController(),
        pendingApproval: null,
        pendingAuth: null,
        usage: {
          inputTokens: genRecord.inputTokens,
          outputTokens: genRecord.outputTokens,
          totalCostUsd: 0,
        },
        startedAt: genRecord.startedAt,
        lastSaveAt: new Date(),
        isNewConversation: false,
        model: genRecord.conversation.model ?? DEFAULT_MODEL_REFERENCE,
        authSource: resolveModelAuthSource({
          model: genRecord.conversation.model ?? DEFAULT_MODEL_REFERENCE,
          authSource: genRecord.conversation.authSource,
        }),
        userMessageContent: latestUserMessage?.content ?? "",
        attachments: executionPolicy.queuedFileAttachments,
        assistantMessageIds: new Set(),
        messageRoles: new Map(),
        pendingMessageParts: new Map(),
        openCodeRuntimeTools: new Map(),
        backendType: "opencode",
        sandboxProviderOverride: executionPolicy.sandboxProvider,
        coworkerId: linkedCoworkerRun?.coworkerId,
        coworkerRunId: linkedCoworkerRun?.id,
        allowedIntegrations:
          executionPolicy.allowedIntegrations ??
          (linkedCoworker?.allowedIntegrations as IntegrationType[] | null | undefined) ??
          undefined,
        autoApprove:
          executionPolicy.autoApprove ??
          linkedCoworker?.autoApprove ??
          genRecord.conversation.autoApprove,
        allowedCustomIntegrations:
          executionPolicy.allowedCustomIntegrations ??
          linkedCoworker?.allowedCustomIntegrations ??
          undefined,
        remoteIntegrationSource: executionPolicy.remoteIntegrationSource,
        allowedExecutorSourceIds:
          executionPolicy.allowedExecutorSourceIds ??
          linkedCoworker?.allowedExecutorSourceIds ??
          undefined,
        allowedSkillSlugs:
          executionPolicy.allowedSkillSlugs ?? linkedCoworkerAllowedSkillSlugs ?? undefined,
        coworkerPrompt: undefined,
        coworkerPromptDo: undefined,
        coworkerPromptDont: undefined,
        triggerPayload: undefined,
        builderCoworkerContext,
        selectedPlatformSkillSlugs:
          executionPolicy.selectedPlatformSkillSlugs ??
          (linkedCoworkerPlatformSkillSlugs.length > 0
            ? linkedCoworkerPlatformSkillSlugs
            : undefined),
        userStagedFilePaths: new Set(),
        uploadedSandboxFileIds: new Set(),
        runtimeCallbackToken: runtimeRecord?.callbackToken ?? undefined,
        runtimeId: runtimeRecord?.id ?? genRecord.runtimeId ?? undefined,
        runtimeTurnSeq: pendingInterrupt?.turnSeq ?? runtimeRecord?.activeTurnSeq,
        sandboxId: runtimeRecord?.sandboxId ?? undefined,
        sessionId: runtimeRecord?.sessionId ?? undefined,
        agentInitStartedAt: undefined,
        agentInitReadyAt: undefined,
        agentInitFailedAt: undefined,
        phaseMarks: {},
        phaseTimeline: [],
        streamSequence: 0,
        streamPublishedCount: 0,
        streamDeliveredCount: 0,
      };
      ctx.currentInterruptId = pendingInterrupt?.id;

      logServerEvent(
        "info",
        "QUEUED_GENERATION_CONTEXT_REHYDRATED",
        {
          rehydratedAttachmentsCount: ctx.attachments?.length ?? 0,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );

      if (
        (ctx.status === "awaiting_approval" || ctx.status === "awaiting_auth") &&
        pendingInterrupt &&
        !ctx.resumeInterruptId
      ) {
        return;
      }

      this.activeGenerations.set(genRecord.id, ctx);
      this.markPhase(ctx, "generation_started");
      if (
        isRunExpired(
          {
            startedAt: ctx.startedAt,
            deadlineAt: ctx.deadlineAt,
          },
          new Date(),
        )
      ) {
        this.setCompletionReason(ctx, "run_deadline");
        ctx.errorMessage =
          "We stopped this run because it exceeded the 15 minute wall-clock limit.";
        await this.finishGeneration(ctx, "error");
        return;
      }
      if (ctx.status === "awaiting_approval" && pendingInterrupt?.expiresAt) {
        await this.enqueueGenerationTimeout(
          ctx.id,
          "approval",
          pendingInterrupt.expiresAt.toISOString(),
        );
      }
      if (ctx.status === "awaiting_auth" && pendingInterrupt?.expiresAt) {
        await this.enqueueGenerationTimeout(
          ctx.id,
          "auth",
          pendingInterrupt.expiresAt.toISOString(),
        );
      }
      if (
        ctx.status === "awaiting_approval" &&
        pendingInterrupt &&
        isApprovalExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          new Date(),
        )
      ) {
        await this.processGenerationTimeout(ctx.id, "approval");
        return;
      }
      if (
        ctx.status === "awaiting_auth" &&
        pendingInterrupt &&
        isAuthExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          new Date(),
        )
      ) {
        await this.processGenerationTimeout(ctx.id, "auth");
        return;
      }

      await this.runGeneration(ctx, runMode, leaseToken);
    } finally {
      await this.releaseGenerationLease(generationId, leaseToken).catch((err) => {
        console.error(
          `[GenerationManager] Failed to release queued-generation lease for ${generationId}:`,
          err,
        );
      });
    }
  }

  /**
   * Subscribe to a generation's events
   */
  async *subscribeToGeneration(
    generationId: string,
    userId: string,
    options?: { cursor?: string },
  ): AsyncGenerator<GenerationStreamEvent, void, unknown> {
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
          ...this.getStreamCountersSnapshot(),
          existingSubscriptionCount,
        },
        {
          source: "generation-manager",
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
    let cursor = options?.cursor ?? "0-0";
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
          // eslint-disable-next-line no-await-in-loop -- cooperative scheduling for fake-timer test runs
          await Promise.resolve();
        }

        let events: Awaited<ReturnType<typeof readGenerationStreamAfter>> = [];
        if (isTestRuntime) {
          events = [];
        } else {
          try {
            // eslint-disable-next-line no-await-in-loop -- blocking stream consumption is intentional
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
                error: formatErrorMessage(error),
                streamId,
                cursor,
                redisReadCount,
              },
              {
                source: "generation-manager",
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
            // eslint-disable-next-line no-await-in-loop -- recovery check is intentionally sequential
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

            const streamPresent = isTestRuntime
              ? false
              : // eslint-disable-next-line no-await-in-loop -- recovery check is intentionally sequential
                await generationStreamExists(generationId);
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
                const partEvent = this.emitReplayPartEvent(
                  latest.id,
                  latest.runtimeId ?? null,
                  latest.conversationId,
                  1,
                  latestParts[i],
                  latestParts,
                );
                if (partEvent) {
                  eventsYielded += 1;
                  yield partEvent;
                }
              }
              observedParts = latestParts;

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
                yield this.projectInterruptPendingEvent(pendingInterrupt);
              }
            }

            if (
              !streamPresent &&
              (latest.status === "completed" ||
                latest.status === "cancelled" ||
                latest.status === "error")
            ) {
              // eslint-disable-next-line no-await-in-loop -- terminal recovery is intentionally sequential
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
            source: "generation-manager",
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
          ...this.getStreamCountersSnapshot(),
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
          source: "generation-manager",
          generationId: initial.id,
          conversationId: initial.conversationId,
          userId,
        },
      );
    }
  }

  /**
   * Cancel a generation
   */
  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
      columns: {
        id: true,
        status: true,
      },
    });
    if (!genRecord) {
      return false;
    }

    if (genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }

    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return true;
    }

    await db
      .update(generation)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(generation.id, generationId));
    await getSandboxSlotManager().clearPendingRequest(generationId);

    const ctx = this.activeGenerations.get(generationId);
    if (ctx) {
      await this.releaseSandboxSlotLease(ctx);
      ctx.abortController.abort();
    }

    return true;
  }

  async resumeGeneration(generationId: string, userId: string): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (!genRecord.conversation.userId || genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return false;
    }

    let pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(generationId);
    if (pendingInterrupt) {
      pendingInterrupt =
        (await generationInterruptService.refreshInterruptExpiry(
          pendingInterrupt.id,
          new Date(
            pendingInterrupt.kind === "auth"
              ? computeExpiryIso(AUTH_TIMEOUT_MS)
              : computeExpiryIso(APPROVAL_TIMEOUT_MS),
          ),
        )) ?? pendingInterrupt;
    }
    const nextStatus: GenerationStatus = pendingInterrupt
      ? pendingInterrupt.kind === "auth"
        ? "awaiting_auth"
        : "awaiting_approval"
      : "running";
    let nextExecutionPolicy = this.getExecutionPolicyFromRecord(
      genRecord,
      genRecord.conversation.autoApprove,
    );
    if (genRecord.status === "paused") {
      nextExecutionPolicy = {
        ...nextExecutionPolicy,
        allowSnapshotRestoreOnRun: true,
      };
    }

    await db
      .update(generation)
      .set({
        status: nextStatus,
        isPaused: false,
        executionPolicy: nextExecutionPolicy,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({
        generationStatus:
          nextStatus === "running"
            ? "generating"
            : nextStatus === "awaiting_approval"
              ? "awaiting_approval"
              : "awaiting_auth",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, genRecord.conversationId));

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    if (linkedRun?.id) {
      await db
        .update(coworkerRun)
        .set({
          status:
            nextStatus === "running"
              ? "running"
              : nextStatus === "awaiting_approval"
                ? "awaiting_approval"
                : "awaiting_auth",
        })
        .where(eq(coworkerRun.id, linkedRun.id));
    }

    const runType: "chat" | "coworker" = linkedRun ? "coworker" : "chat";
    if (nextStatus === "awaiting_approval" && pendingInterrupt?.expiresAt) {
      await this.enqueueGenerationTimeout(
        generationId,
        "approval",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
    if (nextStatus === "awaiting_auth" && pendingInterrupt?.expiresAt) {
      await this.enqueueGenerationTimeout(
        generationId,
        "auth",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
    await this.enqueueGenerationRun(generationId, runType);
    return true;
  }

  async processGenerationTimeout(generationId: string, kind: GenerationTimeoutKind): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }

    const now = Date.now();
    if (kind === "approval") {
      const pendingInterrupt =
        await generationInterruptService.getPendingInterruptForGeneration(generationId);
      if (
        !pendingInterrupt ||
        pendingInterrupt.kind === "auth" ||
        genRecord.status !== "awaiting_approval"
      ) {
        return;
      }
      if (
        !isApprovalExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          new Date(now),
        )
      ) {
        return;
      }
      const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
        where: eq(coworkerRun.generationId, generationId),
        columns: { id: true },
      });
      const ctx = this.activeGenerations.get(generationId);
      if (ctx) {
        this.setCompletionReason(ctx, "approval_timeout");
        ctx.errorMessage = "Approval request expired before the run could continue.";
        await this.handleApprovalTimeout(ctx);
      } else {
        await generationInterruptService.resolveInterrupt({
          interruptId: pendingInterrupt.id,
          status: "expired",
        });
        await this.finalizeDetachedGenerationError({
          generationId,
          conversationId: genRecord.conversationId,
          runtimeId: genRecord.runtimeId ?? undefined,
          coworkerRunId: linkedCoworkerRun?.id,
          message: "Approval request expired before the run could continue.",
          completionReason: "approval_timeout",
        });
      }
      return;
    }

    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(generationId);
    if (
      !pendingInterrupt ||
      pendingInterrupt.kind !== "auth" ||
      genRecord.status !== "awaiting_auth"
    ) {
      return;
    }
    if (
      !isAuthExpired(
        {
          requestedAt: pendingInterrupt.requestedAt,
          expiresAt: pendingInterrupt.expiresAt,
        },
        new Date(now),
      )
    ) {
      return;
    }
    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    const ctx = this.activeGenerations.get(generationId);
    if (ctx) {
      this.setCompletionReason(ctx, "auth_timeout");
      ctx.errorMessage = "Authentication request expired before the run could continue.";
      await this.handleAuthTimeout(ctx);
    } else {
      await generationInterruptService.resolveInterrupt({
        interruptId: pendingInterrupt.id,
        status: "expired",
      });
      await this.finalizeDetachedGenerationError({
        generationId,
        conversationId: genRecord.conversationId,
        runtimeId: genRecord.runtimeId ?? undefined,
        coworkerRunId: linkedCoworkerRun?.id,
        message: "Authentication request expired before the run could continue.",
        completionReason: "auth_timeout",
      });
    }
  }

  async processPreparingStuckCheck(generationId: string): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: {
        conversation: {
          columns: {
            id: true,
            userId: true,
            type: true,
          },
        },
      },
    });
    if (!genRecord) {
      return;
    }
    if (genRecord.status !== "running" || genRecord.sandboxId || genRecord.completedAt) {
      return;
    }

    const elapsedMs = Date.now() - genRecord.startedAt.getTime();
    if (elapsedMs < AGENT_PREPARING_TIMEOUT_MS) {
      return;
    }

    const userId = genRecord.conversation.userId ?? undefined;
    const details = {
      generationId: genRecord.id,
      conversationId: genRecord.conversation.id,
      userId,
      elapsedMs,
      thresholdMs: AGENT_PREPARING_TIMEOUT_MS,
      status: genRecord.status,
    };

    logServerEvent("warn", "GENERATION_PREPARING_STUCK_DETECTED", details, {
      source: "generation-manager",
      generationId: genRecord.id,
      conversationId: genRecord.conversation.id,
      userId,
    });

    if (!this.activeGenerations.has(generationId)) {
      const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
        where: eq(coworkerRun.generationId, generationId),
        columns: { id: true },
      });
      await this.finalizeDetachedGenerationError({
        generationId: genRecord.id,
        conversationId: genRecord.conversation.id,
        runtimeId: genRecord.runtimeId ?? undefined,
        coworkerRunId: linkedCoworkerRun?.id,
        message: "Agent preparation timed out before the runtime became ready.",
        completionReason: "bootstrap_timeout",
      });
      return;
    }

    const pushUrl = process.env.KUMA_PUSH_URL?.trim();
    if (!pushUrl) {
      return;
    }

    const monitorUrl = new URL(pushUrl);
    monitorUrl.searchParams.set("status", "down");
    monitorUrl.searchParams.set(
      "msg",
      `preparing agent timeout generation=${genRecord.id} conversation=${genRecord.conversation.id} user=${userId ?? "unknown"} elapsedMs=${elapsedMs}`,
    );
    monitorUrl.searchParams.set("ping", String(Math.max(1, Math.round(elapsedMs))));

    try {
      const response = await fetch(monitorUrl.toString(), { method: "GET" });
      if (!response.ok) {
        throw new Error(`Kuma push failed (${response.status})`);
      }
      logServerEvent("warn", "GENERATION_PREPARING_STUCK_KUMA_PUSHED", details, {
        source: "generation-manager",
        generationId: genRecord.id,
        conversationId: genRecord.conversation.id,
        userId,
      });
    } catch (error) {
      logServerEvent(
        "error",
        "GENERATION_PREPARING_STUCK_KUMA_PUSH_FAILED",
        {
          ...details,
          error: formatErrorMessage(error),
        },
        {
          source: "generation-manager",
          generationId: genRecord.id,
          conversationId: genRecord.conversation.id,
          userId,
        },
      );
    }
  }

  async reapStaleGenerations(): Promise<{
    scanned: number;
    stale: number;
    finalizedRunningAsError: number;
    finalizedWaitingAsError: number;
  }> {
    const candidates = await db.query.generation.findMany({
      where: and(
        isNull(generation.completedAt),
        eq(generation.status, "running"),
        lt(
          generation.startedAt,
          new Date(
            Date.now() -
              Math.min(
                STALE_REAPER_RUNNING_MAX_AGE_MS,
                STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS,
                STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS,
              ),
          ),
        ),
      ),
      columns: {
        id: true,
        status: true,
        startedAt: true,
      },
    });

    const nowMs = Date.now();
    const staleRows = candidates.filter((row) => {
      if (row.status !== "running") {
        return false;
      }
      const ageMs = nowMs - row.startedAt.getTime();
      return ageMs > STALE_REAPER_RUNNING_MAX_AGE_MS;
    });

    if (staleRows.length === 0) {
      return {
        scanned: candidates.length,
        stale: 0,
        finalizedRunningAsError: 0,
        finalizedWaitingAsError: 0,
      };
    }

    const staleRunningIds = staleRows
      .filter((row) => row.status === "running")
      .map((row) => row.id);
    const staleApprovalIds = staleRows
      .filter((row) => row.status === "awaiting_approval")
      .map((row) => row.id);
    const staleAuthIds = staleRows
      .filter((row) => row.status === "awaiting_auth")
      .map((row) => row.id);
    const staleWaitingIds = [...staleApprovalIds, ...staleAuthIds];

    const completedAt = new Date();
    const staleRunningMessage =
      "Generation was marked as stale by the worker reaper after exceeding max running age.";
    const staleApprovalMessage = "Approval request expired before the run could continue.";
    const staleAuthMessage = "Authentication request expired before the run could continue.";

    if (staleRunningIds.length > 0) {
      await Promise.all(
        staleRunningIds.map((id) => generationInterruptService.cancelInterruptsForGeneration(id)),
      );
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: staleRunningMessage,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completedAt,
        })
        .where(inArray(generation.id, staleRunningIds));
    }

    if (staleWaitingIds.length > 0) {
      for (const id of staleWaitingIds) {
        const pendingInterrupt =
          await generationInterruptService.getPendingInterruptForGeneration(id);
        if (pendingInterrupt) {
          await generationInterruptService.resolveInterrupt({
            interruptId: pendingInterrupt.id,
            status: "expired",
          });
        }
      }
      await Promise.all(
        staleWaitingIds.map((id) => generationInterruptService.cancelInterruptsForGeneration(id)),
      );
    }

    if (staleApprovalIds.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: staleApprovalMessage,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completionReason: "approval_timeout",
          completedAt,
        })
        .where(inArray(generation.id, staleApprovalIds));
    }

    if (staleAuthIds.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: staleAuthMessage,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completionReason: "auth_timeout",
          completedAt,
        })
        .where(inArray(generation.id, staleAuthIds));
    }

    if (staleRunningIds.length > 0) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: completedAt,
          errorMessage: staleRunningMessage,
        })
        .where(inArray(coworkerRun.generationId, staleRunningIds));
      await db
        .update(conversation)
        .set({ generationStatus: "error" })
        .where(inArray(conversation.currentGenerationId, staleRunningIds));
    }

    if (staleApprovalIds.length > 0) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: completedAt,
          errorMessage: staleApprovalMessage,
        })
        .where(inArray(coworkerRun.generationId, staleApprovalIds));
      await db
        .update(conversation)
        .set({ generationStatus: "error" })
        .where(inArray(conversation.currentGenerationId, staleApprovalIds));
    }

    if (staleAuthIds.length > 0) {
      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: completedAt,
          errorMessage: staleAuthMessage,
        })
        .where(inArray(coworkerRun.generationId, staleAuthIds));
      await db
        .update(conversation)
        .set({ generationStatus: "error" })
        .where(inArray(conversation.currentGenerationId, staleAuthIds));
    }

    for (const row of staleRows) {
      const ctx = this.activeGenerations.get(row.id);
      if (ctx) {
        ctx.abortController.abort();
      }
      this.evictActiveGenerationContext(row.id);
    }

    return {
      scanned: candidates.length,
      stale: staleRows.length,
      finalizedRunningAsError: staleRunningIds.length,
      finalizedWaitingAsError: staleWaitingIds.length,
    };
  }

  private async refreshCancellationSignal(
    ctx: GenerationContext,
    options?: { force?: boolean },
  ): Promise<boolean> {
    if (ctx.abortController.signal.aborted) {
      return true;
    }

    const now = Date.now();
    if (
      !options?.force &&
      ctx.lastCancellationCheckAt &&
      now - ctx.lastCancellationCheckAt < CANCELLATION_POLL_INTERVAL_MS
    ) {
      return false;
    }
    ctx.lastCancellationCheckAt = now;

    const latest = await db.query.generation.findFirst({
      where: eq(generation.id, ctx.id),
      columns: {
        status: true,
        cancelRequestedAt: true,
      },
    });

    if (!latest) {
      return false;
    }

    if (latest.cancelRequestedAt || latest.status === "cancelled") {
      ctx.abortController.abort();
      return true;
    }

    return false;
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(
    generationId: string,
    toolUseId: string,
    decision: "approve" | "deny",
    userId: string,
    questionAnswers?: string[][],
  ): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }

    const interrupt = await generationInterruptService.findPendingInterruptByToolUseId({
      generationId,
      providerToolUseId: toolUseId,
    });
    if (!interrupt) {
      return false;
    }

    const normalizedQuestionAnswers =
      questionAnswers
        ?.map((answers) =>
          answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
        )
        .filter((answers) => answers.length > 0) ?? [];
    const approvalPart: ContentPart = {
      type: "approval",
      tool_use_id: interrupt.providerToolUseId,
      tool_name: interrupt.display.title,
      tool_input: interrupt.display.toolInput ?? {},
      integration: interrupt.display.integration ?? "cmdclaw",
      operation: interrupt.display.operation ?? "question",
      command: interrupt.display.command,
      status: decision === "approve" ? "approved" : "denied",
      question_answers:
        normalizedQuestionAnswers.length > 0
          ? normalizedQuestionAnswers
          : interrupt.responsePayload?.questionAnswers,
    };
    const baseContentParts = (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = [...baseContentParts];
    const existingApprovalIndex = nextContentParts.findIndex(
      (part): part is ContentPart & { type: "approval" } =>
        part.type === "approval" && part.tool_use_id === interrupt.providerToolUseId,
    );
    if (existingApprovalIndex >= 0) {
      nextContentParts[existingApprovalIndex] = approvalPart;
    } else {
      nextContentParts.push(approvalPart);
    }

    await db
      .update(generation)
      .set({
        contentParts: nextContentParts.length > 0 ? nextContentParts : null,
      })
      .where(eq(generation.id, generationId));
    await this.touchConversationLastUserVisibleAction(genRecord.conversationId);

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: interrupt.id,
      status: decision === "approve" ? "accepted" : "rejected",
      responsePayload:
        normalizedQuestionAnswers.length > 0
          ? { questionAnswers: normalizedQuestionAnswers }
          : undefined,
      resolvedByUserId: userId,
    });

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });

    const activeCtx = this.activeGenerations.get(generationId);
    if (activeCtx) {
      activeCtx.contentParts = nextContentParts;
      activeCtx.status = "running";
      if (activeCtx.currentInterruptId === interrupt.id) {
        activeCtx.currentInterruptId = undefined;
      }
      if (activeCtx.approvalParkTimeoutId) {
        clearTimeout(activeCtx.approvalParkTimeoutId);
        activeCtx.approvalParkTimeoutId = undefined;
      }
      if (resolvedInterrupt) {
        this.broadcast(activeCtx, this.projectInterruptResolvedEvent(resolvedInterrupt));
      }
    }

    if (genRecord.status === "paused") {
      return this.resumeGeneration(generationId, userId);
    }

    if (!activeCtx && resolvedInterrupt) {
      await this.enqueueResolvedInterruptResume({
        generationId,
        conversationId: genRecord.conversationId,
        interrupt: resolvedInterrupt,
        runType: linkedRun?.id ? "coworker" : "chat",
        coworkerRunId: linkedRun?.id,
        remainingRunMs: genRecord.remainingRunMs,
      });
      return true;
    }

    await db
      .update(generation)
      .set({
        status: "running",
        pendingApproval: null,
        pendingAuth: null,
        isPaused: false,
      })
      .where(eq(generation.id, generationId));
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, genRecord.conversationId));
    if (linkedRun?.id) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, linkedRun.id));
    }

    return true;
  }

  async submitApprovalByInterrupt(
    interruptId: string,
    decision: "approve" | "deny",
    userId: string,
    questionAnswers?: string[][],
  ): Promise<boolean> {
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    if (!interrupt || interrupt.kind === "auth" || interrupt.status !== "pending") {
      return false;
    }

    return this.submitApproval(
      interrupt.generationId,
      interrupt.providerToolUseId,
      decision,
      userId,
      questionAnswers,
    );
  }

  async getAllowedIntegrationsForGeneration(
    generationId: string,
  ): Promise<IntegrationType[] | null> {
    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { coworkerId: true },
    });
    if (!linkedRun) {
      return null;
    }

    const wf = await db.query.coworker.findFirst({
      where: eq(coworker.id, linkedRun.coworkerId),
      columns: { allowedIntegrations: true },
    });

    return (wf?.allowedIntegrations as IntegrationType[] | undefined) ?? null;
  }

  /**
   * Get generation status
   */
  async getGenerationStatus(generationId: string): Promise<{
    status: GenerationStatus;
    contentParts: ContentPart[];
    pendingApproval: PendingApproval | null;
    usage: { inputTokens: number; outputTokens: number };
  } | null> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });

    if (!genRecord) {
      return null;
    }

    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(generationId);
    const pendingApproval =
      pendingInterrupt && pendingInterrupt.kind !== "auth"
        ? {
            toolUseId: pendingInterrupt.providerToolUseId,
            toolName: pendingInterrupt.display.title,
            toolInput: pendingInterrupt.display.toolInput ?? {},
            requestedAt: pendingInterrupt.requestedAt.toISOString(),
            expiresAt: pendingInterrupt.expiresAt?.toISOString(),
            integration: pendingInterrupt.display.integration ?? "cmdclaw",
            operation: pendingInterrupt.display.operation ?? "unknown",
            command: pendingInterrupt.display.command,
          }
        : null;

    return {
      status: genRecord.status as GenerationStatus,
      contentParts: genRecord.contentParts ?? [],
      pendingApproval,
      usage: {
        inputTokens: genRecord.inputTokens,
        outputTokens: genRecord.outputTokens,
      },
    };
  }

  private async getTerminalRecoveryEvent(
    genRecord: typeof generation.$inferSelect & {
      conversation?: typeof conversation.$inferSelect;
    },
    options?: { includeCursor?: boolean },
  ): Promise<GenerationStreamEvent | null> {
    const includeCursor = options?.includeCursor ?? true;
    const latestCursor = includeCursor ? await getLatestGenerationStreamCursor(genRecord.id) : null;
    if (genRecord.status === "completed" && genRecord.messageId) {
      const artifacts = await getDoneArtifacts(genRecord.messageId);
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

  private getReplayToolUseMetadata(
    part: Extract<ContentPart, { type: "tool_use" }>,
  ): ToolUseMetadata {
    if (part.integration || part.operation) {
      return {
        integration: part.integration,
        operation: part.operation,
      };
    }
    const parsed = this.getToolUseMetadata(part.name, part.input);
    if (!parsed.integration && !parsed.operation) {
      return {};
    }
    return parsed;
  }

  private emitReplayPartEvent(
    generationId: string,
    runtimeId: string | null,
    conversationId: string,
    turnSeq: number,
    part: ContentPart,
    allParts: ContentPart[],
  ): GenerationStreamEvent | null {
    if (part.type === "text") {
      return { type: "text", content: part.text };
    }
    if (part.type === "tool_use") {
      const metadata = this.getReplayToolUseMetadata(part);
      const event: GenerationStreamEvent = {
        type: "tool_use",
        toolName: part.name,
        toolInput: part.input,
        toolUseId: part.id,
      };
      if (metadata.integration !== undefined) {
        event.integration = metadata.integration;
      }
      if (metadata.operation !== undefined) {
        event.operation = metadata.operation;
      }
      if (metadata.isWrite !== undefined) {
        event.isWrite = metadata.isWrite;
      }
      return event;
    }
    if (part.type === "tool_result") {
      const toolUse = allParts.find(
        (p): p is ContentPart & { type: "tool_use" } =>
          p.type === "tool_use" && p.id === part.tool_use_id,
      );
      return {
        type: "tool_result",
        toolName: toolUse?.name ?? "unknown",
        result: part.content,
        toolUseId: part.tool_use_id,
      };
    }
    if (part.type === "thinking") {
      return {
        type: "thinking",
        content: part.content,
        thinkingId: part.id,
      };
    }
    if (part.type === "approval") {
      return {
        type: "interrupt_resolved",
        interruptId: `approval-part:${generationId}:${part.tool_use_id}`,
        generationId,
        runtimeId: runtimeId ?? generationId,
        conversationId,
        turnSeq,
        kind:
          part.operation === "question" || (part.question_answers?.length ?? 0) > 0
            ? "runtime_question"
            : "plugin_write",
        status: part.status === "approved" ? "accepted" : "rejected",
        providerToolUseId: part.tool_use_id,
        display: {
          title: part.tool_name,
          integration: part.integration,
          operation: part.operation,
          command: part.command,
          toolInput:
            part.tool_input && typeof part.tool_input === "object"
              ? (part.tool_input as Record<string, unknown>)
              : undefined,
        },
        responsePayload: part.question_answers
          ? { questionAnswers: part.question_answers }
          : undefined,
      };
    }
    return null;
  }

  // ========== Private Methods ==========

  /**
   * Dispatch generation to the appropriate backend.
   */
  private async runGeneration(
    ctx: GenerationContext,
    runMode: GenerationRunMode = "normal_run",
    leaseTokenOverride?: string | null,
  ): Promise<void> {
    const ownsLease = !leaseTokenOverride;
    let leaseToken: string | null = leaseTokenOverride ?? null;
    if (!leaseToken) {
      try {
        leaseToken = await this.acquireGenerationLease(ctx.id);
      } catch (error) {
        ctx.errorMessage = error instanceof Error ? error.message : String(error);
        await this.finishGeneration(ctx, "error");
        return;
      }
      if (!leaseToken) {
        return;
      }
    }

    const leaseRenewTimer = setInterval(() => {
      void this.renewGenerationLease(ctx.id, leaseToken).catch((err) => {
        console.error(`[GenerationManager] Failed to renew lease for generation ${ctx.id}:`, err);
      });
    }, 30_000);

    try {
      const latestGenerationState = await db.query.generation.findFirst({
        where: eq(generation.id, ctx.id),
        columns: {
          status: true,
          messageId: true,
          completedAt: true,
        },
      });
      if (latestGenerationState) {
        if (
          latestGenerationState.completedAt ||
          latestGenerationState.messageId ||
          latestGenerationState.status === "completed" ||
          latestGenerationState.status === "cancelled" ||
          latestGenerationState.status === "error"
        ) {
          return;
        }
      }
      await this.hydrateStreamSequence(ctx);
      if (
        !ctx.resumeInterruptId &&
        isRunExpired(
          {
            startedAt: ctx.startedAt,
            deadlineAt: ctx.deadlineAt,
          },
          new Date(),
        )
      ) {
        this.setCompletionReason(ctx, "run_deadline");
        ctx.errorMessage =
          "We stopped this run because it exceeded the 15 minute wall-clock limit.";
        await this.finishGeneration(ctx, "error");
        return;
      }
      const trimmed = ctx.userMessageContent.trim();
      if (SESSION_RESET_COMMANDS.has(trimmed)) {
        await this.handleSessionReset(ctx);
        return;
      }
      if (await this.refreshCancellationSignal(ctx, { force: true })) {
        await this.finishGeneration(ctx, "cancelled");
        return;
      }
      const slotStatus = await this.waitForSandboxSlotLease(ctx, {
        allowWorkerRequeue: true,
        runMode,
      });
      if (slotStatus === "requeued") {
        return;
      }
      if (ctx.resumeInterruptId) {
        return this.runSuspendedInterruptResume(ctx);
      }
      return runMode === "recovery_reattach"
        ? this.runRecoveryReattach(ctx)
        : this.runOpenCodeGeneration(ctx);
    } finally {
      clearInterval(leaseRenewTimer);
      await this.releaseSandboxSlotLease(ctx).catch((err) => {
        console.error(
          `[GenerationManager] Failed to release sandbox slot for generation ${ctx.id}:`,
          err,
        );
      });
      if (ownsLease && leaseToken) {
        await this.releaseGenerationLease(ctx.id, leaseToken).catch((err) => {
          console.error(
            `[GenerationManager] Failed to release lease for generation ${ctx.id}:`,
            err,
          );
        });
      }
    }
  }

  private async hydrateStreamSequence(ctx: GenerationContext): Promise<void> {
    try {
      const latest = await getLatestGenerationStreamEnvelope(ctx.id);
      if (!latest) {
        return;
      }
      ctx.streamSequence = Math.max(ctx.streamSequence, latest.envelope.sequence);
      ctx.streamLastCursor = latest.cursor;
    } catch (error) {
      logServerEvent(
        "warn",
        "GENERATION_STREAM_SEQUENCE_HYDRATE_FAILED",
        {
          error: formatErrorMessage(error),
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
    }
  }

  private async handleSessionReset(ctx: GenerationContext): Promise<void> {
    try {
      await writeSessionTranscriptFromConversation({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        source: "manual_reset",
        messageLimit: 15,
        excludeUserMessages: Array.from(SESSION_RESET_COMMANDS),
      });
    } catch (err) {
      console.error("[GenerationManager] Failed to write session transcript:", err);
    }

    try {
      await clearConversationSessionSnapshot(ctx.conversationId);
    } catch (err) {
      console.error("[GenerationManager] Failed to clear session snapshot:", err);
    }

    await db.insert(message).values({
      conversationId: ctx.conversationId,
      role: "system",
      content: `${SESSION_BOUNDARY_PREFIX}\n${new Date().toISOString()}`,
    });

    if (ctx.runtimeId) {
      await conversationRuntimeService.updateRuntimeSession({
        runtimeId: ctx.runtimeId,
        sessionId: null,
        sandboxId: ctx.sandboxId ?? null,
      });
    }

    ctx.sessionId = undefined;

    ctx.assistantContent = "Started a new session.";
    ctx.contentParts = [{ type: "text", text: ctx.assistantContent }];

    await this.finishGeneration(ctx, "completed");
  }

  private createSandboxBackend(
    runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"],
  ): SandboxBackend {
    return {
      setup: async () => undefined,
      execute: async (command, opts) => {
        const result = await runtimeSandbox.exec(command, {
          timeoutMs: opts?.timeout,
          env: opts?.env,
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      },
      writeFile: async (filePath, content) => {
        if (typeof content === "string") {
          await runtimeSandbox.writeFile(filePath, content);
          return;
        }
        const buffer = Buffer.from(content);
        await runtimeSandbox.writeFile(
          filePath,
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer,
        );
      },
      readFile: async (filePath) => runtimeSandbox.readFile(filePath),
      teardown: async () => {
        await runtimeSandbox.teardown?.();
      },
      isAvailable: () => true,
    };
  }

  private async bindRuntimeSandboxToContext(
    ctx: GenerationContext,
    params: {
      runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"];
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
    },
  ): Promise<void> {
    ctx.sandboxId = params.runtimeSandbox.sandboxId;

    await db
      .update(generation)
      .set({ sandboxId: params.runtimeSandbox.sandboxId })
      .where(eq(generation.id, ctx.id));

    if (ctx.runtimeId) {
      await conversationRuntimeService.updateRuntimeSession({
        runtimeId: ctx.runtimeId,
        sandboxId: ctx.sandboxId ?? null,
        sessionId: ctx.sessionId ?? null,
        sandboxProvider: params.runtimeMetadata?.sandboxProvider,
        runtimeHarness: params.runtimeMetadata?.runtimeHarness,
        runtimeProtocolVersion: params.runtimeMetadata?.runtimeProtocolVersion,
        status: "active",
      });
    }

    ctx.sandbox = this.createSandboxBackend(params.runtimeSandbox);
  }

  private async bindRuntimeSessionToContext(
    ctx: GenerationContext,
    params: {
      runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"];
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
      sessionId: string;
    },
  ): Promise<void> {
    ctx.sessionId = params.sessionId;
    await this.bindRuntimeSandboxToContext(ctx, params);
  }

  private async persistRuntimeSessionBinding(
    ctx: GenerationContext,
    params: {
      runtimeMetadata?: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"];
      sessionId: string;
    },
  ): Promise<void> {
    ctx.sessionId = params.sessionId;

    if (!ctx.runtimeId) {
      return;
    }

    await conversationRuntimeService.updateRuntimeSession({
      runtimeId: ctx.runtimeId,
      sandboxId: ctx.sandboxId ?? null,
      sessionId: params.sessionId,
      sandboxProvider: params.runtimeMetadata?.sandboxProvider,
      runtimeHarness: params.runtimeMetadata?.runtimeHarness,
      runtimeProtocolVersion: params.runtimeMetadata?.runtimeProtocolVersion,
      status: "active",
    });
  }

  private appendInjectedToolResult(
    ctx: GenerationContext,
    params: {
      toolUseId: string;
      toolName: string;
      result: unknown;
    },
  ): void {
    const existingToolResult = ctx.contentParts.some(
      (part): part is ContentPart & { type: "tool_result" } =>
        part.type === "tool_result" && part.tool_use_id === params.toolUseId,
    );
    if (existingToolResult) {
      return;
    }

    const result = limitToolResultContent(params.result);
    this.broadcast(ctx, {
      type: "tool_result",
      toolName: params.toolName,
      result,
      toolUseId: params.toolUseId,
    });
    ctx.contentParts.push({
      type: "tool_result",
      tool_use_id: params.toolUseId,
      content: result,
    });
  }

  private async updateOpenCodeToolPart(
    runtimeClient: RuntimeHarnessClient,
    runtimeTool: OpenCodeRuntimeToolRef,
    state:
      | { status: "completed"; input: Record<string, unknown>; output: string }
      | { status: "error"; input: Record<string, unknown>; error: string },
  ): Promise<void> {
    const now = Date.now();
    if (!runtimeTool.sessionId) {
      throw new Error("OpenCode tool part update failed: saved session id is missing");
    }
    const part = {
      type: "tool",
      id: runtimeTool.partId,
      sessionID: runtimeTool.sessionId,
      messageID: runtimeTool.messageId,
      callID: runtimeTool.callId,
      tool: runtimeTool.toolName,
      state:
        state.status === "completed"
          ? {
              status: "completed",
              input: state.input,
              output: state.output,
              title: runtimeTool.toolName,
              metadata: {},
              time: { start: now, end: now },
            }
          : {
              status: "error",
              input: state.input,
              error: state.error,
              metadata: {},
              time: { start: now, end: now },
            },
    };
    const result = await runtimeClient.updatePart({
      sessionID: runtimeTool.sessionId,
      messageID: runtimeTool.messageId,
      partID: runtimeTool.partId,
      part,
    });
    if (result.error) {
      throw new Error(`OpenCode tool part update failed: ${formatErrorMessage(result.error)}`);
    }
  }

  private async executeApprovedPluginWriteCommand(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<
    | { status: "completed"; output: string }
    | { status: "error"; error: string; outputForStream: unknown }
  > {
    if (interrupt.status !== "accepted") {
      const error = "User denied this integration write.";
      return { status: "error", error, outputForStream: { error } };
    }
    if (!ctx.sandbox) {
      const error =
        "Approved integration write could not run because the sandbox was not attached.";
      return { status: "error", error, outputForStream: { error } };
    }

    const command = interrupt.display.command;
    if (!command) {
      const error =
        "Approved integration write could not run because the saved command is missing.";
      return { status: "error", error, outputForStream: { error } };
    }
    const toolInput =
      interrupt.display.toolInput && typeof interrupt.display.toolInput === "object"
        ? (interrupt.display.toolInput as Record<string, unknown>)
        : {};
    const workdir = typeof toolInput.workdir === "string" ? toolInput.workdir : undefined;
    const result = await ctx.sandbox.execute(buildRuntimeEnvSourcedCommand({ command, workdir }), {
      timeout: 120_000,
    });
    if (result.exitCode !== 0) {
      const errorText =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Approved command exited with status ${result.exitCode}`;
      return {
        status: "error",
        error: errorText,
        outputForStream: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    }

    return {
      status: "completed",
      output: result.stdout,
    };
  }

  private async injectParkedPluginWriteResult(
    ctx: GenerationContext,
    params: {
      runtimeClient: RuntimeHarnessClient;
      interrupt: GenerationInterruptRecord;
      runtimeTool: OpenCodeRuntimeToolRef;
      execution:
        | { status: "completed"; output: string }
        | { status: "error"; error: string; outputForStream: unknown };
    },
  ): Promise<void> {
    const toolInput =
      params.interrupt.display.toolInput && typeof params.interrupt.display.toolInput === "object"
        ? (params.interrupt.display.toolInput as Record<string, unknown>)
        : params.runtimeTool.input;

    if (params.execution.status === "completed") {
      await this.updateOpenCodeToolPart(params.runtimeClient, params.runtimeTool, {
        status: "completed",
        input: toolInput,
        output: params.execution.output,
      });
      this.appendInjectedToolResult(ctx, {
        toolUseId: params.runtimeTool.callId,
        toolName: params.runtimeTool.toolName,
        result: params.execution.output,
      });
    } else {
      await this.updateOpenCodeToolPart(params.runtimeClient, params.runtimeTool, {
        status: "error",
        input: toolInput,
        error: params.execution.error,
      });
      this.appendInjectedToolResult(ctx, {
        toolUseId: params.runtimeTool.callId,
        toolName: params.runtimeTool.toolName,
        result: params.execution.outputForStream,
      });
    }

    await this.saveProgress(ctx);
    await generationInterruptService.markInterruptApplied(params.interrupt.id);
  }

  private async runParkedPluginWriteResume(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<void> {
    const runtimeTool = interrupt.display.runtimeTool;
    if (!runtimeTool?.messageId || !runtimeTool.partId || !runtimeTool.callId) {
      this.setCompletionReason(ctx, "broken_runtime_state");
      ctx.errorMessage =
        "The approved integration write could not be resumed because its runtime tool identity was not saved.";
      await this.finishGeneration(ctx, "error");
      return;
    }

    let commandExecution:
      | { status: "completed"; output: string }
      | { status: "error"; error: string; outputForStream: unknown }
      | null = null;

    await this.runRecoveryReattach(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      modeLabel: "resume_plugin_write",
      onRuntimeAttached: async (runtimeClient) => {
        commandExecution = await this.executeApprovedPluginWriteCommand(ctx, interrupt);
        await this.injectParkedPluginWriteResult(ctx, {
          runtimeClient,
          interrupt,
          runtimeTool,
          execution: commandExecution,
        });
        return [
          {
            type: "text",
            text: "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
          },
        ];
      },
    });
  }

  private buildResumedAuthContinuationPrompt(
    interrupt: GenerationInterruptRecord,
  ): RuntimePromptPart[] {
    const integration = interrupt.display.authSpec?.integrations?.[0] ?? "the required";
    return [
      {
        type: "text",
        text: `Continue the interrupted assistant turn. Authentication for ${integration} is now complete.`,
      },
    ];
  }

  private buildResumedRuntimeQuestionContinuationPrompt(
    interrupt: GenerationInterruptRecord,
  ): RuntimePromptPart[] {
    const flattenedAnswers =
      interrupt.responsePayload?.questionAnswers?.flatMap((answers) =>
        answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
      ) ?? [];
    const answerSummary =
      flattenedAnswers.length > 0
        ? ` The resolved answer was: ${flattenedAnswers.join(", ")}.`
        : "";
    return [
      {
        type: "text",
        text: `Continue the interrupted assistant turn. The pending question has been answered.${answerSummary}`,
      },
    ];
  }

  private buildPromptSpecInputForContext(
    ctx: GenerationContext,
    shared: {
      cliInstructions?: string | null;
      executorInstructions?: string | null;
      skillsInstructions?: string | null;
      integrationSkillsInstructions?: string | null;
      memoryInstructions?: string | null;
      userTimezone?: string | null;
    },
  ): OpencodePromptCompositionInput {
    const base = {
      ...shared,
      selectedPlatformSkillSlugs: ctx.selectedPlatformSkillSlugs,
    };
    if (ctx.coworkerRunId) {
      return {
        kind: "coworker_runner",
        ...base,
        coworkerPrompt: ctx.coworkerPrompt,
        coworkerPromptDo: ctx.coworkerPromptDo,
        coworkerPromptDont: ctx.coworkerPromptDont,
        triggerPayload: ctx.triggerPayload,
      };
    }
    if (ctx.builderCoworkerContext) {
      return {
        kind: "coworker_builder",
        ...base,
        builderCoworkerContext: ctx.builderCoworkerContext,
      };
    }
    return {
      kind: "chat",
      ...base,
    };
  }

  private async composeContinuationPromptSpec(ctx: GenerationContext): Promise<ResolvedPromptSpec> {
    const dbUser = await db.query.user.findFirst({
      where: eq(user.id, ctx.userId),
      columns: { timezone: true },
    });
    return composeOpencodePromptSpec(
      this.buildPromptSpecInputForContext(ctx, {
        cliInstructions: "",
        executorInstructions: null,
        skillsInstructions: "",
        integrationSkillsInstructions: "",
        memoryInstructions: buildMemorySystemPrompt(),
        userTimezone: dbUser?.timezone ?? null,
      }),
    );
  }

  private async runSuspendedInterruptResume(ctx: GenerationContext): Promise<void> {
    const interruptId = ctx.resumeInterruptId;
    if (!interruptId) {
      await this.runOpenCodeGeneration(ctx);
      return;
    }
    const interrupt = await generationInterruptService.getInterrupt(interruptId);

    this.resumeDeadlineFromRemainingBudget(ctx);
    ctx.status = "running";
    ctx.suspendedAt = null;
    const shouldResumeOpenCodeInterrupt = interrupt?.provider === "opencode";
    if (!shouldResumeOpenCodeInterrupt) {
      ctx.resumeInterruptId = null;
    }
    await db
      .update(generation)
      .set({
        status: "running",
        deadlineAt: ctx.deadlineAt,
        suspendedAt: null,
        resumeInterruptId: shouldResumeOpenCodeInterrupt ? ctx.resumeInterruptId : null,
      })
      .where(eq(generation.id, ctx.id));

    if (!shouldResumeOpenCodeInterrupt) {
      if (interrupt?.kind === "plugin_write") {
        await this.runParkedPluginWriteResume(ctx, interrupt);
        return;
      }
      await this.runRecoveryReattach(ctx, {
        allowSnapshotRestore: true,
        requireLiveSession: false,
        resumeInterruptId: interruptId,
        modeLabel: "resume_interrupt",
        onRuntimeAttached:
          interrupt?.kind === "auth"
            ? async () => this.buildResumedAuthContinuationPrompt(interrupt)
            : undefined,
      });
      return;
    }

    await this.runRecoveryReattach(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      resumeInterruptId: interruptId,
      modeLabel: "resume_interrupt",
      onRuntimeAttached:
        interrupt?.kind === "runtime_question"
          ? async () => this.buildResumedRuntimeQuestionContinuationPrompt(interrupt)
          : undefined,
    });
  }

  /**
   * Original E2B/OpenCode generation flow. Delegates everything to OpenCode inside E2B sandbox.
   */
  private async runRecoveryReattach(
    ctx: GenerationContext,
    options?: {
      allowSnapshotRestore?: boolean;
      requireLiveSession?: boolean;
      resumeInterruptId?: string;
      modeLabel?: string;
      onRuntimeAttached?: (
        runtimeClient: RuntimeHarnessClient,
      ) => Promise<RuntimePromptPart[] | void>;
      completeAfterRuntimeAttached?: boolean;
      skipUsageCaptureAfterRuntimeAttached?: boolean;
    },
  ): Promise<void> {
    const requireLiveSession = options?.requireLiveSession ?? true;
    const modeLabel = options?.modeLabel ?? "recovery_reattach";
    let reattachTimeoutTriggered = false;
    let clearReattachTimeout: (() => void) | undefined;
    let runtimeClient: RuntimeHarnessClient | undefined;

    try {
      if (await this.refreshCancellationSignal(ctx, { force: true })) {
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      if (requireLiveSession && !ctx.sessionId) {
        this.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because the session ID was missing.";
        await this.finishGeneration(ctx, "error");
        return;
      }

      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });

      const session = await withTimeout(
        getOrCreateConversationRuntime(
          {
            conversationId: ctx.conversationId,
            generationId: ctx.id,
            userId: ctx.userId,
            model: ctx.model,
            openAIAuthSource: ctx.authSource,
            anthropicApiKey: env.ANTHROPIC_API_KEY || "",
            integrationEnvs: {},
          },
          {
            sandboxProviderOverride: ctx.sandboxProviderOverride,
            title: conv?.title || "Conversation",
            replayHistory: false,
            allowSnapshotRestore: options?.allowSnapshotRestore ?? false,
            telemetry: {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
            },
          },
        ),
        AGENT_PREPARING_TIMEOUT_MS,
        `Agent preparation timed out after ${Math.round(AGENT_PREPARING_TIMEOUT_MS / 1000)} seconds.`,
      );

      runtimeClient = session.harnessClient;

      if (session.sessionSource === "created_session") {
        this.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage = requireLiveSession
          ? "The live runtime could not be reattached because the original sandbox was no longer available."
          : "The suspended runtime could not be resumed because no session snapshot was restored.";
        await this.finishGeneration(ctx, "error");
        return;
      }

      if (requireLiveSession && session.sessionSource !== "live_session") {
        this.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because only a snapshot restore was available.";
        await this.finishGeneration(ctx, "error");
        return;
      }

      if (ctx.sessionId && session.session.id !== ctx.sessionId) {
        this.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The live runtime could not be reattached because the session no longer matched the active generation.";
        await this.finishGeneration(ctx, "error");
        return;
      }

      await this.bindRuntimeSessionToContext(ctx, {
        runtimeSandbox: session.sandbox,
        runtimeMetadata: session.metadata,
        sessionId: session.session.id,
      });
      this.broadcast(ctx, {
        type: "status_change",
        status: `${modeLabel}_attached`,
        metadata: {
          runtimeId: ctx.runtimeId,
          sandboxProvider: session.metadata.sandboxProvider,
          runtimeHarness: session.metadata.runtimeHarness,
          runtimeProtocolVersion: session.metadata.runtimeProtocolVersion,
          sandboxId: session.sandbox.sandboxId,
          sessionId: session.session.id,
        },
      });
      if (ctx.runtimeId && ctx.runtimeCallbackToken && ctx.runtimeTurnSeq) {
        await writeRuntimeContextToSandbox(session.sandbox, {
          runtimeId: ctx.runtimeId,
          turnSeq: ctx.runtimeTurnSeq,
          callbackToken: ctx.runtimeCallbackToken,
          updatedAt: new Date().toISOString(),
        });
      }
      await writeRuntimeEnvToSandbox(
        session.sandbox,
        await this.resolveSandboxRuntimeEnvForContext(ctx),
      );
      if (options?.resumeInterruptId) {
        await this.applyResolvedInterruptToRuntime(ctx, options.resumeInterruptId, runtimeClient);
      }
      const continuationPromptParts = await options?.onRuntimeAttached?.(runtimeClient);
      await this.setSnapshotRestoreAllowance(ctx, false);

      if (options?.completeAfterRuntimeAttached) {
        if (!options.skipUsageCaptureAfterRuntimeAttached) {
          await this.captureUsageFromRuntimeSession(ctx, runtimeClient, session.session.id);
        }
        await this.finishGeneration(ctx, "completed");
        return;
      }

      const remainingRunTimeMs = this.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }

      const subscribeController = new AbortController();
      const eventResult = await runtimeClient.subscribe(
        {},
        {
          signal: subscribeController.signal,
        },
      );
      const eventStream = eventResult.stream;
      const parsedModel = parseModelReference(ctx.model);
      const modelConfig = {
        providerID: parsedModel.providerID,
        modelID: parsedModel.modelID,
      };
      const continuationPromptSpec =
        continuationPromptParts && continuationPromptParts.length > 0
          ? await this.composeContinuationPromptSpec(ctx)
          : null;
      const continuationPromptPromise =
        continuationPromptParts && continuationPromptParts.length > 0 && ctx.sessionId
          ? runtimeClient
              .prompt({
                sessionID: ctx.sessionId,
                parts: continuationPromptParts,
                agent: continuationPromptSpec?.agentId,
                system: continuationPromptSpec?.systemPrompt,
                model: modelConfig,
              })
              .then(
                () => ({ ok: true as const }),
                (error) => ({ ok: false as const, error }),
              )
          : Promise.resolve({ ok: true as const });
      let currentTextPart: { type: "text"; text: string } | null = null;
      let currentTextPartId: string | null = null;
      let opencodeEventCount = 0;
      let opencodeToolCallCount = 0;
      let opencodePermissionCount = 0;
      let opencodeQuestionCount = 0;
      let sawSessionIdle = false;

      const reattachTimeoutId = setTimeout(() => {
        reattachTimeoutTriggered = true;
        subscribeController.abort();
      }, remainingRunTimeMs);
      clearReattachTimeout = () => {
        clearTimeout(reattachTimeoutId);
        clearReattachTimeout = undefined;
      };

      for await (const rawEvent of eventStream) {
        if (!ctx.phaseMarks?.first_event_received) {
          this.markPhase(ctx, "first_event_received");
        }
        const event = rawEvent as RuntimeEvent;
        this.markRuntimeActivity(ctx);
        if (await this.refreshCancellationSignal(ctx)) {
          break;
        }

        opencodeEventCount += 1;

        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          if (part.type === "tool" && part.state.status === "pending") {
            opencodeToolCallCount += 1;
          }
        }

        if (
          event.type === "server.connected" ||
          event.type === "session.error" ||
          event.type === "session.idle"
        ) {
          console.info(
            `[OpenCode][EVENT] type=${event.type} generationId=${ctx.id} conversationId=${ctx.conversationId} mode=recovery_reattach`,
          );
        }

        if (isOpenCodeTrackedEvent(event)) {
          await this.processOpencodeEvent(
            ctx,
            event,
            currentTextPart,
            currentTextPartId,
            (part, partId) => {
              currentTextPart = part;
              currentTextPartId = partId;
            },
          );
        }

        if (isOpenCodeActionableEvent(event)) {
          const actionableResult = await this.handleOpenCodeActionableEvent(
            ctx,
            runtimeClient,
            event,
          );
          if (actionableResult.type === "permission") {
            opencodePermissionCount += 1;
          } else if (actionableResult.type === "question") {
            opencodeQuestionCount += 1;
          }
        }

        if (event.type === "session.idle") {
          sawSessionIdle = true;
          break;
        }

        if (event.type === "session.error") {
          const eventProps =
            typeof event.properties === "object" && event.properties !== null
              ? (event.properties as Record<string, unknown>)
              : {};
          const error = eventProps.error ?? "Unknown error";
          const errorObj =
            typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
          const nestedData =
            errorObj && typeof errorObj.data === "object" && errorObj.data !== null
              ? (errorObj.data as Record<string, unknown>)
              : null;
          const errorMessage =
            typeof error === "string"
              ? error
              : typeof nestedData?.message === "string"
                ? nestedData.message
                : typeof errorObj?.message === "string"
                  ? errorObj.message
                  : JSON.stringify(error);
          throw new Error(errorMessage);
        }
      }

      const continuationPromptOutcome = await this.awaitPromiseUntilRunDeadline(
        ctx,
        continuationPromptPromise,
      );
      clearReattachTimeout?.();
      if (reattachTimeoutTriggered || continuationPromptOutcome.type === "timed_out") {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const continuationPromptResult = continuationPromptOutcome.value;
      if (!continuationPromptResult.ok) {
        throw continuationPromptResult.error;
      }

      if (!sawSessionIdle && !ctx.abortController.signal.aborted) {
        throw new Error(
          "Live recovery reattach ended before the runtime reached a terminal state.",
        );
      }

      await this.captureUsageFromRuntimeSession(ctx, runtimeClient, session.session.id);

      if (ctx.sandbox) {
        try {
          await this.importIntegrationSkillDraftsFromSandbox(ctx, ctx.sandbox);
        } catch (error) {
          console.error("[GenerationManager] Failed to import integration skill drafts:", error);
        }
      }

      if (ctx.abortController.signal.aborted) {
        if (ctx.abortForInterruptPark) {
          return;
        }
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} mode=${modeLabel} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount}`,
        );
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} mode=${modeLabel} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount}`,
      );
      await this.finishGeneration(ctx, "completed");
    } catch (error) {
      clearReattachTimeout?.();
      if (reattachTimeoutTriggered) {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      if (error instanceof GenerationSuspendedError) {
        logServerEvent(
          "info",
          "GENERATION_SUSPENDED_FOR_INTERRUPT",
          {
            interruptId: error.interruptId,
            interruptKind: error.kind,
            remainingRunMs: ctx.remainingRunMs,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        return;
      }
      console.error("[GenerationManager] Recovery reattach error:", error);
      const runtimeFailure = await this.resolveRuntimeFailure(ctx, runtimeClient);
      this.captureOriginalError(ctx, error, { runtimeFailure });
      if (runtimeFailure === "waiting_approval" || runtimeFailure === "waiting_auth") {
        return;
      }
      if (runtimeFailure === "sandbox_missing") {
        this.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage =
          "The sandbox stopped while this run was still active. Retry the task to continue.";
      } else if (runtimeFailure === "broken_runtime_state") {
        this.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The runtime ended in a non-terminal state and could not be recovered. Retry the task to continue.";
      } else if (runtimeFailure === "terminal_failed") {
        this.setCompletionReason(ctx, "runtime_error");
      } else if (runtimeFailure === "terminal_completed") {
        this.setCompletionReason(ctx, "completed");
      } else if (!ctx.completionReason) {
        this.setCompletionReason(ctx, "infra_disconnect");
      }
      if (!ctx.errorMessage && runtimeFailure !== "terminal_completed") {
        ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      }
      if (runtimeFailure === "terminal_completed") {
        if (runtimeClient && ctx.sessionId) {
          await this.captureUsageFromRuntimeSession(ctx, runtimeClient, ctx.sessionId);
        }
        await this.finishGeneration(ctx, "completed");
        return;
      }
      await this.finishGeneration(ctx, "error");
    }
  }

  private async runOpenCodeGeneration(ctx: GenerationContext): Promise<void> {
    let promptTimeoutTriggered = false;
    let clearPromptTimeout: (() => void) | undefined;
    let client: RuntimeHarnessClient | undefined;
    try {
      if (await this.refreshCancellationSignal(ctx, { force: true })) {
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      if (parseModelReference(ctx.model).providerID === "anthropic" && !env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      // Get user's CLI environment and integrations
      const userTimezonePromise =
        typeof db.query.user?.findFirst === "function"
          ? db.query.user.findFirst({
              where: eq(user.id, ctx.userId),
              columns: { timezone: true },
            })
          : Promise.resolve(null);
      const [cliEnv, enabledIntegrations, dbUser] = await Promise.all([
        getCliEnvForUser(ctx.userId),
        getEnabledIntegrationTypes(ctx.userId),
        userTimezonePromise,
      ]);
      const { customSkillNames } = splitCoworkerAllowedSkillSlugs(ctx.allowedSkillSlugs ?? []);

      const allowedIntegrations = ctx.allowedIntegrations ?? enabledIntegrations;
      this.ensureRemoteRunDebugInfo(ctx);

      const cliInstructions = await getCliInstructionsWithCustom(allowedIntegrations, ctx.userId);
      let filteredCliEnv = filterCliEnvToAllowedIntegrations(cliEnv, ctx.allowedIntegrations);

      if (ctx.remoteIntegrationSource && allowedIntegrations.length > 0) {
        const remoteCredentials = await getRemoteIntegrationCredentials({
          targetEnv: ctx.remoteIntegrationSource.targetEnv,
          remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
          integrationTypes: allowedIntegrations,
          requestedByUserId: ctx.remoteIntegrationSource.requestedByUserId,
          requestedByEmail: ctx.remoteIntegrationSource.requestedByEmail ?? null,
        });

        logServerEvent(
          "info",
          "REMOTE_INTEGRATION_CREDENTIALS_ATTACHED",
          {
            targetEnv: ctx.remoteIntegrationSource.targetEnv,
            remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
            remoteUserEmail:
              ctx.remoteIntegrationSource.remoteUserEmail ?? remoteCredentials.remoteUserEmail,
            allowedIntegrations: [...allowedIntegrations].toSorted(),
            attachedTokenEnvVarNames: Object.keys(remoteCredentials.tokens).toSorted(),
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );

        filteredCliEnv = {
          ...filteredCliEnv,
          ...remoteCredentials.tokens,
        };
        this.recordRemoteRunPhase(ctx, "remote_credentials_fetched", {
          attachedTokenEnvVarNames: Object.keys(remoteCredentials.tokens).toSorted(),
        });
      }

      if (ctx.allowedIntegrations !== undefined) {
        filteredCliEnv.ALLOWED_INTEGRATIONS = ctx.allowedIntegrations.join(",");
      }
      if (dbUser?.timezone) {
        filteredCliEnv.CMDCLAW_USER_TIMEZONE = dbUser.timezone;
      }
      const sandboxRuntimeEnv: Record<string, string | null | undefined> = {
        ...filteredCliEnv,
        APP_URL: resolveSandboxRuntimeAppUrl(),
        CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
        CONVERSATION_ID: ctx.conversationId,
      };

      // Get conversation for existing session info
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
      });

      // Determine if we need to replay history (existing conversation)
      const hasExistingMessages = !ctx.isNewConversation;

      const initDeadlineAt = Date.now() + AGENT_PREPARING_TIMEOUT_MS;
      const buildPreparingTimeoutMessage = () =>
        `Agent preparation timed out after ${Math.round(AGENT_PREPARING_TIMEOUT_MS / 1000)} seconds.`;
      const remainingPreparingTimeoutMs = () => Math.max(1, initDeadlineAt - Date.now());
      const initWarnAfterMs = 15_000;

      let sessionId: string | undefined;
      let runtimeSandbox: Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["sandbox"];
      let runtimeMetadata:
        | Awaited<ReturnType<typeof getOrCreateConversationRuntime>>["metadata"]
        | undefined;
      let runtimeInit: Awaited<ReturnType<typeof getOrCreateConversationSandbox>>;

      ctx.agentSandboxReadyAt = undefined;
      ctx.agentSandboxMode = undefined;
      this.markPhase(ctx, "sandbox_init_started");
      this.broadcast(ctx, {
        type: "status_change",
        status: "sandbox_init_started",
      });
      logServerEvent(
        "info",
        "SANDBOX_INIT_STARTED",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      const sandboxInitWarnTimer = setTimeout(() => {
        const elapsedMs = AGENT_PREPARING_TIMEOUT_MS - remainingPreparingTimeoutMs();
        logServerEvent(
          "warn",
          "SANDBOX_INIT_SLOW",
          { elapsedMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      }, initWarnAfterMs);

      try {
        runtimeInit = await withTimeout(
          getOrCreateConversationSandbox(
            {
              conversationId: ctx.conversationId,
              generationId: ctx.id,
              userId: ctx.userId,
              model: ctx.model,
              openAIAuthSource: ctx.authSource,
              anthropicApiKey: env.ANTHROPIC_API_KEY || "",
              integrationEnvs: filteredCliEnv,
            },
            {
              sandboxProviderOverride: ctx.sandboxProviderOverride,
              title: conv?.title || "Conversation",
              replayHistory: hasExistingMessages,
              allowSnapshotRestore: ctx.executionPolicy.allowSnapshotRestoreOnRun !== false,
              telemetry: {
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
              },
              onLifecycle: (stage, details) => {
                const status = stage.startsWith("sandbox_")
                  ? `sandbox_init_${stage.slice("sandbox_".length)}`
                  : `agent_init_${stage}`;
                this.markPhase(ctx, status);
                if (stage === "sandbox_created") {
                  ctx.agentSandboxReadyAt = Date.now();
                  ctx.agentSandboxMode = "created";
                } else if (stage === "sandbox_reused") {
                  ctx.agentSandboxReadyAt = Date.now();
                  ctx.agentSandboxMode = "reused";
                }
                this.broadcast(ctx, { type: "status_change", status });
                logServerEvent("info", status.toUpperCase(), details ?? {}, {
                  source: "generation-manager",
                  traceId: ctx.traceId,
                  generationId: ctx.id,
                  conversationId: ctx.conversationId,
                  userId: ctx.userId,
                });
              },
            },
          ),
          remainingPreparingTimeoutMs(),
          buildPreparingTimeoutMessage(),
        );
        runtimeSandbox = runtimeInit.sandbox;
        runtimeMetadata = runtimeInit.metadata;
      } catch (error) {
        this.markPhase(ctx, "sandbox_init_failed");
        this.broadcast(ctx, {
          type: "status_change",
          status: "sandbox_init_failed",
        });
        logServerEvent(
          "error",
          "SANDBOX_INIT_FAILED",
          {
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        throw error;
      } finally {
        clearTimeout(sandboxInitWarnTimer);
      }

      await this.bindRuntimeSandboxToContext(ctx, {
        runtimeSandbox,
        runtimeMetadata,
      });
      if (ctx.remoteIntegrationSource) {
        this.recordRemoteRunPhase(ctx, "sandbox_created");
      }
      await this.setSnapshotRestoreAllowance(ctx, false);

      const agentInitStartedAt = Date.now();
      ctx.agentInitStartedAt = agentInitStartedAt;
      ctx.agentInitReadyAt = undefined;
      ctx.agentInitFailedAt = undefined;
      this.markPhase(ctx, "agent_init_started");
      this.broadcast(ctx, {
        type: "status_change",
        status: "agent_init_started",
      });
      logServerEvent(
        "info",
        "AGENT_INIT_STARTED",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      const agentInitWarnTimer = setTimeout(() => {
        const elapsedMs = Date.now() - agentInitStartedAt;
        logServerEvent(
          "warn",
          "AGENT_INIT_SLOW",
          { elapsedMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      }, initWarnAfterMs);

      let resolveExecutorSessionMcpServers: (
        value: import("../sandbox/core/types").RuntimeMcpServer[] | undefined,
      ) => void = () => {};
      let rejectExecutorSessionMcpServers: (reason?: unknown) => void = () => {};
      const executorSessionMcpServersPromise: Promise<
        import("../sandbox/core/types").RuntimeMcpServer[] | undefined
      > =
        runtimeMetadata?.runtimeHarness === "opencode"
          ? new Promise((resolve, reject) => {
              resolveExecutorSessionMcpServers = resolve;
              rejectExecutorSessionMcpServers = reject;
            })
          : Promise.resolve(undefined);

      const runtimeSessionPromise = (async () => {
        try {
          const sessionMcpServers = await executorSessionMcpServersPromise;
          const session = await withTimeout(
            runtimeInit.completeAgentInit({ sessionMcpServers }),
            remainingPreparingTimeoutMs(),
            buildPreparingTimeoutMessage(),
          );
          client = session.harnessClient;
          sessionId = session.session.id;
          await this.persistRuntimeSessionBinding(ctx, {
            runtimeMetadata,
            sessionId,
          });
          ctx.agentInitReadyAt = Date.now();
          this.markPhase(ctx, "agent_init_ready");
          this.broadcast(ctx, {
            type: "status_change",
            status: "agent_init_ready",
            metadata: {
              runtimeId: ctx.runtimeId,
              sandboxProvider: runtimeMetadata?.sandboxProvider,
              runtimeHarness: runtimeMetadata?.runtimeHarness,
              runtimeProtocolVersion: runtimeMetadata?.runtimeProtocolVersion,
              sandboxId: runtimeSandbox.sandboxId,
              sessionId,
            },
          });
          logServerEvent(
            "info",
            "AGENT_INIT_READY",
            {
              durationMs: ctx.agentInitReadyAt - agentInitStartedAt,
              sandboxProvider: runtimeMetadata?.sandboxProvider,
              runtimeHarness: runtimeMetadata?.runtimeHarness,
              runtimeProtocolVersion: runtimeMetadata?.runtimeProtocolVersion,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId,
              sandboxId: runtimeSandbox.sandboxId,
            },
          );
        } catch (error) {
          ctx.agentInitFailedAt = Date.now();
          this.markPhase(ctx, "agent_init_failed");
          this.broadcast(ctx, {
            type: "status_change",
            status: "agent_init_failed",
          });
          logServerEvent(
            "error",
            "AGENT_INIT_FAILED",
            {
              durationMs: ctx.agentInitFailedAt - agentInitStartedAt,
              error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
            },
          );
          throw error;
        } finally {
          clearTimeout(agentInitWarnTimer);
        }
      })();

      // Record marker time for file collection and store sandbox reference
      ctx.generationMarkerTime = Date.now();
      ctx.sentFilePaths = new Set();
      ctx.userStagedFilePaths = new Set();
      this.markPhase(ctx, "pre_prompt_setup_started");
      const prePromptStartedAt = Date.now();
      const prePromptBreakdown: Record<string, number> = {};
      const markPrePromptStep = (step: string, startedAt: number) => {
        prePromptBreakdown[step] = Date.now() - startedAt;
      };
      const markPrePromptPhase = (step: string, status: "started" | "completed") => {
        this.markPhase(ctx, `pre_prompt_${step}_${status}`);
      };
      const runPrePromptStep = async <T>(
        step: string,
        metricKey: string,
        action: () => Promise<T>,
      ): Promise<T> => {
        markPrePromptPhase(step, "started");
        const startedAt = Date.now();
        try {
          return await action();
        } finally {
          markPrePromptStep(metricKey, startedAt);
          markPrePromptPhase(step, "completed");
        }
      };

      let memoryInstructions = buildMemorySystemPrompt();
      let executorInstructions: string | null = null;
      let enabledSkillRows: Array<{ name: string; updatedAt: Date }> = [];
      let writtenSkills: string[] = [];
      let writtenIntegrationSkills: string[] = [];
      let prePromptCacheHit = false;
      let startPostPromptCacheWrite: (() => Promise<void>) | null = null;

      const memorySyncPromise = (async () => {
        try {
          await runPrePromptStep("memory_sync", "syncMemoryFilesToSandboxMs", async () => {
            await syncMemoryFilesToSandbox(ctx.userId, runtimeSandbox);
          });
        } catch (err) {
          console.error("[GenerationManager] Failed to sync memory to sandbox:", err);
          memoryInstructions = buildMemorySystemPrompt();
        }
      })();

      const runtimeContextWritePromise = (async () => {
        try {
          await runPrePromptStep("runtime_context_write", "writeRuntimeContextMs", async () => {
            if (ctx.runtimeId && ctx.runtimeCallbackToken && ctx.runtimeTurnSeq) {
              const runtimeContext: RuntimeContextFile = {
                runtimeId: ctx.runtimeId,
                turnSeq: ctx.runtimeTurnSeq,
                callbackToken: ctx.runtimeCallbackToken,
                updatedAt: new Date().toISOString(),
              };
              await writeRuntimeContextToSandbox(runtimeSandbox, runtimeContext);
            }
            await writeRuntimeEnvToSandbox(runtimeSandbox, sandboxRuntimeEnv);
          });
        } catch (error) {
          console.error("[GenerationManager] Failed to write runtime metadata to sandbox:", error);
        }
      })();

      const executorPreparePromise = (async (): Promise<() => Promise<void>> => {
        markPrePromptPhase("executor_prepare", "started");
        const executorPrepareStartedAt = Date.now();
        let executorPrepareCompleted = false;
        const completeExecutorPrepare = () => {
          if (executorPrepareCompleted) {
            return;
          }
          executorPrepareCompleted = true;
          markPrePromptStep("prepareExecutorInSandboxMs", executorPrepareStartedAt);
          markPrePromptPhase("executor_prepare", "completed");
        };
        const executorLogContext = () => ({
          source: "generation-manager" as const,
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sandboxId: runtimeSandbox.sandboxId,
          sessionId: sessionId ?? ctx.sessionId,
        });

        try {
          await runtimeContextWritePromise;
          await memorySyncPromise;

          const executorBootstrap = await prepareExecutorInSandbox({
            sandbox: runtimeSandbox,
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            allowedSourceIds: ctx.allowedExecutorSourceIds,
            runtimeId: ctx.runtimeId,
            reuseExistingState: ctx.agentSandboxMode === "reused",
            onPhase: (phase, status) => {
              this.markPhase(ctx, `pre_prompt_executor_${phase}_${status}`);
            },
          });
          executorInstructions = executorBootstrap?.instructions ?? null;
          let executorFinalizePromise: Promise<void> | null = null;
          const runExecutorFinalize = async () => {
            executorFinalizePromise ??= (async () => {
              let result: {
                oauthCacheHits: number;
                oauthRefreshFailures: Array<{
                  sourceId: string;
                  name: string;
                  namespace: string;
                  reason: string;
                  error: string;
                }>;
                oauthSourceStatuses: ExecutorOauthSourceStatus[];
              } = { oauthCacheHits: 0, oauthRefreshFailures: [], oauthSourceStatuses: [] };
              try {
                result = executorBootstrap?.finalize ? await executorBootstrap.finalize() : result;
                const sourceHealthInstructions = buildExecutorSourceHealthInstructions(
                  result.oauthSourceStatuses,
                );
                if (sourceHealthInstructions) {
                  executorInstructions = [
                    executorBootstrap?.instructions ?? null,
                    sourceHealthInstructions,
                  ]
                    .filter((entry): entry is string => Boolean(entry))
                    .join("\n\n");
                }
                if (result.oauthRefreshFailures.length > 0) {
                  logServerEvent(
                    "warn",
                    "EXECUTOR_PREP_REFRESH_PARTIAL_FAILED",
                    {
                      oauthCacheHits: result.oauthCacheHits,
                      oauthRefreshFailureCount: result.oauthRefreshFailures.length,
                      oauthRefreshFailureNamespaces: result.oauthRefreshFailures.map(
                        (failure) => failure.namespace,
                      ),
                      oauthRefreshFailures: result.oauthRefreshFailures.map((failure) => ({
                        namespace: failure.namespace,
                        reason: failure.reason,
                        error: failure.error,
                      })),
                    },
                    executorLogContext(),
                  );
                }
                const unavailableSelectedSources =
                  ctx.allowedExecutorSourceIds && ctx.allowedExecutorSourceIds.length > 0
                    ? result.oauthSourceStatuses.filter(
                        (source) =>
                          ctx.allowedExecutorSourceIds?.includes(source.sourceId) &&
                          source.status !== "available",
                      )
                    : [];
                logServerEvent(
                  "info",
                  "EXECUTOR_PREP_COMPLETED",
                  {
                    oauthCacheHits: result.oauthCacheHits,
                    oauthRefreshFailureCount: result.oauthRefreshFailures.length,
                    unavailableSelectedSourceCount: unavailableSelectedSources.length,
                  },
                  executorLogContext(),
                );
              } catch (error) {
                console.error("[GenerationManager] Executor OAuth reconcile failed:", error);
                logServerEvent(
                  "error",
                  "EXECUTOR_PREP_FINALIZE_FAILED",
                  {
                    error: error instanceof Error ? error.message : String(error),
                  },
                  executorLogContext(),
                );
              } finally {
                completeExecutorPrepare();
              }
            })();
            await executorFinalizePromise;
          };

          await runExecutorFinalize();

          resolveExecutorSessionMcpServers(executorBootstrap?.sessionMcpServers);
          return runExecutorFinalize;
        } catch (error) {
          console.error("[GenerationManager] Failed to prepare executor in sandbox:", error);
          rejectExecutorSessionMcpServers(error);
          completeExecutorPrepare();
          throw new ExecutorPromptReadyError(error);
        }
      })();

      const skillsAndCredsLoadPromise = runPrePromptStep(
        "skills_and_creds_load",
        "loadSkillsAndCredsMs",
        async () =>
          await Promise.all([
            listAccessibleEnabledSkillMetadataForUser(ctx.userId),
            db.query.customIntegrationCredential.findMany({
              where: and(
                eq(customIntegrationCredential.userId, ctx.userId),
                eq(customIntegrationCredential.enabled, true),
              ),
              with: { customIntegration: true },
            }),
          ]),
      );

      const skillAssetPreparePromise = (async () => {
        const [loadedSkillRows, customCreds] = await skillsAndCredsLoadPromise;
        enabledSkillRows = loadedSkillRows;

        const eligibleCustomCreds = customCreds.filter((cred) => {
          if (!ctx.allowedCustomIntegrations) {
            return true;
          }
          return ctx.allowedCustomIntegrations.includes(cred.customIntegration.slug);
        });

        const prePromptCacheKey = await runPrePromptStep(
          "cache_key_build",
          "buildPrePromptCacheKeyMs",
          async () =>
            JSON.stringify({
              userId: ctx.userId,
              allowedIntegrations: [...allowedIntegrations].toSorted(),
              allowedCustomIntegrations: [...(ctx.allowedCustomIntegrations ?? [])].toSorted(),
              allowedSkillSlugs: [...(ctx.allowedSkillSlugs ?? [])].toSorted(),
              selectedPlatformSkillSlugs: [...(ctx.selectedPlatformSkillSlugs ?? [])].toSorted(),
              skills: enabledSkillRows
                .map((entry) => `${entry.name}:${entry.updatedAt.toISOString()}`)
                .toSorted(),
              customIntegrations: eligibleCustomCreds
                .map(
                  (cred) =>
                    `${cred.customIntegration.slug}:${cred.updatedAt.toISOString()}:${cred.customIntegration.updatedAt.toISOString()}`,
                )
                .toSorted(),
            }),
        );

        if (ctx.agentSandboxMode === "reused") {
          try {
            const parsed = await runPrePromptStep(
              "cache_read",
              "readPrePromptCacheMs",
              async () => {
                const rawCache = await runtimeSandbox.readFile(PRE_PROMPT_CACHE_PATH);
                return JSON.parse(String(rawCache)) as Partial<PrePromptCacheRecord>;
              },
            );
            if (parsed.cacheKey === prePromptCacheKey) {
              prePromptCacheHit = true;
              if (Array.isArray(parsed.writtenSkills)) {
                writtenSkills = parsed.writtenSkills.filter(
                  (value): value is string => typeof value === "string",
                );
              }
              if (Array.isArray(parsed.writtenIntegrationSkills)) {
                writtenIntegrationSkills = parsed.writtenIntegrationSkills.filter(
                  (value): value is string => typeof value === "string",
                );
              }
              logServerEvent(
                "info",
                "PRE_PROMPT_CACHE_HIT",
                {
                  skillsCount: writtenSkills.length,
                  integrationSkillCount: writtenIntegrationSkills.length,
                },
                {
                  source: "generation-manager",
                  traceId: ctx.traceId,
                  generationId: ctx.id,
                  conversationId: ctx.conversationId,
                  userId: ctx.userId,
                  sandboxId: runtimeSandbox.sandboxId,
                  sessionId: ctx.sessionId,
                },
              );
            }
          } catch {
            // Cache file absent or invalid; fall back to full prep.
          }
        }

        if (prePromptCacheHit) {
          return;
        }

        try {
          await runPrePromptStep("skill_asset_prepare", "prepareSkillAssetsMs", async () => {
            const skillsWritePromise = runPrePromptStep(
              "skills_write",
              "writeSkillsToSandboxMs",
              async () =>
                await writeSkillsToSandbox(
                  runtimeSandbox,
                  ctx.userId,
                  customSkillNames.length > 0 ? customSkillNames : undefined,
                ),
            );

            const customIntegrationCliWritePromise = runPrePromptStep(
              "custom_integration_cli_write",
              "writeCustomIntegrationCliMs",
              async () => {
                await Promise.all(
                  eligibleCustomCreds.map(async (cred) => {
                    const integ = cred.customIntegration;
                    const cliPath = `/app/cli/custom-${integ.slug}.ts`;
                    await runtimeSandbox.writeFile(cliPath, integ.cliCode);
                  }),
                );
              },
            );

            const customPerms: Record<string, { read: string[]; write: string[] }> = {};
            for (const cred of eligibleCustomCreds) {
              const integ = cred.customIntegration;
              customPerms[`custom-${integ.slug}`] = {
                read: integ.permissions.readOps,
                write: integ.permissions.writeOps,
              };
            }

            const customIntegrationPermissionsWritePromise =
              Object.keys(customPerms).length > 0
                ? runPrePromptStep(
                    "custom_integration_permissions_write",
                    "writeCustomIntegrationPermissionsMs",
                    async () => {
                      await runtimeSandbox.exec(
                        `echo 'export CUSTOM_INTEGRATION_PERMISSIONS=${JSON.stringify(JSON.stringify(customPerms)).slice(1, -1)}' >> ~/.bashrc`,
                      );
                    },
                  )
                : Promise.resolve();

            const allowedSkillSlugs = new Set<string>(allowedIntegrations);
            for (const cred of eligibleCustomCreds) {
              allowedSkillSlugs.add(cred.customIntegration.slug);
            }

            const integrationSkillsWritePromise = runPrePromptStep(
              "integration_skills_write",
              "writeIntegrationSkillsMs",
              async () =>
                await writeResolvedIntegrationSkillsToSandbox(
                  runtimeSandbox,
                  ctx.userId,
                  Array.from(allowedSkillSlugs),
                ),
            );

            const [
              resolvedWrittenSkills,
              _customIntegrationCliWrite,
              _customIntegrationPermissionsWrite,
              resolvedWrittenIntegrationSkills,
            ] = await Promise.all([
              skillsWritePromise,
              customIntegrationCliWritePromise,
              customIntegrationPermissionsWritePromise,
              integrationSkillsWritePromise,
            ]);

            writtenSkills = resolvedWrittenSkills;
            writtenIntegrationSkills = resolvedWrittenIntegrationSkills;
            startPostPromptCacheWrite = async () => {
              this.markPhase(ctx, "post_prompt_cache_write_started");
              const startedAt = Date.now();
              try {
                await runtimeSandbox.ensureDir(path.dirname(PRE_PROMPT_CACHE_PATH));
                const nextCacheRecord: PrePromptCacheRecord = {
                  version: 1,
                  cacheKey: prePromptCacheKey,
                  writtenSkills,
                  writtenIntegrationSkills,
                  updatedAt: new Date().toISOString(),
                };
                await runtimeSandbox.writeFile(
                  PRE_PROMPT_CACHE_PATH,
                  JSON.stringify(nextCacheRecord, null, 2),
                );
                logServerEvent(
                  "info",
                  "POST_PROMPT_CACHE_WRITE_COMPLETED",
                  {},
                  {
                    source: "generation-manager",
                    traceId: ctx.traceId,
                    generationId: ctx.id,
                    conversationId: ctx.conversationId,
                    userId: ctx.userId,
                    sandboxId: runtimeSandbox.sandboxId,
                    sessionId: ctx.sessionId,
                  },
                );
              } catch (error) {
                console.error("[GenerationManager] Failed to write pre-prompt cache:", error);
              } finally {
                prePromptBreakdown.writePrePromptCacheMs = Date.now() - startedAt;
                this.markPhase(ctx, "post_prompt_cache_write_completed");
              }
            };
          });
        } catch (error) {
          console.error("[Generation] Failed to write custom integration CLI code:", error);
        }
      })();

      const [, , runExecutorPrepareFinalize] = await Promise.all([
        memorySyncPromise,
        runtimeContextWritePromise,
        executorPreparePromise,
        skillAssetPreparePromise,
        runtimeSessionPromise,
      ]);

      if (!sessionId) {
        throw new Error("Runtime session ID is unavailable.");
      }
      if (!client) {
        throw new Error("Runtime harness client is unavailable.");
      }

      await this.bindRuntimeSessionToContext(ctx, {
        runtimeSandbox,
        runtimeMetadata,
        sessionId,
      });
      const activeSessionId = sessionId;

      if (writtenSkills.length === 0) {
        writtenSkills = enabledSkillRows.map((entry) => entry.name);
      }
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);
      const integrationSkillsInstructions =
        getIntegrationSkillsSystemPrompt(writtenIntegrationSkills);

      const promptSpecInput = this.buildPromptSpecInputForContext(ctx, {
        cliInstructions,
        executorInstructions,
        skillsInstructions,
        integrationSkillsInstructions,
        memoryInstructions,
        userTimezone: dbUser?.timezone ?? null,
      });
      const promptSpec = await runPrePromptStep(
        "prompt_spec_compose",
        "composePromptSpecMs",
        async () => composeOpencodePromptSpec(promptSpecInput),
      );
      const runtimeClient = client;

      let currentTextPart: { type: "text"; text: string } | null = null;
      let currentTextPartId: string | null = null;
      const verboseOpenCodeEventLogs = process.env.OPENCODE_VERBOSE_EVENTS === "1";
      let opencodeEventCount = 0;
      let opencodeToolCallCount = 0;
      let opencodePermissionCount = 0;
      let opencodeQuestionCount = 0;
      let stagedCoworkerDocumentCount = 0;
      let stagedUploadCount = 0;
      let stagedUploadFailureCount = 0;
      let lastExternalInterruptPollAt = 0;
      let observedTerminalIdle = false;

      // Subscribe to SSE events BEFORE sending the prompt
      const promptTimeoutController = new AbortController();
      const eventResult = await runPrePromptStep(
        "event_stream_subscribe",
        "subscribeEventStreamMs",
        async () =>
          await runtimeClient.subscribe(
            {},
            {
              signal: promptTimeoutController.signal,
            },
          ),
      );
      const eventStream = eventResult.stream;

      const parsedModel = parseModelReference(ctx.model);

      // Resolve provider from model reference
      const modelConfig = {
        providerID: parsedModel.providerID,
        modelID: parsedModel.modelID,
      };

      // Build prompt parts (text + file attachments)
      // For non-image files, write them to the sandbox so the LLM can process them
      // via sandbox tools, rather than passing unsupported media types directly.
      const promptParts: RuntimePromptPart[] = [{ type: "text", text: ctx.userMessageContent }];
      const coworkerId = ctx.coworkerId;
      if (coworkerId) {
        const coworkerDocumentPaths = await runPrePromptStep(
          "coworker_docs_stage",
          "stageCoworkerDocsMs",
          async () => await writeCoworkerDocumentsToSandbox(runtimeSandbox, coworkerId),
        );
        if (coworkerDocumentPaths.length > 0) {
          stagedCoworkerDocumentCount = coworkerDocumentPaths.length;
          promptParts.push({
            type: "text",
            text: [
              "Persistent coworker documents are available in the sandbox for this run:",
              ...coworkerDocumentPaths.map((filePath) => `- ${filePath}`),
              "Read them from disk when they are relevant to the task.",
            ].join("\n"),
          });
        }
      }
      const attachments = ctx.attachments;
      if (attachments && attachments.length > 0) {
        await runPrePromptStep("attachments_stage", "stageAttachmentsMs", async () => {
          await Promise.all(
            attachments.map(async (a) => {
              const sandboxPath = `/home/user/uploads/${a.name}`;
              try {
                const base64Data = a.dataUrl.split(",")[1] || "";
                const buffer = Buffer.from(base64Data, "base64");
                await runtimeSandbox.writeFile(
                  sandboxPath,
                  buffer.buffer.slice(
                    buffer.byteOffset,
                    buffer.byteOffset + buffer.byteLength,
                  ) as ArrayBuffer,
                );
                ctx.userStagedFilePaths?.add(sandboxPath);
                promptParts.push({
                  type: "text",
                  text: `The user uploaded a file: ${sandboxPath} (${a.mimeType}). You can read and process it using the sandbox tools.`,
                });
                stagedUploadCount += 1;
                if (a.mimeType.startsWith("image/")) {
                  promptParts.push({
                    type: "file",
                    mime: a.mimeType,
                    url: a.dataUrl,
                    filename: a.name,
                  });
                }
              } catch (err) {
                stagedUploadFailureCount += 1;
                console.error(
                  `[GenerationManager] Failed to write file to sandbox: ${sandboxPath}`,
                  err,
                );
                promptParts.push({
                  type: "text",
                  text: `The user tried to upload a file "${a.name}" but it could not be written to the sandbox.`,
                });
              }
            }),
          );
        });
      }
      if (
        stagedCoworkerDocumentCount > 0 ||
        stagedUploadCount > 0 ||
        stagedUploadFailureCount > 0
      ) {
        logServerEvent(
          "info",
          "ATTACHMENTS_STAGED",
          {
            stagedCoworkerDocumentCount,
            stagedUploadCount,
            stagedUploadFailureCount,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
        );
      }

      markPrePromptStep("prePromptSetupTotalMs", prePromptStartedAt);
      logServerEvent(
        "info",
        "PRE_PROMPT_BREAKDOWN",
        {
          cacheHit: prePromptCacheHit,
          sandboxMode: ctx.agentSandboxMode ?? "unknown",
          ...prePromptBreakdown,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sandboxId: runtimeSandbox.sandboxId,
          sessionId: ctx.sessionId,
        },
      );

      // Send the prompt to OpenCode
      logServerEvent(
        "info",
        "OPENCODE_PROMPT_SENT",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId: activeSessionId,
        },
      );
      if (ctx.remoteIntegrationSource) {
        this.recordRemoteRunPhase(ctx, "prompt_sent");
      }
      this.markPhase(ctx, "prompt_sent");
      void runExecutorPrepareFinalize();
      if (startPostPromptCacheWrite !== null) {
        void (startPostPromptCacheWrite as () => Promise<void>)();
      }
      const promptSentAtMs = Date.now();
      const remainingRunTimeMs = this.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const promptTimeoutId = setTimeout(() => {
        promptTimeoutTriggered = true;
        promptTimeoutController.abort();
        logServerEvent(
          "error",
          "OPENCODE_PROMPT_TIMEOUT",
          { timeoutMs: remainingRunTimeMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
        );
        void runtimeClient.abort({ sessionID: activeSessionId }).catch((err) => {
          console.error("[GenerationManager] Failed to abort timed out OpenCode session:", err);
        });
      }, remainingRunTimeMs);
      clearPromptTimeout = () => {
        clearTimeout(promptTimeoutId);
        clearPromptTimeout = undefined;
      };
      // Guard the in-flight prompt so runtime rejections stay scoped to this generation.
      const promptResultPromise = runtimeClient
        .prompt({
          sessionID: activeSessionId,
          parts: promptParts,
          agent: promptSpec.agentId,
          system: promptSpec.systemPrompt,
          model: modelConfig,
        })
        .then(
          (data) => ({ ok: true as const, data }),
          (error) => ({ ok: false as const, error }),
        );
      this.startExternalInterruptPolling(ctx);
      let sessionErrorMessage: string | null = null;

      const processOpenCodeRuntimeEvent = async (
        rawEvent: RuntimeEvent,
      ): Promise<"continue" | "idle" | "error"> => {
        if (!ctx.phaseMarks?.first_event_received) {
          this.markPhase(ctx, "first_event_received");
        }
        const event = rawEvent;
        this.markRuntimeActivity(ctx);
        if (await this.refreshCancellationSignal(ctx)) {
          return "error";
        }
        if (Date.now() - lastExternalInterruptPollAt >= 1_000) {
          lastExternalInterruptPollAt = Date.now();
          await this.pollExternalInterruptAndSuspendIfNeeded(ctx);
        }

        opencodeEventCount += 1;

        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          if (part.type === "tool" && part.state.status === "pending") {
            opencodeToolCallCount += 1;
          }
        }

        if (verboseOpenCodeEventLogs) {
          const eventJson = JSON.stringify(event.properties || {});
          console.log("[OpenCode Event]", event.type, eventJson.slice(0, 200));
        } else if (
          event.type === "server.connected" ||
          event.type === "session.error" ||
          event.type === "session.idle"
        ) {
          console.info(
            `[OpenCode][EVENT] type=${event.type} generationId=${ctx.id} conversationId=${ctx.conversationId}`,
          );
        }

        // Transform tracked OpenCode events to GenerationEvents
        if (isOpenCodeTrackedEvent(event)) {
          await this.processOpencodeEvent(
            ctx,
            event,
            currentTextPart,
            currentTextPartId,
            (part, partId) => {
              currentTextPart = part;
              currentTextPartId = partId;
            },
          );
        }

        if (isOpenCodeActionableEvent(event)) {
          const actionableResult = await this.handleOpenCodeActionableEvent(
            ctx,
            runtimeClient,
            event,
          );
          if (actionableResult.type === "permission") {
            opencodePermissionCount += 1;
          } else if (actionableResult.type === "question") {
            opencodeQuestionCount += 1;
          }
        }

        // Check for session idle (generation complete)
        if (event.type === "session.idle") {
          observedTerminalIdle = true;
          this.markPhase(ctx, "session_idle");
          console.log("[GenerationManager] Session idle - generation complete");
          return "idle";
        }

        // Check for session error
        if (event.type === "session.error") {
          const eventProps =
            typeof event.properties === "object" && event.properties !== null
              ? (event.properties as Record<string, unknown>)
              : {};
          const error = eventProps.error ?? "Unknown error";
          const errorObj =
            typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
          const nestedData =
            errorObj && typeof errorObj.data === "object" && errorObj.data !== null
              ? (errorObj.data as Record<string, unknown>)
              : null;
          const errorMessage =
            typeof error === "string"
              ? error
              : typeof nestedData?.message === "string"
                ? nestedData.message
                : typeof errorObj?.message === "string"
                  ? errorObj.message
                  : JSON.stringify(error);
          logServerEvent(
            "error",
            "OPENCODE_SESSION_ERROR",
            {
              errorMessage,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
          if (!sessionErrorMessage) {
            sessionErrorMessage = errorMessage;
          }
          if (ctx.remoteIntegrationSource) {
            this.recordRemoteRunPhase(ctx, "session_error", {
              sessionErrorMessage: errorMessage,
            });
          }
          return "error";
        }
        return "continue";
      };

      // Process SSE events
      for await (const rawEvent of eventStream) {
        const streamOutcome = await processOpenCodeRuntimeEvent(rawEvent as RuntimeEvent);
        if (streamOutcome !== "continue") {
          break;
        }
      }

      if (
        !observedTerminalIdle &&
        !sessionErrorMessage &&
        !ctx.abortController.signal.aborted &&
        !promptTimeoutTriggered
      ) {
        const terminalOutcome = await this.waitForOpenCodeTerminalStateAfterEarlyStreamEnd(
          ctx,
          runtimeClient,
          activeSessionId,
          processOpenCodeRuntimeEvent,
        );
        if (terminalOutcome === "idle") {
          observedTerminalIdle = true;
          if (!ctx.phaseMarks?.session_idle) {
            this.markPhase(ctx, "session_idle");
          }
        } else if (terminalOutcome === "timed_out") {
          await this.parkGenerationForRunDeadline(ctx, runtimeClient);
          return;
        } else if (terminalOutcome === "aborted") {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.finishGeneration(ctx, "cancelled");
          return;
        }
        if (terminalOutcome !== "unknown") {
          console.info(
            `[GenerationManager] OpenCode early stream reconciliation outcome=${terminalOutcome} generationId=${ctx.id} conversationId=${ctx.conversationId}`,
          );
        }
      }

      const promptResultOutcome = await this.awaitPromiseUntilRunDeadline(ctx, promptResultPromise);
      this.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      if (promptResultOutcome.type === "timed_out" || promptTimeoutTriggered) {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const promptResultEnvelope = promptResultOutcome.value;
      if (!promptResultEnvelope.ok) {
        if (!observedTerminalIdle) {
          throw promptResultEnvelope.error;
        }
        console.warn(
          "[GenerationManager] Ignoring prompt transport error after session idle:",
          promptResultEnvelope.error,
        );
      }
      const rawPromptResult = promptResultEnvelope.ok
        ? promptResultEnvelope.data
        : { data: null, error: null };
      const promptResult =
        rawPromptResult && typeof rawPromptResult === "object"
          ? "data" in rawPromptResult || "error" in rawPromptResult
            ? rawPromptResult
            : { data: rawPromptResult, error: null }
          : { data: rawPromptResult ?? null, error: null };
      if (promptResult.error) {
        const promptResultErrorMessage = formatErrorMessage(promptResult.error);
        if (!observedTerminalIdle && !isOpaqueDiagnosticMessage(promptResultErrorMessage)) {
          throw new Error(promptResultErrorMessage);
        }
        console.warn(
          observedTerminalIdle
            ? "[GenerationManager] Ignoring prompt result error after session idle:"
            : "[GenerationManager] Treating opaque prompt result error as empty completion:",
          promptResult.error,
        );
      }
      if (sessionErrorMessage) {
        throw new Error(sessionErrorMessage);
      }
      const promptElapsedMs = Date.now() - promptSentAtMs;
      if (promptElapsedMs >= remainingRunTimeMs) {
        await this.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      this.markPhase(ctx, "prompt_completed");

      if (!ctx.assistantContent.trim()) {
        const promptResultText = extractAssistantTextFromPromptResultData(promptResult.data);
        if (promptResultText) {
          if (!ctx.phaseMarks?.first_visible_output_emitted) {
            this.markPhase(ctx, "first_visible_output_emitted");
          }
          if (!ctx.phaseMarks?.first_token_emitted) {
            this.markPhase(ctx, "first_token_emitted");
          }
          ctx.assistantContent = promptResultText;
          ctx.contentParts.push({ type: "text", text: promptResultText });
          this.broadcast(ctx, { type: "text", content: promptResultText });
          this.scheduleSave(ctx);
          logServerEvent(
            "info",
            "OPENCODE_PROMPT_RESULT_ASSISTANT_APPLIED",
            { chars: promptResultText.length },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
        }
      }

      if (!ctx.assistantContent.trim()) {
        let fallbackMessagesError: string | null = null;
        let fallbackMessagesErrorDetail: string | null = null;
        let fallbackMessagesPayloadShape: string | null = null;
        try {
          const messagesResult = await runtimeClient.messages({
            sessionID: activeSessionId,
            limit: 20,
          });
          if (!messagesResult.error) {
            fallbackMessagesPayloadShape = describeSessionMessagesPayload(messagesResult.data);
            const fallbackText = extractAssistantTextFromSessionMessagesPayload(
              messagesResult.data,
            );
            if (fallbackText) {
              if (!ctx.phaseMarks?.first_visible_output_emitted) {
                this.markPhase(ctx, "first_visible_output_emitted");
              }
              if (!ctx.phaseMarks?.first_token_emitted) {
                this.markPhase(ctx, "first_token_emitted");
              }
              ctx.assistantContent = fallbackText;
              ctx.contentParts.push({ type: "text", text: fallbackText });
              this.broadcast(ctx, { type: "text", content: fallbackText });
              this.scheduleSave(ctx);
              logServerEvent(
                "info",
                "OPENCODE_FALLBACK_ASSISTANT_APPLIED",
                { chars: fallbackText.length },
                {
                  source: "generation-manager",
                  traceId: ctx.traceId,
                  generationId: ctx.id,
                  conversationId: ctx.conversationId,
                  userId: ctx.userId,
                  sessionId: activeSessionId,
                },
              );
            }
          } else {
            fallbackMessagesError = formatErrorMessage(messagesResult.error);
            fallbackMessagesErrorDetail = summarizeUnknownValue(messagesResult.error);
          }
        } catch (error) {
          fallbackMessagesError = formatErrorMessage(error);
          fallbackMessagesErrorDetail = summarizeUnknownValue(error);
          console.warn("[GenerationManager] Failed fallback session.messages fetch:", error);
        }

        await this.refreshCancellationSignal(ctx, { force: true });
        if (ctx.abortController.signal.aborted) {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.finishGeneration(ctx, "cancelled");
          return;
        }

        if (!ctx.assistantContent.trim() && !observedTerminalIdle) {
          const emptyCompletionDiagnostics = await this.collectEmptyCompletionDiagnostics(
            ctx,
            runtimeClient,
            activeSessionId,
          );
          const bestTranscriptError = isOpaqueDiagnosticMessage(fallbackMessagesError)
            ? emptyCompletionDiagnostics.sessionGetError
            : fallbackMessagesError;
          this.setCompletionReason(ctx, "runtime_error");
          ctx.errorMessage = !isOpaqueDiagnosticMessage(bestTranscriptError)
            ? `The sandbox run finished without producing any assistant output. Loading the runtime transcript also failed: ${bestTranscriptError}`
            : "The sandbox run finished without producing any assistant output. The runtime produced no assistant text, no terminal event, and the transcript endpoint returned no usable error details.";
          this.captureOriginalError(
            ctx,
            new Error(
              !isOpaqueDiagnosticMessage(bestTranscriptError)
                ? `OpenCode transcript fetch failed after empty completion: ${bestTranscriptError}`
                : "OpenCode returned no assistant text or transcript after prompt completion.",
            ),
            {
              phase: "prompt_completed",
            },
          );
          logServerEvent(
            "error",
            "OPENCODE_EMPTY_COMPLETION",
            {
              sessionIdleObserved: observedTerminalIdle,
              fallbackMessagesError,
              fallbackMessagesErrorDetail,
              fallbackMessagesPayloadShape,
              promptResultDataShape: describePromptResultData(promptResult.data),
              sessionGetError: emptyCompletionDiagnostics.sessionGetError,
              sessionGetErrorDetail: emptyCompletionDiagnostics.sessionGetErrorDetail,
              sessionGetDataShape: emptyCompletionDiagnostics.sessionGetDataShape,
              sessionGetDataDetail: emptyCompletionDiagnostics.sessionGetDataDetail,
              opencodeLogTail: emptyCompletionDiagnostics.opencodeLogTail,
              opencodeLogReadError: emptyCompletionDiagnostics.opencodeLogReadError,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
          await this.finishGeneration(ctx, "error");
          return;
        }
      }

      await this.refreshCancellationSignal(ctx, { force: true });
      this.markPhase(ctx, "post_processing_started");

      if (ctx.sandbox) {
        try {
          await this.importIntegrationSkillDraftsFromSandbox(ctx, ctx.sandbox);
        } catch (error) {
          console.error("[GenerationManager] Failed to import integration skill drafts:", error);
        }
      }

      // Collect new files created in the sandbox during generation
      let uploadedSandboxFileCount = 0;
      const shouldCollectSandboxFiles = opencodeToolCallCount > 0 || stagedUploadCount > 0;
      if (ctx.sandbox && ctx.generationMarkerTime && shouldCollectSandboxFiles) {
        try {
          const newFiles = await collectNewSandboxFiles(
            ctx.sandbox,
            ctx.generationMarkerTime,
            Array.from(new Set([...(ctx.sentFilePaths ?? []), ...(ctx.userStagedFilePaths ?? [])])),
          );
          const filesToUpload = filterAutoCollectedFilesMentionedInAnswer(
            newFiles,
            extractFinalAnswerTextForFileHeuristic(ctx),
          );

          console.log(
            `[GenerationManager] Found ${newFiles.length} new files in E2B sandbox; exposing ${filesToUpload.length} based on final-answer mentions`,
          );

          await Promise.all(
            filesToUpload.map(async (file) => {
              try {
                const fileRecord = await uploadSandboxFile({
                  path: file.path,
                  content: file.content,
                  conversationId: ctx.conversationId,
                });
                ctx.uploadedSandboxFileIds?.add(fileRecord.id);

                // Broadcast sandbox_file event so UI can update
                this.broadcast(ctx, {
                  type: "sandbox_file",
                  fileId: fileRecord.id,
                  path: file.path,
                  filename: fileRecord.filename,
                  mimeType: fileRecord.mimeType,
                  sizeBytes: fileRecord.sizeBytes,
                });

                uploadedSandboxFileCount += 1;
              } catch (err) {
                console.error(
                  `[GenerationManager] Failed to upload sandbox file ${file.path}:`,
                  err,
                );
              }
            }),
          );
        } catch (err) {
          console.error("[GenerationManager] Failed to collect sandbox files:", err);
        }
      }
      this.markPhase(ctx, "post_processing_completed");
      await this.captureUsageFromRuntimeSession(ctx, runtimeClient, activeSessionId);

      // Check if aborted
      if (ctx.abortController.signal.aborted) {
        if (ctx.abortForInterruptPark) {
          return;
        }
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
        );
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      // Complete the generation
      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
      );
      await this.finishGeneration(ctx, "completed");
    } catch (error) {
      this.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      if (error instanceof GenerationSuspendedError) {
        logServerEvent(
          "info",
          "GENERATION_SUSPENDED_FOR_INTERRUPT",
          {
            interruptId: error.interruptId,
            interruptKind: error.kind,
            remainingRunMs: ctx.remainingRunMs,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        return;
      }
      if (isBootstrapTimeoutError(error)) {
        this.captureOriginalError(ctx, error, {
          phase: this.getCurrentPhase(ctx) ?? "agent_init_failed",
        });
        this.setCompletionReason(ctx, "bootstrap_timeout");
        ctx.errorMessage = error instanceof Error ? error.message : formatErrorMessage(error);
        await this.finishGeneration(ctx, "error");
        return;
      }
      if (error instanceof ExecutorPromptReadyError) {
        this.captureOriginalError(ctx, error.cause ?? error, {
          phase: this.getCurrentPhase(ctx) ?? "pre_prompt_executor_prepare_failed",
        });
        this.setCompletionReason(ctx, "runtime_error");
        ctx.errorMessage = error.message;
        await this.finishGeneration(ctx, "error");
        return;
      }
      if (promptTimeoutTriggered) {
        await this.parkGenerationForRunDeadline(ctx, client);
        return;
      }
      console.error("[GenerationManager] Error:", error);
      const runtimeFailure = await this.resolveRuntimeFailure(ctx, client);
      this.captureOriginalError(ctx, error, { runtimeFailure });
      if (runtimeFailure === "recoverable_live_runtime") {
        this.scheduleRecoveryReattach(ctx);
        return;
      }
      if (runtimeFailure === "waiting_approval" || runtimeFailure === "waiting_auth") {
        return;
      }
      if (runtimeFailure === "sandbox_missing") {
        this.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage =
          "The sandbox stopped while this run was still active. Retry the task to continue.";
      } else if (runtimeFailure === "broken_runtime_state") {
        this.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The runtime ended in a non-terminal state and could not be recovered. Retry the task to continue.";
      } else if (runtimeFailure === "terminal_failed") {
        this.setCompletionReason(ctx, "runtime_error");
      } else if (runtimeFailure === "terminal_completed") {
        this.setCompletionReason(ctx, "completed");
      } else if (!ctx.completionReason) {
        this.setCompletionReason(ctx, "infra_disconnect");
      }
      if (!ctx.errorMessage && runtimeFailure !== "terminal_completed") {
        ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      }
      if (runtimeFailure === "terminal_completed") {
        if (client && ctx.sessionId) {
          await this.captureUsageFromRuntimeSession(ctx, client, ctx.sessionId);
        }
        await this.finishGeneration(ctx, "completed");
        return;
      }
      console.info(
        `[GenerationManager][SUMMARY] status=error generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} error=${JSON.stringify(ctx.errorMessage)}`,
      );
      await this.finishGeneration(ctx, "error");
    }
  }

  private async captureUsageFromRuntimeSession(
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ): Promise<void> {
    try {
      const messagesResult = await runtimeClient.messages({ sessionID: sessionId });
      if (messagesResult.error) {
        return;
      }

      const usage = aggregateConversationUsageFromSessionMessages(messagesResult.data);
      ctx.usage = {
        ...ctx.usage,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    } catch (error) {
      console.warn("[GenerationManager] Failed to capture usage from runtime session:", error);
    }
  }

  /**
   * Handle actionable OpenCode events that require explicit responses.
   */
  private async replyPermissionRequest(
    client: ApprovalCapableClient,
    input: { requestID: string; reply: "always" | "reject" },
  ): Promise<void> {
    if ("replyPermission" in client) {
      await client.replyPermission(input);
      return;
    }
    await client.permission.reply(input);
  }

  private async replyQuestionRequest(
    client: ApprovalCapableClient,
    input: { requestID: string; answers: string[][] },
  ): Promise<void> {
    if ("replyQuestion" in client) {
      await client.replyQuestion(input);
      return;
    }
    await client.question.reply(input);
  }

  private async rejectQuestionRequest(
    client: ApprovalCapableClient,
    input: { requestID: string },
  ): Promise<void> {
    if ("rejectQuestion" in client) {
      await client.rejectQuestion(input);
      return;
    }
    await client.question.reject(input);
  }

  private async handleOpenCodeActionableEvent(
    ctx: GenerationContext,
    client: ApprovalCapableClient,
    event: OpenCodeActionableEvent,
  ): Promise<{ type: "none" | "permission" | "question" }> {
    switch (event.type) {
      case "message.part.updated": {
        if (event.properties.part.type === "tool") {
          this.handleOpenCodeToolStateCoverage(event.properties.part);
        }
        return { type: "none" };
      }
      case "permission.asked": {
        await this.handleOpenCodePermissionAsked(ctx, client, event.properties);
        return { type: "permission" };
      }
      case "question.asked": {
        await this.handleOpenCodeQuestionAsked(ctx, client, event.properties);
        return { type: "question" };
      }
      default:
        return assertNever(event);
    }
  }

  private handleOpenCodeToolStateCoverage(part: Extract<RuntimePart, { type: "tool" }>): void {
    switch (part.state.status) {
      case "pending":
        return;
      case "running":
        return;
      case "completed":
        return;
      case "error":
        return;
      default:
        return assertNever(part.state);
    }
  }

  private async handleOpenCodePermissionAsked(
    ctx: GenerationContext,
    client: ApprovalCapableClient,
    request: RuntimePermissionRequest,
  ): Promise<void> {
    const permissionType = request.permission || "file access";
    const patterns = request.patterns;
    const allPatternsAllowed = shouldAutoApproveOpenCodePermission(permissionType, patterns);

    if (ctx.autoApprove || allPatternsAllowed) {
      console.log(
        "[GenerationManager] Auto-approving sandbox permission:",
        request.id,
        permissionType,
        patterns,
        ctx.autoApprove ? "(conversation auto-approve enabled)" : "(allowlisted path)",
      );
      try {
        await this.replyPermissionRequest(client, {
          requestID: request.id,
          reply: "always",
        });
      } catch (err) {
        console.error("[GenerationManager] Failed to approve permission:", err);
      }
      return;
    }

    console.log(
      "[GenerationManager] Surfacing permission request to UI:",
      request.id,
      request.permission,
      patterns,
    );

    const toolUseId = `opencode-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const command = patterns?.length ? `${permissionType}: ${patterns.join(", ")}` : permissionType;

    await this.queueOpenCodeApprovalRequest(
      ctx,
      client,
      {
        kind: "permission",
        request,
      },
      {
        toolUseId,
        toolName: "Permission",
        toolInput: request as Record<string, unknown>,
        requestedAt: new Date().toISOString(),
        integration: "cmdclaw",
        operation: permissionType,
        command,
      },
    );
  }

  private async handleOpenCodeQuestionAsked(
    ctx: GenerationContext,
    client: ApprovalCapableClient,
    request: RuntimeQuestionRequest,
  ): Promise<void> {
    const defaultAnswers = buildDefaultQuestionAnswers(request);
    const linkedToolUseId =
      typeof request.tool?.callID === "string" && request.tool.callID.length > 0
        ? request.tool.callID
        : typeof request.tool?.callId === "string" && request.tool.callId.length > 0
          ? request.tool.callId
          : undefined;
    const toolUseId =
      linkedToolUseId ??
      `opencode-question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const command = buildQuestionCommand(request);
    const toolInput = request as unknown as Record<string, unknown>;

    const existingToolUse = ctx.contentParts.find(
      (part): part is ContentPart & { type: "tool_use" } =>
        part.type === "tool_use" && part.id === toolUseId,
    );
    if (!existingToolUse) {
      this.broadcast(ctx, {
        type: "tool_use",
        toolName: "question",
        toolInput,
        toolUseId,
        integration: "cmdclaw",
        operation: "question",
      });

      ctx.contentParts.push({
        type: "tool_use",
        id: toolUseId,
        name: "question",
        input: toolInput,
        integration: "cmdclaw",
        operation: "question",
      });
      await this.saveProgress(ctx);
    }

    await this.queueOpenCodeApprovalRequest(
      ctx,
      client,
      {
        kind: "question",
        request,
        defaultAnswers,
      },
      {
        toolUseId,
        toolName: "question",
        toolInput,
        requestedAt: new Date().toISOString(),
        integration: "cmdclaw",
        operation: "question",
        command,
      },
    );
  }

  private async queueOpenCodeApprovalRequest(
    ctx: GenerationContext,
    _client: ApprovalCapableClient,
    openCodeRequest:
      | { kind: "permission"; request: RuntimePermissionRequest }
      | { kind: "question"; request: RuntimeQuestionRequest; defaultAnswers: string[][] },
    pendingApproval: PendingApproval,
  ): Promise<void> {
    if (!ctx.runtimeId || !ctx.runtimeTurnSeq) {
      throw new Error(`Missing runtime binding for generation ${ctx.id}`);
    }
    const interrupt = await generationInterruptService.createInterrupt({
      generationId: ctx.id,
      runtimeId: ctx.runtimeId,
      conversationId: ctx.conversationId,
      turnSeq: ctx.runtimeTurnSeq,
      kind: openCodeRequest.kind === "question" ? "runtime_question" : "runtime_permission",
      display: {
        title: pendingApproval.toolName,
        integration: pendingApproval.integration,
        operation: pendingApproval.operation,
        command: pendingApproval.command,
        toolInput: pendingApproval.toolInput,
        questionSpec:
          openCodeRequest.kind === "question"
            ? {
                questions: openCodeRequest.request.questions.map((question) => ({
                  header: question.header,
                  question: question.question,
                  options: (question.options ?? []).map((option) => ({
                    label: option.label,
                    description: option.description,
                  })),
                  multiple: question.multiple === true ? true : undefined,
                  custom: question.custom === true ? true : undefined,
                })),
              }
            : undefined,
      },
      provider: "opencode",
      providerRequestId: openCodeRequest.request.id,
      providerToolUseId: pendingApproval.toolUseId,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    ctx.status = "awaiting_approval";
    ctx.currentInterruptId = interrupt.id;

    if (ctx.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "awaiting_approval" })
        .where(eq(coworkerRun.id, ctx.coworkerRunId));
    }
    this.broadcast(ctx, this.projectInterruptPendingEvent(interrupt));

    const resolved = await this.waitForOpenCodeApprovalDecision(
      interrupt.id,
      this.getApprovalHotWaitMs(ctx),
    );
    if (!resolved) {
      return await this.parkGenerationForInterrupt(ctx, interrupt);
    }

    await this.applyOpenCodeApprovalDecision(
      ctx,
      interrupt.id,
      resolved.decision,
      resolved.questionAnswers,
      _client,
    );
  }

  private async rejectOpenCodePendingApprovalRequest(
    ctx: GenerationContext,
    liveClient?: ApprovalCapableClient,
  ): Promise<void> {
    const interruptId = ctx.currentInterruptId;
    if (!interruptId) {
      return;
    }
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    const requestKind =
      interrupt?.kind === "runtime_permission"
        ? "permission"
        : interrupt?.kind === "runtime_question"
          ? "question"
          : undefined;
    const requestId = interrupt?.providerRequestId;
    if (!requestKind || !requestId) {
      return;
    }

    let opencodeClient = liveClient;
    if (!opencodeClient) {
      const slotStatus = await this.waitForSandboxSlotLease(ctx);
      if (slotStatus === "requeued") {
        return;
      }
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });
      const resumedSession = await getOrCreateConversationRuntime(
        {
          conversationId: ctx.conversationId,
          generationId: ctx.id,
          userId: ctx.userId,
          model: ctx.model,
          openAIAuthSource: ctx.authSource,
          anthropicApiKey: env.ANTHROPIC_API_KEY || "",
          integrationEnvs: {},
        },
        {
          sandboxProviderOverride: ctx.sandboxProviderOverride,
          title: conv?.title || "Conversation",
          replayHistory: false,
          allowSnapshotRestore: false,
        },
      );
      opencodeClient = resumedSession.harnessClient;
    }

    if (requestKind === "permission") {
      await this.replyPermissionRequest(opencodeClient, {
        requestID: requestId,
        reply: "reject",
      });
      return;
    }
    await this.rejectQuestionRequest(opencodeClient, {
      requestID: requestId,
    });
  }

  private async waitForOpenCodeApprovalDecision(
    interruptId: string,
    maxWaitMs: number,
  ): Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null> {
    const deadlineMs = Date.now() + maxWaitMs;
    while (true) {
      if (Date.now() >= deadlineMs) {
        return null;
      }
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      const latest = await generationInterruptService.getInterrupt(interruptId);
      if (!latest) {
        return { decision: "deny" };
      }

      const expiresAtMs = resolveExpiryMs(
        latest.expiresAt?.toISOString(),
        latest.requestedAt.toISOString(),
        APPROVAL_TIMEOUT_MS,
      );
      if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
        return null;
      }

      if (latest.status === "accepted") {
        return {
          decision: "allow",
          questionAnswers: latest.responsePayload?.questionAnswers,
        };
      }
      if (
        latest.status === "rejected" ||
        latest.status === "cancelled" ||
        latest.status === "expired"
      ) {
        return { decision: "deny" };
      }
    }
  }

  private async applyOpenCodeApprovalDecision(
    ctx: GenerationContext,
    interruptId: string,
    decision: "allow" | "deny",
    questionAnswers?: string[][],
    liveClient?: ApprovalCapableClient,
  ): Promise<void> {
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    const toolUseId = interrupt?.providerToolUseId ?? `opencode-${ctx.id}`;
    const requestKind =
      interrupt?.kind === "runtime_permission"
        ? "permission"
        : interrupt?.kind === "runtime_question"
          ? "question"
          : undefined;
    const requestId = interrupt?.providerRequestId;
    if (!requestKind || !requestId) {
      return;
    }

    let opencodeClient = liveClient;
    let defaultAnswers = interrupt?.display.questionSpec?.questions.map((question) => [
      question.options[0]?.label ?? "default answer",
    ]) ?? [[]];
    if (!opencodeClient) {
      const slotStatus = await this.waitForSandboxSlotLease(ctx);
      if (slotStatus === "requeued") {
        return;
      }
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });
      const resumedSession = await getOrCreateConversationRuntime(
        {
          conversationId: ctx.conversationId,
          generationId: ctx.id,
          userId: ctx.userId,
          model: ctx.model,
          openAIAuthSource: ctx.authSource,
          anthropicApiKey: env.ANTHROPIC_API_KEY || "",
          integrationEnvs: {},
        },
        {
          sandboxProviderOverride: ctx.sandboxProviderOverride,
          title: conv?.title || "Conversation",
          replayHistory: false,
          allowSnapshotRestore: false,
        },
      );
      opencodeClient = resumedSession.harnessClient;
    }

    if (requestKind === "permission") {
      await this.replyPermissionRequest(opencodeClient, {
        requestID: requestId,
        reply: decision === "allow" ? "always" : "reject",
      });
    } else if (requestKind === "question") {
      if (decision === "allow") {
        await this.replyQuestionRequest(opencodeClient, {
          requestID: requestId,
          answers: questionAnswers && questionAnswers.length > 0 ? questionAnswers : defaultAnswers,
        });
      } else {
        await this.rejectQuestionRequest(opencodeClient, {
          requestID: requestId,
        });
      }
    }

    const normalizedQuestionAnswers =
      questionAnswers
        ?.map((answers) =>
          answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
        )
        .filter((answers) => answers.length > 0) ?? [];
    const resolvedQuestionAnswers =
      decision === "allow"
        ? normalizedQuestionAnswers.length > 0
          ? normalizedQuestionAnswers
          : defaultAnswers
        : undefined;
    const approvalStatus = decision === "allow" ? "approved" : "denied";
    const existingApprovalIndex = ctx.contentParts.findIndex(
      (part): part is ContentPart & { type: "approval" } =>
        part.type === "approval" && part.tool_use_id === toolUseId,
    );
    const approvalPart: ContentPart = {
      type: "approval",
      tool_use_id: toolUseId,
      tool_name: interrupt?.display.title ?? "question",
      tool_input: interrupt?.display.toolInput ?? {},
      integration: interrupt?.display.integration ?? "opencode",
      operation: interrupt?.display.operation ?? "question",
      command: interrupt?.display.command,
      status: approvalStatus,
      question_answers: resolvedQuestionAnswers,
    };
    if (existingApprovalIndex >= 0) {
      ctx.contentParts[existingApprovalIndex] = approvalPart;
    } else {
      ctx.contentParts.push(approvalPart);
    }

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId,
      status: decision === "allow" ? "accepted" : "rejected",
      responsePayload:
        decision === "allow" ? { questionAnswers: resolvedQuestionAnswers } : undefined,
    });

    await db
      .update(generation)
      .set({
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
      })
      .where(eq(generation.id, ctx.id));

    if (ctx.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, ctx.coworkerRunId));
    }

    ctx.currentInterruptId = undefined;
    ctx.status = "running";
    if (resolvedInterrupt) {
      this.broadcast(ctx, this.projectInterruptResolvedEvent(resolvedInterrupt));
    }
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
  }

  private async applyResolvedInterruptToRuntime(
    ctx: GenerationContext,
    interruptId: string,
    runtimeClient: RuntimeHarnessClient,
  ): Promise<void> {
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    if (!interrupt) {
      throw new Error(`Resume interrupt ${interruptId} was not found`);
    }
    if (interrupt.status === "pending") {
      throw new Error(`Resume interrupt ${interruptId} is still pending`);
    }

    if (interrupt.provider === "opencode") {
      await this.applyOpenCodeApprovalDecision(
        ctx,
        interrupt.id,
        interrupt.status === "accepted" ? "allow" : "deny",
        interrupt.responsePayload?.questionAnswers,
        runtimeClient,
      );
      await generationInterruptService.markInterruptApplied(interrupt.id);
    } else {
      const resolvedEvent = this.projectInterruptResolvedEvent(interrupt);
      this.broadcast(ctx, resolvedEvent);
    }

    ctx.resumeInterruptId = null;
    ctx.currentInterruptId = undefined;
    await db
      .update(generation)
      .set({
        resumeInterruptId: null,
        suspendedAt: null,
      })
      .where(eq(generation.id, ctx.id));
  }

  /**
   * Process tracked OpenCode SSE events and transform them to GenerationEvent
   */
  private async processOpencodeEvent(
    ctx: GenerationContext,
    event: OpenCodeTrackedEvent,
    currentTextPart: { type: "text"; text: string } | null,
    currentTextPartId: string | null,
    setCurrentTextPart: (
      part: { type: "text"; text: string } | null,
      partId: string | null,
    ) => void,
  ): Promise<void> {
    switch (event.type) {
      case "message.updated": {
        const messageId = event.properties.info.id;
        const role = event.properties.info.role;

        if (messageId && role) {
          ctx.messageRoles.set(messageId, role);
        }

        if (messageId && role === "assistant") {
          ctx.assistantMessageIds.add(messageId);
          const pendingQueue = ctx.pendingMessageParts.get(messageId);
          if (pendingQueue && pendingQueue.parts.length > 0) {
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
            ctx.pendingMessageParts.delete(messageId);
            let replayTextPart = currentTextPart;
            let replayTextPartId = currentTextPartId;
            const replaySetCurrentTextPart = (
              part: { type: "text"; text: string } | null,
              partId: string | null,
            ) => {
              replayTextPart = part;
              replayTextPartId = partId;
              setCurrentTextPart(part, partId);
            };
            await Promise.all(
              pendingQueue.parts.map(async (pendingPart) => {
                await this.processOpencodeMessagePart(
                  ctx,
                  pendingPart,
                  replayTextPart,
                  replayTextPartId,
                  replaySetCurrentTextPart,
                );
              }),
            );
          }
        }
        break;
      }

      case "message.part.updated": {
        const part = event.properties.part;
        const messageID = part.messageID;
        this.pruneStalePendingMessageParts(ctx);

        if (messageID) {
          const role = ctx.messageRoles.get(messageID);
          if (role === "user") {
            return;
          }
          if (role !== "assistant") {
            // Preserve live streaming: process likely assistant parts immediately.
            // Queue only parts that strongly look like user-echo updates.
            if (!this.shouldProcessUnknownMessagePart(ctx, part)) {
              const now = Date.now();
              const existing = ctx.pendingMessageParts.get(messageID);
              const resetQueue =
                !existing || now - existing.firstQueuedAtMs > PENDING_MESSAGE_PARTS_TTL_MS;
              const parts = resetQueue ? [] : [...existing.parts];
              if (parts.length >= PENDING_MESSAGE_PARTS_MAX_PER_MESSAGE) {
                parts.shift();
              }
              parts.push(part);
              ctx.pendingMessageParts.set(messageID, {
                firstQueuedAtMs: resetQueue ? now : existing.firstQueuedAtMs,
                parts,
              });
              return;
            }
          }
        }

        await this.processOpencodeMessagePart(
          ctx,
          part,
          currentTextPart,
          currentTextPartId,
          setCurrentTextPart,
        );
        break;
      }

      case "session.updated": {
        // Track session metadata if needed
        ctx.sessionId = event.properties.info.id;
        break;
      }

      case "session.status": {
        // Can track status changes if needed
        break;
      }
      default:
        return assertNever(event);
    }
  }

  private shouldProcessUnknownMessagePart(ctx: GenerationContext, part: RuntimePart): boolean {
    if (part.type === "tool") {
      return true;
    }

    if (part.type !== "text") {
      return true;
    }

    const fullText = part.text.trim();
    const userText = ctx.userMessageContent.trim();
    if (!fullText) {
      return false;
    }

    // Guard against replaying user input text as assistant output.
    if (userText === fullText || userText.startsWith(fullText) || fullText.startsWith(userText)) {
      return false;
    }

    return true;
  }

  private async processOpencodeMessagePart(
    ctx: GenerationContext,
    part: RuntimePart,
    currentTextPart: { type: "text"; text: string } | null,
    currentTextPartId: string | null,
    setCurrentTextPart: (
      part: { type: "text"; text: string } | null,
      partId: string | null,
    ) => void,
  ): Promise<void> {
    const partId = part.id;

    // Text content
    // NOTE: OpenCode sends the FULL cumulative text with each update, not deltas
    // We need to calculate the delta ourselves
    if (part.type === "text") {
      const fullText = part.text;
      if (fullText) {
        // Check if this is a new text part (different part ID)
        const isNewPart = partId !== currentTextPartId;
        const userText = ctx.userMessageContent.trim();
        const normalizedUserText = userText.trim().replace(/\s+/g, " ");
        let effectiveFullText = fullText;

        const dropEchoPrefix = (value: string): string => {
          let next = value;
          // Common wrappers seen in compatibility streams.
          next = next.replace(/^\s*(?:user|human)\s*:\s*/i, "");
          next = next.replace(/^\s*["'`]+/, "");
          if (userText && next.startsWith(userText)) {
            return next.slice(userText.length).trimStart();
          }
          return value;
        };

        if (isNewPart && userText) {
          const normalizedFullText = fullText.trim().replace(/\s+/g, " ");
          // Ignore pure user-echo parts.
          if (normalizedFullText === normalizedUserText) {
            return;
          }
          effectiveFullText = dropEchoPrefix(fullText);
        }

        // Calculate delta from the previous text
        const previousLength = isNewPart ? 0 : (currentTextPart?.text.length ?? 0);
        const delta = effectiveFullText.slice(previousLength);

        // Only process if there's new content
        if (delta) {
          if (!ctx.phaseMarks?.first_visible_output_emitted) {
            this.markPhase(ctx, "first_visible_output_emitted");
          }
          if (!ctx.phaseMarks?.first_token_emitted) {
            this.markPhase(ctx, "first_token_emitted");
          }
          ctx.assistantContent += delta;
          this.broadcast(ctx, { type: "text", content: delta });

          if (currentTextPart && !isNewPart) {
            // Update to the full cumulative text
            currentTextPart.text = effectiveFullText;
          } else {
            // New text part - create a new entry
            const newPart = { type: "text" as const, text: effectiveFullText };
            ctx.contentParts.push(newPart);
            setCurrentTextPart(newPart, partId);
          }
          this.scheduleSave(ctx);
        }
      }
    }

    // Reasoning content ("internal thoughts") from OpenCode.
    // OpenCode updates this part cumulatively, so emit only the delta while
    // persisting the full content for replay/history.
    if (part.type === "reasoning") {
      setCurrentTextPart(null, null);
      const fullReasoning = part.text ?? "";
      const existingThinking = ctx.contentParts.find(
        (p): p is ContentPart & { type: "thinking" } => p.type === "thinking" && p.id === partId,
      );

      const previousReasoning = existingThinking?.content ?? "";
      const delta = fullReasoning.startsWith(previousReasoning)
        ? fullReasoning.slice(previousReasoning.length)
        : fullReasoning;

      if (existingThinking) {
        existingThinking.content = fullReasoning;
      } else {
        ctx.contentParts.push({
          type: "thinking",
          id: partId,
          content: fullReasoning,
        });
      }

      if (delta) {
        if (!ctx.phaseMarks?.first_visible_output_emitted) {
          this.markPhase(ctx, "first_visible_output_emitted");
        }
        this.broadcast(ctx, {
          type: "thinking",
          content: delta,
          thinkingId: partId,
        });
      }

      this.scheduleSave(ctx);
      return;
    }

    // Tool call (OpenCode uses "tool" type with callID, tool, and state properties)
    // See @opencode-ai/sdk ToolPart type: state contains input/output
    // Status flow: pending (no input) -> running (has input) -> completed (has output)
    if (part.type === "tool") {
      setCurrentTextPart(null, null);
      const toolUseId = part.callID;
      const toolName = part.tool;
      const toolInput = "input" in part.state ? (part.state.input as Record<string, unknown>) : {};
      if (part.messageID) {
        ctx.openCodeRuntimeTools ??= new Map();
        ctx.openCodeRuntimeTools.set(toolUseId, {
          sessionId: ctx.sessionId,
          messageId: part.messageID,
          partId: part.id,
          callId: toolUseId,
          toolName,
          input: toolInput,
        });
      }
      const metadata = this.getToolUseMetadata(toolName, toolInput);

      const existingToolUse = ctx.contentParts.find(
        (p): p is ContentPart & { type: "tool_use" } => p.type === "tool_use" && p.id === toolUseId,
      );

      switch (part.state.status) {
        case "pending":
          return;
        case "running": {
          if (existingToolUse) {
            return;
          }

          this.broadcast(ctx, {
            type: "tool_use",
            toolName,
            toolInput,
            toolUseId,
            integration: metadata.integration,
            operation: metadata.operation,
            isWrite: metadata.isWrite,
          });

          ctx.contentParts.push({
            type: "tool_use",
            id: toolUseId,
            name: toolName,
            input: toolInput,
            integration: metadata.integration,
            operation: metadata.operation,
          });
          await this.saveProgress(ctx);
          return;
        }
        case "completed": {
          if (!existingToolUse) {
            return;
          }
          if (
            ctx.contentParts.some(
              (contentPart): contentPart is ContentPart & { type: "tool_result" } =>
                contentPart.type === "tool_result" && contentPart.tool_use_id === toolUseId,
            )
          ) {
            return;
          }
          const result = limitToolResultContent(part.state.output);
          this.broadcast(ctx, {
            type: "tool_result",
            toolName: existingToolUse.name,
            result,
            toolUseId,
          });
          ctx.contentParts.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: result,
          });
          const coworkerInvocation = parseCoworkerInvocationEnvelope({
            toolName: existingToolUse.name,
            toolInput: existingToolUse.input,
            toolResult: result,
          });
          if (coworkerInvocation) {
            ctx.contentParts.push({
              type: "coworker_invocation",
              coworker_id: coworkerInvocation.coworkerId,
              username: coworkerInvocation.username,
              name: coworkerInvocation.name,
              run_id: coworkerInvocation.runId,
              conversation_id: coworkerInvocation.conversationId,
              generation_id: coworkerInvocation.generationId,
              status: coworkerInvocation.status,
              attachment_names: coworkerInvocation.attachmentNames,
              message: coworkerInvocation.message,
            });
          }
          const coworkerEditApply = parseCoworkerEditApplyEnvelope({
            toolName: existingToolUse.name,
            toolInput: existingToolUse.input,
            toolResult: result,
          });
          if (coworkerEditApply) {
            this.applyCoworkerEditEnvelope(ctx, coworkerEditApply);
          }
          await this.saveProgress(ctx);
          return;
        }
        case "error": {
          if (!existingToolUse) {
            return;
          }
          if (
            ctx.contentParts.some(
              (contentPart): contentPart is ContentPart & { type: "tool_result" } =>
                contentPart.type === "tool_result" && contentPart.tool_use_id === toolUseId,
            )
          ) {
            return;
          }
          const result = limitToolResultContent({ error: part.state.error });
          this.broadcast(ctx, {
            type: "tool_result",
            toolName: existingToolUse.name,
            result,
            toolUseId,
          });
          ctx.contentParts.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: result,
          });
          await this.saveProgress(ctx);
          return;
        }
        default:
          return assertNever(part.state);
      }
    }
  }

  private async importIntegrationSkillDraftsFromSandbox(
    ctx: GenerationContext,
    sandbox: SandboxBackend,
  ): Promise<void> {
    const findResult = await sandbox.execute(
      `find /app/.opencode/integration-skill-drafts -maxdepth 1 -type f -name '*.json' 2>/dev/null | head -20`,
    );
    const paths = findResult.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    await Promise.all(
      paths.map(async (filePath) => {
        try {
          const content = await sandbox.readFile(filePath);
          const created = await this.importIntegrationSkillDraftContent(ctx, content);
          if (created > 0) {
            await sandbox.execute(`rm -f "${filePath}"`);
          }
        } catch (error) {
          console.error(
            `[GenerationManager] Failed to import integration skill draft ${filePath}:`,
            error,
          );
        }
      }),
    );
  }

  private async importIntegrationSkillDraftContent(
    ctx: GenerationContext,
    rawContent: string,
  ): Promise<number> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return 0;
    }

    const drafts = Array.isArray(parsed) ? parsed : [parsed];
    let createdCount = 0;

    const creationResults = await Promise.all(
      drafts.map(async (draft) => {
        if (!draft || typeof draft !== "object") {
          return 0;
        }
        const rec = draft as Record<string, unknown>;
        const slug = typeof rec.slug === "string" ? rec.slug : "";
        const title = typeof rec.title === "string" ? rec.title : "";
        const description = typeof rec.description === "string" ? rec.description : "";
        if (!slug || !title || !description) {
          return 0;
        }

        const files = Array.isArray(rec.files)
          ? rec.files
              .map((entry) => {
                if (!entry || typeof entry !== "object") {
                  return null;
                }
                const e = entry as Record<string, unknown>;
                if (typeof e.path !== "string" || typeof e.content !== "string") {
                  return null;
                }
                return { path: e.path, content: e.content };
              })
              .filter((entry): entry is { path: string; content: string } => !!entry)
          : [];

        try {
          await createCommunityIntegrationSkill(ctx.userId, {
            slug,
            title,
            description,
            files,
            setAsPreferred: rec.setAsPreferred === true,
          });
          return 1;
        } catch (error) {
          console.warn(
            `[GenerationManager] Skipped integration skill draft for slug '${slug}':`,
            error instanceof Error ? error.message : error,
          );
          return 0;
        }
      }),
    );
    createdCount = creationResults.reduce<number>((sum, value) => sum + value, 0);

    return createdCount;
  }

  private getToolUseMetadata(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): ToolUseMetadata {
    if (toolName.toLowerCase() !== "bash") {
      return {};
    }

    const command = toolInput.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      return {};
    }

    const parsed = parseBashCommand(command);
    if (!parsed) {
      return {};
    }

    return {
      integration: parsed.integration,
      operation: parsed.operation,
      isWrite: parsed.isWrite,
    };
  }

  private async forEachSequential<T>(
    items: readonly T[],
    handler: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    for (const [index, item] of items.entries()) {
      // eslint-disable-next-line no-await-in-loop -- sequential ordering is required
      await handler(item, index);
    }
  }

  private async consumeAsyncStream<T>(
    stream: AsyncIterable<T>,
    onEvent: (event: T) => Promise<boolean | void>,
  ): Promise<void> {
    for await (const event of stream) {
      const shouldStop = await onEvent(event);
      if (shouldStop) {
        break;
      }
    }
  }

  private async handleApprovalTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_approval" || !ctx.currentInterruptId) {
      return;
    }

    console.log(`[GenerationManager] Approval timeout for generation ${ctx.id}, failing run`);
    this.setCompletionReason(ctx, "approval_timeout");
    if (!ctx.errorMessage) {
      ctx.errorMessage = "Approval request expired before the run could continue.";
    }
    await generationInterruptService.resolveInterrupt({
      interruptId: ctx.currentInterruptId,
      status: "expired",
    });
    ctx.currentInterruptId = undefined;
    await this.finishGeneration(ctx, "error");
  }

  private async handleAuthTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_auth" || !ctx.currentInterruptId) {
      return;
    }

    console.log(`[GenerationManager] Auth timeout for generation ${ctx.id}, failing run`);
    this.setCompletionReason(ctx, "auth_timeout");
    if (!ctx.errorMessage) {
      ctx.errorMessage = "Authentication request expired before the run could continue.";
    }
    await generationInterruptService.resolveInterrupt({
      interruptId: ctx.currentInterruptId,
      status: "expired",
    });
    ctx.currentInterruptId = undefined;
    await this.finishGeneration(ctx, "error");
  }

  /**
   * Submit an auth result (called after OAuth completes)
   */
  async submitAuthResult(
    generationId: string,
    integration: string,
    success: boolean,
    userId: string,
  ): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });

    if (!genRecord) {
      return false;
    }

    const recordUserId = genRecord.conversation.userId;
    if (recordUserId !== userId) {
      throw new Error("Access denied");
    }

    const pendingInterrupt = await generationInterruptService.findPendingAuthInterruptByIntegration(
      {
        generationId,
        integration,
      },
    );
    if (!pendingInterrupt) {
      return false;
    }

    const conversationId = genRecord.conversationId;
    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    await this.touchConversationLastUserVisibleAction(conversationId);

    if (!success) {
      await generationInterruptService.resolveInterrupt({
        interruptId: pendingInterrupt.id,
        status: "cancelled",
        responsePayload: { integration },
        resolvedByUserId: userId,
      });
      await db
        .update(generation)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(eq(generation.id, generationId));

      await db
        .update(conversation)
        .set({ generationStatus: "idle" })
        .where(eq(conversation.id, conversationId));

      await this.enqueueConversationQueuedMessageProcess(conversationId);

      if (linkedCoworkerRun?.id) {
        await db
          .update(coworkerRun)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(eq(coworkerRun.id, linkedCoworkerRun.id));
      }

      return true;
    }

    const resolvedInterrupt = await generationInterruptService.resolveInterrupt({
      interruptId: pendingInterrupt.id,
      status: "accepted",
      responsePayload: {
        connectedIntegrations: [integration],
        integration,
      },
      resolvedByUserId: userId,
    });

    if (genRecord.status === "paused") {
      if (linkedCoworkerRun?.id) {
        await db
          .update(coworkerRun)
          .set({ status: "running" })
          .where(eq(coworkerRun.id, linkedCoworkerRun.id));
      }
      const activeCtx = this.activeGenerations.get(generationId);
      if (activeCtx && resolvedInterrupt) {
        if (activeCtx.currentInterruptId === resolvedInterrupt.id) {
          activeCtx.currentInterruptId = undefined;
        }
        if (activeCtx.approvalParkTimeoutId) {
          clearTimeout(activeCtx.approvalParkTimeoutId);
          activeCtx.approvalParkTimeoutId = undefined;
        }
        this.broadcast(activeCtx, this.projectInterruptResolvedEvent(resolvedInterrupt));
      }
      return this.resumeGeneration(generationId, userId);
    }

    const activeCtx = this.activeGenerations.get(generationId);
    if (!activeCtx && resolvedInterrupt) {
      await this.enqueueResolvedInterruptResume({
        generationId,
        conversationId,
        interrupt: resolvedInterrupt,
        runType: linkedCoworkerRun?.id ? "coworker" : "chat",
        coworkerRunId: linkedCoworkerRun?.id,
        remainingRunMs: genRecord.remainingRunMs,
      });
      return true;
    }

    await db
      .update(generation)
      .set({
        status: "running",
        pendingAuth: null,
        isPaused: false,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date(),
      })
      .where(eq(conversation.id, conversationId));

    if (linkedCoworkerRun?.id) {
      await db
        .update(coworkerRun)
        .set({ status: "running" })
        .where(eq(coworkerRun.id, linkedCoworkerRun.id));
    }

    if (activeCtx && resolvedInterrupt) {
      activeCtx.status = "running";
      if (activeCtx.currentInterruptId === resolvedInterrupt.id) {
        activeCtx.currentInterruptId = undefined;
      }
      if (activeCtx.approvalParkTimeoutId) {
        clearTimeout(activeCtx.approvalParkTimeoutId);
        activeCtx.approvalParkTimeoutId = undefined;
      }
      this.broadcast(activeCtx, this.projectInterruptResolvedEvent(resolvedInterrupt));
    }

    return true;
  }

  async submitAuthResultByInterrupt(
    interruptId: string,
    integration: string,
    success: boolean,
    userId: string,
  ): Promise<boolean> {
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    if (!interrupt || interrupt.kind !== "auth" || interrupt.status !== "pending") {
      return false;
    }

    return this.submitAuthResult(interrupt.generationId, integration, success, userId);
  }

  /**
   * Wait for user approval on a write operation (called by internal router from plugin).
   * This creates a pending approval request and waits for the user to respond.
   */
  async waitForApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
    },
  ): Promise<"allow" | "deny"> {
    const approvalRequest = await this.requestPluginApproval(generationId, request);
    if (approvalRequest.decision !== "pending") {
      return approvalRequest.decision;
    }
    if (!approvalRequest.toolUseId || !approvalRequest.interruptId) {
      return "deny";
    }

    let resolved: "allow" | "deny" | null = null;
    while (resolved === null) {
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      // eslint-disable-next-line no-await-in-loop -- polling by design
      const status = await this.getPluginApprovalStatus(generationId, approvalRequest.interruptId);
      if (status !== "pending") {
        resolved = status;
      }
    }

    if (resolved) {
      return resolved;
    }
    return "deny";
  }

  async requestPluginApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
      providerRequestId?: string;
      runtimeTool?: OpenCodeRuntimeToolRef;
    },
  ): Promise<{
    decision: "allow" | "deny" | "pending";
    toolUseId?: string;
    interruptId?: string;
    expiresAt?: string;
  }> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return { decision: "deny" };
    }
    if (!genRecord.runtimeId) {
      return { decision: "deny" };
    }

    const policy = this.getExecutionPolicyFromRecord(genRecord, genRecord.conversation.autoApprove);
    if (policy.autoApprove ?? genRecord.conversation.autoApprove) {
      return { decision: "allow" };
    }
    const runtimeRecord = await conversationRuntimeService.getRuntime(genRecord.runtimeId);
    if (!runtimeRecord) {
      return { decision: "deny" };
    }

    const providerRequestId =
      request.providerRequestId ??
      `plugin-write:${runtimeRecord.id}:${runtimeRecord.activeTurnSeq}:${hashStableProviderRequestPayload(
        {
          integration: request.integration,
          operation: request.operation,
          command: request.command,
        },
      )}`;
    const existing = await generationInterruptService.findInterruptByProviderRequestId({
      generationId,
      providerRequestId,
    });
    if (existing) {
      if (existing.status === "accepted") {
        await generationInterruptService.markInterruptApplied(existing.id);
        return { decision: "allow" };
      }
      if (existing.status === "pending") {
        return {
          decision: "pending",
          toolUseId: existing.providerToolUseId,
          interruptId: existing.id,
          expiresAt: existing.expiresAt?.toISOString(),
        };
      }
      return { decision: "deny" };
    }

    const toolUseId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const activeCtx = this.activeGenerations.get(generationId);
    const runtimeTool = getRuntimeToolRefForInterrupt(activeCtx, {
      providerRequestId,
      runtimeTool: request.runtimeTool,
      command: request.command,
    });
    const interrupt = await generationInterruptService.createInterrupt({
      generationId,
      runtimeId: runtimeRecord.id,
      conversationId: genRecord.conversationId,
      turnSeq: runtimeRecord.activeTurnSeq,
      kind: "plugin_write",
      display: {
        title: "Bash",
        integration: request.integration,
        operation: request.operation,
        command: request.command,
        toolInput: request.toolInput,
        runtimeTool,
      },
      provider: "plugin",
      providerRequestId,
      providerToolUseId: toolUseId,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    const pendingApprovalEvent = this.projectInterruptPendingEvent(interrupt);

    if (activeCtx) {
      activeCtx.status = "awaiting_approval";
      activeCtx.currentInterruptId = interrupt.id;
      this.broadcast(activeCtx, pendingApprovalEvent);
      // Snapshot only when the generation is actually parked. Exporting the full
      // runtime session inline here duplicates that work and can blow up the dev
      // server heap for large sessions while this request is still open.
      this.scheduleApprovalPark(activeCtx, interrupt);
    } else {
      await this.publishDetachedGenerationStreamEvent({
        generationId,
        conversationId: genRecord.conversationId,
        event: pendingApprovalEvent,
      });
    }

    return {
      decision: "pending",
      toolUseId,
      interruptId: interrupt.id,
      expiresAt: interrupt.expiresAt?.toISOString(),
    };
  }

  async requestAuthInterrupt(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<
    { interruptId: string; status: "pending"; expiresAt?: string } | { status: "accepted" }
  > {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return { status: "accepted" };
    }
    if (!genRecord.runtimeId) {
      return { status: "accepted" };
    }

    const existing = await generationInterruptService.findPendingAuthInterruptByIntegration({
      generationId,
      integration: request.integration,
    });
    if (existing) {
      return {
        interruptId: existing.id,
        status: "pending",
        expiresAt: existing.expiresAt?.toISOString(),
      };
    }
    const runtimeRecord = await conversationRuntimeService.getRuntime(genRecord.runtimeId);
    if (!runtimeRecord) {
      return { status: "accepted" };
    }

    const interrupt = await generationInterruptService.createInterrupt({
      generationId,
      runtimeId: runtimeRecord.id,
      conversationId: genRecord.conversationId,
      turnSeq: runtimeRecord.activeTurnSeq,
      kind: "auth",
      display: {
        title: "Connection Required",
        authSpec: {
          integrations: [request.integration],
          reason: request.reason,
        },
      },
      provider: "plugin",
      providerToolUseId: `auth-${Date.now()}-${request.integration}`,
      expiresAt: computeParkedInterruptExpiryDate(),
    });

    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    if (linkedCoworkerRun?.id) {
      await db
        .update(coworkerRun)
        .set({ status: "awaiting_auth" })
        .where(eq(coworkerRun.id, linkedCoworkerRun.id));
    }

    const activeCtx = this.activeGenerations.get(generationId);
    if (activeCtx) {
      activeCtx.status = "awaiting_auth";
      activeCtx.currentInterruptId = interrupt.id;
      this.broadcast(activeCtx, this.projectInterruptPendingEvent(interrupt));
      // Snapshot only when the generation is actually parked. Exporting the full
      // runtime session inline here duplicates that work and can blow up the dev
      // server heap for large sessions while this request is still open.
      this.scheduleApprovalPark(activeCtx, interrupt);
    } else {
      await this.publishDetachedGenerationStreamEvent({
        generationId,
        conversationId: genRecord.conversationId,
        event: this.projectInterruptPendingEvent(interrupt),
      });
    }
    return { interruptId: interrupt.id, status: "pending" };
  }

  async getPluginApprovalStatus(
    generationId: string,
    interruptId: string,
  ): Promise<"pending" | "allow" | "deny"> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });
    const interrupt = await generationInterruptService.getInterrupt(interruptId);
    if (!genRecord || !interrupt || interrupt.generationId !== generationId) {
      return "deny";
    }

    if (interrupt.status === "pending") {
      if (interrupt.expiresAt) {
        const expiresAtMs = Date.parse(interrupt.expiresAt.toISOString());
        if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
          await this.processGenerationTimeout(generationId, "approval");
          return "deny";
        }
      }
      return "pending";
    }

    const resolvedDecision = interrupt.status === "accepted" ? "allow" : "deny";
    const approvalPart: ContentPart = {
      type: "approval",
      tool_use_id: interrupt.providerToolUseId,
      tool_name: interrupt.display.title,
      tool_input: interrupt.display.toolInput ?? {},
      integration: interrupt.display.integration ?? "plugin",
      operation: interrupt.display.operation ?? "unknown",
      command: interrupt.display.command,
      status: resolvedDecision === "allow" ? "approved" : "denied",
      question_answers: interrupt.responsePayload?.questionAnswers,
    };

    const activeCtx = this.activeGenerations.get(generationId);
    const baseContentParts =
      activeCtx?.contentParts ?? (genRecord.contentParts as ContentPart[] | null) ?? [];
    const nextContentParts = [...baseContentParts];
    const existingApprovalIndex = nextContentParts.findIndex(
      (part): part is ContentPart & { type: "approval" } =>
        part.type === "approval" && part.tool_use_id === interrupt.providerToolUseId,
    );
    if (existingApprovalIndex >= 0) {
      nextContentParts[existingApprovalIndex] = approvalPart;
    } else {
      nextContentParts.push(approvalPart);
    }
    if (activeCtx) {
      activeCtx.contentParts = nextContentParts;
      activeCtx.status = "running";
    }

    await db
      .update(generation)
      .set({
        contentParts: nextContentParts.length > 0 ? nextContentParts : null,
      })
      .where(eq(generation.id, generationId));

    if (activeCtx) {
      this.broadcast(activeCtx, this.projectInterruptResolvedEvent(interrupt));
      if (activeCtx.approvalParkTimeoutId) {
        clearTimeout(activeCtx.approvalParkTimeoutId);
        activeCtx.approvalParkTimeoutId = undefined;
      }
    }
    if (resolvedDecision === "allow") {
      await generationInterruptService.markInterruptApplied(interrupt.id);
    }

    return resolvedDecision;
  }

  /**
   * Wait for OAuth authentication (called by internal router from plugin).
   * This creates a pending auth request and waits for the OAuth flow to complete.
   */
  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; userId?: string }> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return { success: false };
    }

    const authRequest = await this.requestAuthInterrupt(generationId, request);
    if (authRequest.status === "accepted") {
      return genRecord.conversation.userId
        ? { success: true, userId: genRecord.conversation.userId }
        : { success: false };
    }
    const interrupt = await generationInterruptService.getInterrupt(authRequest.interruptId);
    if (!interrupt) {
      return { success: false };
    }
    const expiresAt = authRequest.expiresAt;

    let resolved: { success: boolean; userId?: string } | null = null;
    while (resolved === null) {
      if (expiresAt && Date.now() >= Date.parse(expiresAt)) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));

      // eslint-disable-next-line no-await-in-loop -- polling by design
      const latest = await generationInterruptService.getInterrupt(interrupt.id);
      if (!latest) {
        resolved = { success: false };
        break;
      }
      if (latest.status === "accepted") {
        resolved = genRecord.conversation.userId
          ? { success: true, userId: genRecord.conversation.userId }
          : { success: false };
        break;
      }
      if (
        latest.status === "rejected" ||
        latest.status === "expired" ||
        latest.status === "cancelled"
      ) {
        resolved = { success: false };
        break;
      }
    }

    if (resolved) {
      return resolved;
    }
    return { success: false };
  }

  private async saveSessionSnapshotIfPossible(
    ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
    reason: string,
  ): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      return;
    }

    try {
      await this.saveSessionSnapshot(ctx);
    } catch (error) {
      console.error(
        `[GenerationManager] Failed to save session snapshot (${reason}) for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async saveSessionSnapshot(
    ctx: Pick<GenerationContext, "conversationId" | "sessionId" | "sandbox">,
  ): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      throw new Error(
        `Cannot snapshot conversation ${ctx.conversationId}: missing runtime session`,
      );
    }

    await saveConversationSessionSnapshot({
      conversationId: ctx.conversationId,
      sessionId: ctx.sessionId,
      sandbox: {
        exec: (command, opts) =>
          ctx.sandbox!.execute(command, {
            timeout: opts?.timeoutMs,
            env: opts?.env,
          }),
        writeFile: (path, content) =>
          ctx.sandbox!.writeFile(
            path,
            typeof content === "string" ? content : new Uint8Array(content),
          ),
      },
    });
  }

  private async awaitPromiseUntilRunDeadline<T>(
    ctx: Pick<GenerationContext, "deadlineAt">,
    promise: Promise<T>,
  ): Promise<{ type: "resolved"; value: T } | { type: "timed_out" }> {
    const remainingRunTimeMs = this.getRemainingRunTimeMs(ctx);
    if (remainingRunTimeMs <= 0) {
      return { type: "timed_out" };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then((value) => ({ type: "resolved" as const, value })),
        new Promise<{ type: "timed_out" }>((resolve) => {
          timeoutId = setTimeout(() => resolve({ type: "timed_out" }), remainingRunTimeMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async awaitWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<{ type: "resolved"; value: T } | { type: "timed_out" }> {
    if (timeoutMs <= 0) {
      return { type: "timed_out" };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then((value) => ({ type: "resolved" as const, value })),
        new Promise<{ type: "timed_out" }>((resolve) => {
          timeoutId = setTimeout(() => resolve({ type: "timed_out" }), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async abortRuntimeForRunDeadlinePark(
    ctx: Pick<GenerationContext, "id" | "conversationId" | "sessionId">,
    runtimeClient?: RuntimeHarnessClient,
  ): Promise<void> {
    if (!runtimeClient || !ctx.sessionId) {
      return;
    }

    try {
      const abortOutcome = await this.awaitWithTimeout(
        runtimeClient.abort({ sessionID: ctx.sessionId }),
        RUN_DEADLINE_ABORT_TIMEOUT_MS,
      );
      if (abortOutcome.type === "timed_out") {
        console.warn(
          `[GenerationManager] Timed out aborting session ${ctx.sessionId} before deadline park for generation ${ctx.id}`,
        );
      }
    } catch (error) {
      console.warn(
        `[GenerationManager] Failed to abort session ${ctx.sessionId} before deadline park for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async saveSessionSnapshotForRunDeadlinePark(ctx: GenerationContext): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      return;
    }

    try {
      const snapshotOutcome = await this.awaitWithTimeout(
        this.saveSessionSnapshot(ctx),
        RUN_DEADLINE_SNAPSHOT_TIMEOUT_MS,
      );
      if (snapshotOutcome.type === "timed_out") {
        console.error(
          `[GenerationManager] Timed out saving session snapshot before deadline park for conversation ${ctx.conversationId}`,
        );
      }
    } catch (error) {
      console.error(
        `[GenerationManager] Failed to save session snapshot before deadline park for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async saveSessionSnapshotForInterruptPark(ctx: GenerationContext): Promise<void> {
    if (!ctx.sessionId || !ctx.sandbox) {
      return;
    }

    try {
      const snapshotOutcome = await this.awaitWithTimeout(
        this.saveSessionSnapshot(ctx),
        RUN_DEADLINE_SNAPSHOT_TIMEOUT_MS,
      );
      if (snapshotOutcome.type === "timed_out") {
        console.error(
          `[GenerationManager] Timed out saving session snapshot before interrupt park for conversation ${ctx.conversationId}`,
        );
      }
    } catch (error) {
      console.error(
        `[GenerationManager] Failed to save session snapshot before interrupt park for conversation ${ctx.conversationId}:`,
        error,
      );
    }
  }

  private async parkGenerationForRunDeadline(
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ): Promise<void> {
    const now = new Date();
    const releasedSandboxId = ctx.sandboxId;
    const remainingRunMs = this.refreshRemainingRunBudget(ctx, now);

    ctx.status = "paused";
    ctx.suspendedAt = now;
    this.setCompletionReason(ctx, "run_deadline");
    ctx.pendingApproval = null;
    ctx.pendingAuth = null;
    ctx.currentInterruptId = undefined;
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.stopExternalInterruptPolling(ctx);

    await this.abortRuntimeForRunDeadlinePark(ctx, runtimeClient);
    await this.saveSessionSnapshotForRunDeadlinePark(ctx);
    await this.saveProgress(ctx);

    await db
      .update(generation)
      .set({
        status: "paused",
        isPaused: true,
        completionReason: "run_deadline",
        remainingRunMs,
        suspendedAt: now,
        resumeInterruptId: null,
        sandboxId: null,
        pendingApproval: null,
        pendingAuth: null,
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        lastRuntimeEventAt: ctx.lastRuntimeEventAt,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({
        generationStatus: "paused",
        sandboxLastUserVisibleActionAt: now,
      })
      .where(eq(conversation.id, ctx.conversationId));

    if (ctx.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: "paused" })
        .where(eq(coworkerRun.id, ctx.coworkerRunId));
    }

    this.broadcast(ctx, {
      type: "status_change",
      status: "run_deadline_parked",
      metadata: {
        runtimeId: ctx.runtimeId,
        sandboxProvider: ctx.sandboxProviderOverride,
        sandboxId: releasedSandboxId,
        releasedSandboxId,
      },
    });

    try {
      await ctx.sandbox?.teardown();
    } catch (error) {
      console.warn("[GenerationManager] Failed to teardown sandbox during run deadline park", {
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: ctx.runtimeId,
        sandboxId: ctx.sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (ctx.runtimeId) {
        await conversationRuntimeService.suspendRuntime(ctx.runtimeId);
      }
      ctx.sandbox = undefined;
      ctx.sandboxId = undefined;
      ctx.sessionId = undefined;
      await this.releaseSandboxSlotLease(ctx);
      this.evictActiveGenerationContext(ctx.id);
    }
  }

  private async suspendGenerationForInterrupt(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<never> {
    const now = new Date();
    const remainingRunMs = this.refreshRemainingRunBudget(ctx, now);
    const nextStatus: GenerationStatus =
      interrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
    const nextConversationStatus =
      interrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";

    ctx.status = nextStatus;
    ctx.currentInterruptId = interrupt.id;
    ctx.suspendedAt = now;
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
      ctx.approvalParkTimeoutId = undefined;
    }
    this.stopExternalInterruptPolling(ctx);

    await this.saveSessionSnapshotForInterruptPark(ctx);
    await this.saveProgress(ctx);

    await db
      .update(generation)
      .set({
        status: nextStatus,
        remainingRunMs,
        suspendedAt: now,
        resumeInterruptId: null,
        sandboxId: null,
        pendingApproval: null,
        pendingAuth: null,
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        lastRuntimeEventAt: ctx.lastRuntimeEventAt,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({
        generationStatus: nextConversationStatus,
        sandboxLastUserVisibleActionAt: now,
      })
      .where(eq(conversation.id, ctx.conversationId));

    if (ctx.coworkerRunId) {
      await db
        .update(coworkerRun)
        .set({ status: nextStatus })
        .where(eq(coworkerRun.id, ctx.coworkerRunId));
    }

    try {
      await ctx.sandbox?.teardown();
    } catch (error) {
      console.warn("[GenerationManager] Failed to teardown sandbox during interrupt park", {
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        runtimeId: ctx.runtimeId,
        sandboxId: ctx.sandboxId,
        interruptId: interrupt.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (ctx.runtimeId) {
        await conversationRuntimeService.suspendRuntime(ctx.runtimeId);
      }
      ctx.sandbox = undefined;
      ctx.sandboxId = undefined;
      ctx.sessionId = undefined;
      await this.releaseSandboxSlotLease(ctx);
      this.evictActiveGenerationContext(ctx.id);
    }

    throw new GenerationSuspendedError(
      interrupt.id,
      interrupt.kind === "auth" ? "auth" : "approval",
    );
  }

  private async pollExternalInterruptAndSuspendIfNeeded(ctx: GenerationContext): Promise<void> {
    if (ctx.currentInterruptId) {
      const current = await generationInterruptService.getInterrupt(ctx.currentInterruptId);
      if (current && current.status !== "pending") {
        if (current.kind === "plugin_write") {
          await this.getPluginApprovalStatus(ctx.id, current.id);
        }
        ctx.currentInterruptId = undefined;
        ctx.status = "running";
        if (ctx.approvalParkTimeoutId) {
          clearTimeout(ctx.approvalParkTimeoutId);
          ctx.approvalParkTimeoutId = undefined;
        }
      }
      return;
    }

    const pendingInterrupt = await generationInterruptService.getPendingInterruptForGeneration(
      ctx.id,
    );
    if (!pendingInterrupt) {
      return;
    }

    const enrichedInterrupt = await this.enrichPluginWriteInterruptRuntimeTool(
      ctx,
      pendingInterrupt,
    );
    ctx.currentInterruptId = enrichedInterrupt.id;
    ctx.status = enrichedInterrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
    this.scheduleApprovalPark(ctx, enrichedInterrupt);
  }

  private async finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error",
  ): Promise<void> {
    if (ctx.isFinalizing) {
      return;
    }
    if (ctx.status === "completed" || ctx.status === "cancelled" || ctx.status === "error") {
      return;
    }
    ctx.isFinalizing = true;

    try {
      // Clear any pending timeouts
      if (ctx.saveDebounceId) {
        clearTimeout(ctx.saveDebounceId);
      }
      if (ctx.approvalTimeoutId) {
        clearTimeout(ctx.approvalTimeoutId);
      }
      if (ctx.approvalParkTimeoutId) {
        clearTimeout(ctx.approvalParkTimeoutId);
        ctx.approvalParkTimeoutId = undefined;
      }
      this.stopExternalInterruptPolling(ctx);
      if (ctx.authTimeoutId) {
        clearTimeout(ctx.authTimeoutId);
      }
      await this.releaseSandboxSlotLease(ctx);
      await getSandboxSlotManager().clearPendingRequest(ctx.id);

      // NOTE: We set ctx.status AFTER publishing terminal events to Redis to avoid a race
      // where readers observe status changes before terminal events are available.

      let messageId: string | undefined;
      let completedAssistantContent: string | undefined;
      const shouldPersistErrorAssistantMessage = status === "error";

      if (status === "completed" || status === "cancelled" || shouldPersistErrorAssistantMessage) {
        if (status === "completed" && ctx.runtimeId) {
          await conversationRuntimeService.updateRuntimeSession({
            runtimeId: ctx.runtimeId,
            sessionId: ctx.sessionId ?? null,
            sandboxId: ctx.sandboxId ?? null,
          });
        }

        // Auto-collect any new files created during generation (direct mode only)
        if (status === "completed" && ctx.sandbox && ctx.generationMarkerTime) {
          try {
            const excludePaths = Array.from(ctx.sentFilePaths || []);
            const stagedPaths = Array.from(ctx.userStagedFilePaths || []);
            const newFiles = await collectNewSandboxFiles(
              ctx.sandbox,
              ctx.generationMarkerTime,
              Array.from(new Set([...excludePaths, ...stagedPaths])),
            );
            const filesToUpload = filterAutoCollectedFilesMentionedInAnswer(
              newFiles,
              extractFinalAnswerTextForFileHeuristic(ctx),
            );

            console.log(
              `[GenerationManager] Found ${newFiles.length} new sandbox files; exposing ${filesToUpload.length} based on final-answer mentions`,
            );

            await Promise.all(
              filesToUpload.map(async (file) => {
                try {
                  const fileRecord = await uploadSandboxFile({
                    path: file.path,
                    content: file.content,
                    conversationId: ctx.conversationId,
                    messageId: undefined, // Will be linked below
                  });
                  ctx.uploadedSandboxFileIds?.add(fileRecord.id);

                  // Broadcast sandbox_file event
                  this.broadcast(ctx, {
                    type: "sandbox_file",
                    fileId: fileRecord.id,
                    path: file.path,
                    filename: fileRecord.filename,
                    mimeType: fileRecord.mimeType,
                    sizeBytes: fileRecord.sizeBytes,
                  });
                } catch (err) {
                  console.warn(
                    `[GenerationManager] Failed to upload collected file ${file.path}:`,
                    err,
                  );
                }
              }),
            );
          } catch (err) {
            console.error("[GenerationManager] Failed to collect new sandbox files:", err);
          }
        }

        const interruptionText = "Interrupted by user";
        const cancelledParts =
          status === "cancelled"
            ? [
                ...ctx.contentParts,
                ...(ctx.contentParts.some(
                  (part): part is ContentPart & { type: "system" } =>
                    part.type === "system" && part.content === interruptionText,
                )
                  ? []
                  : ([{ type: "system", content: interruptionText }] as ContentPart[])),
              ]
            : ctx.contentParts;

        // Keep interruption marker in generation record snapshot too.
        if (status === "cancelled") {
          ctx.contentParts = cancelledParts;
        }

        this.markPhase(ctx, "generation_completed");
        const messageTiming: MessageTiming = this.buildMessageTiming(ctx);

        // Save assistant message for completed/cancelled and recoverable error generations.
        const [assistantMessage] = await db
          .insert(message)
          .values({
            conversationId: ctx.conversationId,
            role: "assistant",
            content:
              status === "cancelled"
                ? ctx.assistantContent || interruptionText
                : ctx.assistantContent ||
                  ctx.errorMessage ||
                  (status === "completed"
                    ? "The run completed without producing any assistant output."
                    : "The run failed before producing any assistant output."),
            contentParts: cancelledParts.length > 0 ? cancelledParts : null,
            inputTokens: ctx.usage.inputTokens,
            outputTokens: ctx.usage.outputTokens,
            timing: messageTiming,
          })
          .returning();

        messageId = assistantMessage.id;
        completedAssistantContent = assistantMessage.content;

        // Link uploaded sandbox files to the final assistant message
        const uploadedFileIds = Array.from(ctx.uploadedSandboxFileIds || []);
        if (status === "completed" && uploadedFileIds.length > 0) {
          const { sandboxFile } = await import("@cmdclaw/db/schema");
          const { inArray } = await import("drizzle-orm");
          await db
            .update(sandboxFile)
            .set({ messageId })
            .where(inArray(sandboxFile.id, uploadedFileIds));
        }

        // Generate title for new conversations
        if (status === "completed" && ctx.isNewConversation && ctx.assistantContent) {
          try {
            const title = await generateConversationTitle(
              ctx.userMessageContent,
              ctx.assistantContent,
            );
            if (title) {
              await db
                .update(conversation)
                .set({ title })
                .where(eq(conversation.id, ctx.conversationId));
            }
          } catch (err) {
            console.error("[GenerationManager] Failed to generate title:", err);
          }
        }
      }

      // Update generation record
      await generationInterruptService.cancelInterruptsForGeneration(ctx.id);
      await db
        .update(generation)
        .set({
          status,
          messageId,
          cancelRequestedAt: null,
          pendingApproval: null,
          pendingAuth: null,
          resumeInterruptId: null,
          suspendedAt: null,
          remainingRunMs: ctx.remainingRunMs,
          contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
          errorMessage: ctx.errorMessage,
          debugInfo: ctx.debugInfo ?? null,
          lastRuntimeEventAt: ctx.lastRuntimeEventAt,
          recoveryAttempts: ctx.recoveryAttempts,
          completionReason:
            ctx.completionReason ??
            (status === "completed"
              ? "completed"
              : status === "cancelled"
                ? "user_cancel"
                : "runtime_error"),
          inputTokens: ctx.usage.inputTokens,
          outputTokens: ctx.usage.outputTokens,
          completedAt: new Date(),
        })
        .where(eq(generation.id, ctx.id));

      if (status === "error") {
        try {
          await captureGenerationFailureAlert({ generationId: ctx.id });
        } catch (error) {
          console.error("[GenerationManager] Failed to capture failure alert", {
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            error,
          });
        }
      }

      const assistantMessagePersisted = Boolean(messageId);

      // Update conversation status and persisted usage counters
      await db
        .update(conversation)
        .set({
          generationStatus:
            status === "completed" ? "complete" : status === "error" ? "error" : "idle",
          ...(assistantMessagePersisted
            ? {
                usageInputTokens: sql`${conversation.usageInputTokens} + ${ctx.usage.inputTokens}`,
                usageOutputTokens: sql`${conversation.usageOutputTokens} + ${ctx.usage.outputTokens}`,
                usageTotalTokens: sql`${conversation.usageTotalTokens} + ${ctx.usage.inputTokens + ctx.usage.outputTokens}`,
                usageAssistantMessageCount: sql`${conversation.usageAssistantMessageCount} + 1`,
              }
            : {}),
        })
        .where(eq(conversation.id, ctx.conversationId));

      if (ctx.runtimeId) {
        await conversationRuntimeService.clearActiveGeneration({
          runtimeId: ctx.runtimeId,
          generationId: ctx.id,
        });
      }

      if (status === "completed") {
        await this.saveSessionSnapshotIfPossible(ctx, `finish:${status}`);
      }

      if (status === "completed") {
        try {
          const sandboxRuntimeMs = ctx.sandboxId
            ? Math.max(0, Date.now() - ctx.startedAt.getTime())
            : 0;
          await trackGenerationBilling({
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            model: ctx.model,
            inputTokens: ctx.usage.inputTokens,
            outputTokens: ctx.usage.outputTokens,
            sandboxRuntimeMs,
          });
        } catch (error) {
          console.error("[GenerationManager] Failed to track billing:", error);
        }
      }

      if (ctx.coworkerRunId) {
        await db
          .update(coworkerRun)
          .set({
            status:
              status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "error",
            finishedAt: new Date(),
            errorMessage: ctx.errorMessage,
            debugInfo: ctx.debugInfo ?? null,
          })
          .where(eq(coworkerRun.id, ctx.coworkerRunId));
      }

      await this.enqueueConversationQueuedMessageProcess(ctx.conversationId);

      // Publish terminal stream event before status finalization
      if (status === "completed" && messageId) {
        const artifacts = await getDoneArtifacts(messageId);
        this.broadcast(ctx, {
          type: "done",
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          messageId,
          usage: ctx.usage,
          artifacts,
        });

        try {
          await sendTaskDonePush({
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            messageId,
            content: completedAssistantContent,
          });
        } catch (error) {
          console.error("[GenerationManager] Failed to send task completion push", {
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            error,
          });
        }
      } else if (status === "cancelled") {
        this.broadcast(ctx, {
          type: "cancelled",
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          messageId,
        });
      } else if (status === "error") {
        const diagnosticMessage = getGenerationDiagnosticMessage(ctx.debugInfo);
        this.broadcast(ctx, {
          type: "error",
          message: formatGenerationErrorMessage(
            ctx.errorMessage || "Unknown error",
            diagnosticMessage,
          ),
          ...(diagnosticMessage ? { diagnosticMessage } : {}),
        });
      }

      logServerEvent(
        "info",
        "GENERATION_STREAM_PUBLISH_SUMMARY",
        {
          publishedCount: ctx.streamPublishedCount,
          lastCursor: ctx.streamLastCursor ?? null,
          lastSequence: ctx.streamSequence,
          firstVisiblePublishedAt: ctx.streamFirstVisiblePublishedAt
            ? new Date(ctx.streamFirstVisiblePublishedAt).toISOString()
            : null,
          terminalPublishedAt: ctx.streamTerminalPublishedAt
            ? new Date(ctx.streamTerminalPublishedAt).toISOString()
            : null,
          generationEventPublishMs:
            ctx.streamFirstVisiblePublishedAt && ctx.startedAt
              ? Math.max(0, ctx.streamFirstVisiblePublishedAt - ctx.startedAt.getTime())
              : undefined,
          generationTerminalPublishMs:
            ctx.streamTerminalPublishedAt && ctx.startedAt
              ? Math.max(0, ctx.streamTerminalPublishedAt - ctx.startedAt.getTime())
              : undefined,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );

      // Set status AFTER broadcast so subscription loop receives the terminal event
      // before seeing the status change.
      ctx.status = status;

      // Cleanup
      this.evictActiveGenerationContext(ctx.id);
    } finally {
      ctx.isFinalizing = false;
    }
  }

  private scheduleSave(ctx: GenerationContext): void {
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }

    ctx.saveDebounceId = setTimeout(() => {
      this.saveProgress(ctx);
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveProgress(ctx: GenerationContext): Promise<void> {
    ctx.lastSaveAt = new Date();

    await db
      .update(generation)
      .set({
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
        lastRuntimeEventAt: ctx.lastRuntimeEventAt,
        deadlineAt: ctx.deadlineAt,
        remainingRunMs: ctx.remainingRunMs,
        suspendedAt: ctx.suspendedAt ?? null,
        resumeInterruptId: ctx.resumeInterruptId ?? null,
        recoveryAttempts: ctx.recoveryAttempts,
        completionReason: ctx.completionReason ?? null,
        debugInfo: ctx.debugInfo ?? null,
      })
      .where(eq(generation.id, ctx.id));
  }

  private publishEventToRedisStream(ctx: GenerationContext, event: GenerationEvent): void {
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
            error: formatErrorMessage(error),
            sequence: nextSequence,
            eventType: event.type,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      });
  }

  private projectInterruptPendingEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return {
      type: "interrupt_pending",
      ...generationInterruptService.projectInterruptEvent(interrupt),
    };
  }

  private projectInterruptResolvedEvent(interrupt: GenerationInterruptRecord): GenerationEvent {
    return {
      type: "interrupt_resolved",
      ...generationInterruptService.projectInterruptEvent(interrupt),
    };
  }

  private async publishDetachedGenerationStreamEvent(params: {
    generationId: string;
    conversationId: string;
    event: GenerationEvent;
  }): Promise<void> {
    try {
      const latest = await getLatestGenerationStreamEnvelope(params.generationId);
      const envelope: GenerationStreamEnvelope = {
        generationId: params.generationId,
        conversationId: params.conversationId,
        sequence: (latest?.envelope.sequence ?? 0) + 1,
        eventType: params.event.type,
        payload: params.event,
        createdAtMs: Date.now(),
      };
      await publishGenerationStreamEvent(params.generationId, envelope);
    } catch (error) {
      logServerEvent(
        "error",
        "GENERATION_STREAM_PUBLISH_FAILED",
        {
          error: formatErrorMessage(error),
          eventType: params.event.type,
        },
        {
          source: "generation-manager",
          generationId: params.generationId,
          conversationId: params.conversationId,
        },
      );
    }
  }

  private broadcast(ctx: GenerationContext, event: GenerationEvent): void {
    this.publishEventToRedisStream(ctx, event);

    if (ctx.coworkerRunId) {
      void this.recordCoworkerRunEvent(ctx.coworkerRunId, event);
    }
  }

  private appendSystemEvent(
    ctx: GenerationContext,
    event: { content: string; coworkerId?: string },
  ): void {
    ctx.contentParts.push({
      type: "system",
      content: event.content,
    });
    this.broadcast(ctx, {
      type: "system",
      content: event.content,
      coworkerId: event.coworkerId,
    });
  }

  private applyCoworkerEditEnvelope(
    ctx: GenerationContext,
    envelope: CoworkerEditApplyEnvelope,
  ): void {
    const coworkerId = envelope.coworkerId;

    if (envelope.status === "applied") {
      ctx.builderCoworkerContext = envelope.coworker;
      this.appendSystemEvent(ctx, { content: envelope.message, coworkerId });
      logServerEvent(
        "info",
        "COWORKER_EDIT_APPLIED",
        {
          coworkerId,
          changedFields: envelope.appliedChanges,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      return;
    }

    if (envelope.status === "conflict") {
      ctx.builderCoworkerContext = envelope.coworker;
      this.appendSystemEvent(ctx, { content: envelope.message, coworkerId });
      logServerEvent(
        "warn",
        "COWORKER_EDIT_CONFLICT",
        { coworkerId },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      return;
    }

    this.appendSystemEvent(ctx, {
      content: `${envelope.message}: ${envelope.details.join("; ")}`,
      coworkerId,
    });
    logServerEvent(
      "warn",
      "COWORKER_EDIT_VALIDATION_FAILED",
      { coworkerId, details: envelope.details },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );
  }

  private async recordCoworkerRunEvent(
    coworkerRunId: string,
    event: GenerationEvent,
  ): Promise<void> {
    const loggableEvents = new Set([
      "tool_use",
      "tool_result",
      "interrupt_pending",
      "interrupt_resolved",
      "done",
      "error",
      "cancelled",
      "status_change",
      "system",
    ]);

    if (!loggableEvents.has(event.type)) {
      return;
    }

    await db.insert(coworkerRunEvent).values({
      coworkerRunId,
      type: event.type,
      payload: event,
    });
  }
}

// Stable singleton across dev hot-reloads/module re-evaluation.
const globalForGenerationManager = globalThis as typeof globalThis & {
  __cmdclawGenerationManager?: GenerationManager;
};

export const generationManager =
  globalForGenerationManager.__cmdclawGenerationManager ?? new GenerationManager();

if (process.env.NODE_ENV !== "production") {
  globalForGenerationManager.__cmdclawGenerationManager = generationManager;
}
