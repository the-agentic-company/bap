import type {
  RuntimeEvent,
  RuntimeHarnessClient,
  RuntimePart,
  RuntimePermissionRequest,
  RuntimeQuestionRequest,
} from "../../sandbox/core/types";
import { aggregateConversationUsageFromSessionMessages } from "../../services/conversation-usage-service";

export type OpenCodeTrackedEvent = Extract<
  RuntimeEvent,
  {
    type:
      | "message.updated"
      | "message.part.updated"
      | "session.updated"
      | "session.status";
  }
>;

export type OpenCodeActionableEvent = Extract<
  RuntimeEvent,
  { type: "message.part.updated" | "permission.asked" | "question.asked" }
>;

export type OpenCodeRuntimeToolRef = {
  sessionId?: string;
  messageId: string;
  partId: string;
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export function isOpenCodeTrackedEvent(
  event: RuntimeEvent,
): event is OpenCodeTrackedEvent {
  return (
    event.type === "message.updated" ||
    event.type === "message.part.updated" ||
    event.type === "session.updated" ||
    event.type === "session.status"
  );
}

export function isOpenCodeActionableEvent(
  event: RuntimeEvent,
): event is OpenCodeActionableEvent {
  return (
    event.type === "message.part.updated" ||
    event.type === "permission.asked" ||
    event.type === "question.asked"
  );
}

function buildOpenCodeDefaultQuestionAnswers(
  request: RuntimeQuestionRequest,
): string[][] {
  return request.questions.map((question) => {
    const firstOption = question.options?.[0];
    return firstOption?.value || firstOption?.label
      ? [firstOption.value ?? firstOption.label]
      : [];
  });
}

function buildOpenCodeQuestionCommand(request: RuntimeQuestionRequest): string {
  return request.questions
    .map((question) => {
      const options =
        question.options
          ?.map((option) => option.label || option.value)
          .filter(Boolean)
          .join(", ") || "custom answer";
      return `${question.header}: ${question.question} (${options})`;
    })
    .join("; ");
}

export type OpenCodeTerminalReconciliationOutcome =
  | "idle"
  | "error"
  | "timed_out"
  | "aborted"
  | "unknown";

export type OpenCodeTerminalEventOutcome = "continue" | "idle" | "error";

export type OpenCodeRuntimeEventInspection = {
  eventCountDelta: number;
  toolCallCountDelta: number;
  terminalOutcome: OpenCodeTerminalEventOutcome;
  errorMessage: string | null;
  logEvent: boolean;
};

export type OpenCodeRuntimeStreamStats = {
  eventCount: number;
  progressEventCount: number;
  toolCallCount: number;
  permissionCount: number;
  questionCount: number;
};

export type OpenCodeRuntimeEventProcessResult = {
  outcome: OpenCodeTerminalEventOutcome;
  errorMessage: string | null;
};

export type OpenCodeTrackedEventProcessor = (input: {
  event: OpenCodeTrackedEvent;
  currentTextPart: { type: "text"; text: string } | null;
  currentTextPartId: string | null;
  setCurrentTextPart: (
    part: { type: "text"; text: string } | null,
    partId: string | null,
  ) => void;
}) => Promise<void>;

export type OpenCodeRuntimeEventLoopCallbacks = {
  markFirstEvent: () => void;
  markRuntimeActivity: () => void;
  refreshCancellationSignal: () => Promise<boolean>;
  pollExternalInterruptAndSuspendIfNeeded?: () => Promise<void>;
  logEvent?: (input: {
    event: RuntimeEvent;
    inspection: OpenCodeRuntimeEventInspection;
  }) => void;
  processTrackedEvent: OpenCodeTrackedEventProcessor;
  handleActionableEvent: (
    event: OpenCodeActionableEvent,
  ) => Promise<{ type: "none" | "permission" | "question" }>;
  onIdle?: () => void;
  onSessionError?: (errorMessage: string) => void;
};

export type OpenCodeRuntimeEventLoopSnapshot = {
  stats: OpenCodeRuntimeStreamStats;
  sawSessionIdle: boolean;
  sessionErrorMessage: string | null;
};

export type OpenCodeEmptyCompletionDiagnostics = {
  sessionGetError: string | null;
  sessionGetErrorDetail: string | null;
  sessionGetDataShape: string | null;
  sessionGetDataDetail: string | null;
  opencodeLogTail: string | null;
  opencodeLogReadError: string | null;
};

export type OpenCodePromptResultEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; error: unknown };

export type OpenCodePromptCompletionResolution = {
  promptResultData: unknown;
  promptResultDataShape: string | null;
  assistantText: string | null;
  assistantTextSource: "prompt_result" | "session_messages" | null;
  fallbackMessagesError: string | null;
  fallbackMessagesErrorDetail: string | null;
  fallbackMessagesPayloadShape: string | null;
  emptyCompletionDiagnostics: OpenCodeEmptyCompletionDiagnostics | null;
  bestTranscriptError: string | null;
};

type SandboxLogReader = {
  readFile(path: string): Promise<string>;
};

export type OpenCodeApprovalCapableClient =
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

export type OpenCodeApprovalRuntimeRequest =
  | {
      kind: "permission";
      requestId: string;
      reply: "always" | "reject";
    }
  | {
      kind: "question";
      requestId: string;
      answers?: string[][];
      reject?: boolean;
    };

export type OpenCodeActionableHandlingResult =
  | { type: "none" }
  | { type: "permission"; action: "auto_approved" }
  | {
      type: "permission";
      action: "queue";
      request: RuntimePermissionRequest;
      pendingApproval: {
        toolUseId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        requestedAt: string;
        integration: string;
        operation: string;
        command: string;
      };
    }
  | {
      type: "question";
      action: "queue";
      request: RuntimeQuestionRequest;
      defaultAnswers: string[][];
      toolUseId: string;
      command: string;
      toolInput: Record<string, unknown>;
      pendingApproval: {
        toolUseId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        requestedAt: string;
        integration: string;
        operation: string;
        command: string;
      };
    };

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

function normalizePermissionPattern(pattern: string): string {
  return pattern.replace(/[\s*]+$/g, "").replace(/\/+$/, "");
}

export function shouldAutoApproveOpenCodePermission(
  permissionType: string,
  patterns: string[] | undefined,
): boolean {
  if (!patterns?.length) {
    return false;
  }

  return patterns.every((pattern) => {
    const normalized = normalizePermissionPattern(pattern);

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

function coverOpenCodeToolState(part: Extract<RuntimePart, { type: "tool" }>): void {
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

function extractOpenCodeSessionErrorMessage(event: RuntimeEvent): string {
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

  if (typeof error === "string") {
    return error;
  }
  if (typeof nestedData?.message === "string") {
    return nestedData.message;
  }
  if (typeof errorObj?.message === "string") {
    return errorObj.message;
  }

  return JSON.stringify(error);
}

export function inspectOpenCodeRuntimeEvent(event: RuntimeEvent): OpenCodeRuntimeEventInspection {
  let toolCallCountDelta = 0;
  if (event.type === "message.part.updated") {
    const part = event.properties.part;
    if (part.type === "tool" && part.state.status === "pending") {
      toolCallCountDelta = 1;
    }
  }

  if (event.type === "session.idle") {
    return {
      eventCountDelta: 1,
      toolCallCountDelta,
      terminalOutcome: "idle",
      errorMessage: null,
      logEvent: true,
    };
  }

  if (event.type === "session.error") {
    return {
      eventCountDelta: 1,
      toolCallCountDelta,
      terminalOutcome: "error",
      errorMessage: extractOpenCodeSessionErrorMessage(event),
      logEvent: true,
    };
  }

  return {
    eventCountDelta: 1,
    toolCallCountDelta,
    terminalOutcome: "continue",
    errorMessage: null,
    logEvent: event.type === "server.connected",
  };
}

export async function processOpenCodeRuntimeEvent(input: {
  event: unknown;
  stats: OpenCodeRuntimeStreamStats;
  markFirstEvent: () => void;
  markRuntimeActivity: () => void;
  refreshCancellationSignal: () => Promise<boolean>;
  pollExternalInterruptAndSuspendIfNeeded?: () => Promise<void>;
  logEvent: (input: {
    event: RuntimeEvent;
    inspection: OpenCodeRuntimeEventInspection;
  }) => void;
  processTrackedEvent: (event: OpenCodeTrackedEvent) => Promise<void>;
  handleActionableEvent: (
    event: OpenCodeActionableEvent,
  ) => Promise<{ type: "none" | "permission" | "question" }>;
  onIdle?: () => void;
  onSessionError?: (errorMessage: string) => void;
}): Promise<OpenCodeRuntimeEventProcessResult> {
  input.markFirstEvent();
  const event = input.event as RuntimeEvent;
  input.markRuntimeActivity();
  if (await input.refreshCancellationSignal()) {
    return { outcome: "error", errorMessage: null };
  }
  await input.pollExternalInterruptAndSuspendIfNeeded?.();

  const inspection = inspectOpenCodeRuntimeEvent(event);
  input.stats.eventCount += inspection.eventCountDelta;
  input.stats.toolCallCount += inspection.toolCallCountDelta;

  input.logEvent({ event, inspection });

  if (isOpenCodeTrackedEvent(event)) {
    await input.processTrackedEvent(event);
  }

  if (isOpenCodeActionableEvent(event)) {
    const actionableResult = await input.handleActionableEvent(event);
    if (actionableResult.type === "permission") {
      input.stats.permissionCount += 1;
    } else if (actionableResult.type === "question") {
      input.stats.questionCount += 1;
    }
  }

  if (inspection.terminalOutcome === "idle") {
    input.onIdle?.();
    return { outcome: "idle", errorMessage: null };
  }

  if (inspection.terminalOutcome === "error") {
    const errorMessage = inspection.errorMessage ?? "Unknown error";
    input.onSessionError?.(errorMessage);
    return { outcome: "error", errorMessage };
  }

  return { outcome: "continue", errorMessage: null };
}

export class OpenCodeRuntimeEventLoop {
  private currentTextPart: { type: "text"; text: string } | null = null;
  private currentTextPartId: string | null = null;
  private readonly stats: OpenCodeRuntimeStreamStats = {
    eventCount: 0,
    progressEventCount: 0,
    toolCallCount: 0,
    permissionCount: 0,
    questionCount: 0,
  };
  private sawSessionIdle = false;
  private sessionErrorMessage: string | null = null;

  constructor(private readonly callbacks: OpenCodeRuntimeEventLoopCallbacks) {}

  snapshot(): OpenCodeRuntimeEventLoopSnapshot {
    return {
      stats: { ...this.stats },
      sawSessionIdle: this.sawSessionIdle,
      sessionErrorMessage: this.sessionErrorMessage,
    };
  }

  async process(rawEvent: unknown): Promise<OpenCodeTerminalEventOutcome> {
    const result = await processOpenCodeRuntimeEvent({
      event: rawEvent,
      stats: this.stats,
      markFirstEvent: this.callbacks.markFirstEvent,
      markRuntimeActivity: this.callbacks.markRuntimeActivity,
      refreshCancellationSignal: this.callbacks.refreshCancellationSignal,
      pollExternalInterruptAndSuspendIfNeeded:
        this.callbacks.pollExternalInterruptAndSuspendIfNeeded,
      logEvent: this.callbacks.logEvent ?? (() => undefined),
      processTrackedEvent: async (event) => {
        await this.callbacks.processTrackedEvent({
          event,
          currentTextPart: this.currentTextPart,
          currentTextPartId: this.currentTextPartId,
          setCurrentTextPart: (part, partId) => {
            this.currentTextPart = part;
            this.currentTextPartId = partId;
          },
        });
      },
      handleActionableEvent: this.callbacks.handleActionableEvent,
      onIdle: () => {
        this.sawSessionIdle = true;
        this.callbacks.onIdle?.();
      },
      onSessionError: (errorMessage) => {
        if (!this.sessionErrorMessage) {
          this.sessionErrorMessage = errorMessage;
        }
        this.callbacks.onSessionError?.(errorMessage);
      },
    });
    if (
      isOpenCodeTrackedEvent(rawEvent as RuntimeEvent) ||
      isOpenCodeActionableEvent(rawEvent as RuntimeEvent) ||
      result.outcome === "idle" ||
      result.errorMessage
    ) {
      this.stats.progressEventCount += 1;
    }
    if (result.outcome === "error" && result.errorMessage) {
      throw new Error(result.errorMessage);
    }
    return result.outcome;
  }

  async consume(eventStream: AsyncIterable<unknown>): Promise<OpenCodeTerminalEventOutcome> {
    let lastOutcome: OpenCodeTerminalEventOutcome = "continue";
    for await (const rawEvent of eventStream) {
      lastOutcome = await this.process(rawEvent);
      if (lastOutcome !== "continue") {
        break;
      }
    }
    return lastOutcome;
  }
}

export async function replyOpenCodePermissionRequest(
  client: OpenCodeApprovalCapableClient,
  input: { requestID: string; reply: "always" | "reject" },
): Promise<void> {
  if ("replyPermission" in client) {
    await client.replyPermission(input);
    return;
  }
  await client.permission.reply(input);
}

export async function replyOpenCodeQuestionRequest(
  client: OpenCodeApprovalCapableClient,
  input: { requestID: string; answers: string[][] },
): Promise<void> {
  if ("replyQuestion" in client) {
    await client.replyQuestion(input);
    return;
  }
  await client.question.reply(input);
}

export async function rejectOpenCodeQuestionRequest(
  client: OpenCodeApprovalCapableClient,
  input: { requestID: string },
): Promise<void> {
  if ("rejectQuestion" in client) {
    await client.rejectQuestion(input);
    return;
  }
  await client.question.reject(input);
}

export async function sendOpenCodeApprovalRuntimeDecision(
  client: OpenCodeApprovalCapableClient,
  request: OpenCodeApprovalRuntimeRequest,
): Promise<void> {
  if (request.kind === "permission") {
    await replyOpenCodePermissionRequest(client, {
      requestID: request.requestId,
      reply: request.reply,
    });
    return;
  }
  if (request.reject) {
    await rejectOpenCodeQuestionRequest(client, {
      requestID: request.requestId,
    });
    return;
  }
  await replyOpenCodeQuestionRequest(client, {
    requestID: request.requestId,
    answers: request.answers ?? [[]],
  });
}

export async function updateOpenCodeToolPart(
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

export async function handleOpenCodeActionableEvent(input: {
  event: OpenCodeActionableEvent;
  client: OpenCodeApprovalCapableClient;
  autoApprove: boolean;
  idFactory?: (prefix: string) => string;
  logAutoApprove?: (input: {
    requestId: string;
    permissionType: string;
    patterns?: string[];
    reason: "conversation_auto_approve" | "allowlisted_path";
  }) => void;
  logPermissionQueued?: (input: {
    requestId: string;
    permission?: string;
    patterns?: string[];
  }) => void;
  logPermissionApproveError?: (error: unknown) => void;
}): Promise<OpenCodeActionableHandlingResult> {
  switch (input.event.type) {
    case "message.part.updated": {
      if (input.event.properties.part.type === "tool") {
        coverOpenCodeToolState(input.event.properties.part);
      }
      return { type: "none" };
    }
    case "permission.asked": {
      const request = input.event.properties;
      const permissionType = request.permission || "file access";
      const patterns = request.patterns;
      const allPatternsAllowed = shouldAutoApproveOpenCodePermission(permissionType, patterns);

      if (input.autoApprove || allPatternsAllowed) {
        input.logAutoApprove?.({
          requestId: request.id,
          permissionType,
          patterns,
          reason: input.autoApprove ? "conversation_auto_approve" : "allowlisted_path",
        });
        try {
          await replyOpenCodePermissionRequest(input.client, {
            requestID: request.id,
            reply: "always",
          });
        } catch (error) {
          input.logPermissionApproveError?.(error);
        }
        return { type: "permission", action: "auto_approved" };
      }

      input.logPermissionQueued?.({
        requestId: request.id,
        permission: request.permission,
        patterns,
      });
      const toolUseId =
        input.idFactory?.("opencode-perm") ??
        `opencode-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const command = patterns?.length
        ? `${permissionType}: ${patterns.join(", ")}`
        : permissionType;

      return {
        type: "permission",
        action: "queue",
        request,
        pendingApproval: {
          toolUseId,
          toolName: "Permission",
          toolInput: request as Record<string, unknown>,
          requestedAt: new Date().toISOString(),
          integration: "cmdclaw",
          operation: permissionType,
          command,
        },
      };
    }
    case "question.asked": {
      const request = input.event.properties;
      const defaultAnswers = buildOpenCodeDefaultQuestionAnswers(request);
      const linkedToolUseId =
        typeof request.tool?.callID === "string" && request.tool.callID.length > 0
          ? request.tool.callID
          : typeof request.tool?.callId === "string" && request.tool.callId.length > 0
            ? request.tool.callId
            : undefined;
      const toolUseId =
        linkedToolUseId ??
        (input.idFactory?.("opencode-question") ??
          `opencode-question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const command = buildOpenCodeQuestionCommand(request);
      const toolInput = request as unknown as Record<string, unknown>;

      return {
        type: "question",
        action: "queue",
        request,
        defaultAnswers,
        toolUseId,
        command,
        toolInput,
        pendingApproval: {
          toolUseId,
          toolName: "question",
          toolInput,
          requestedAt: new Date().toISOString(),
          integration: "cmdclaw",
          operation: "question",
          command,
        },
      };
    }
    default:
      return assertNever(input.event);
  }
}

export function summarizeUnknownValue(value: unknown, maxLength = 500): string {
  const raw =
    typeof value === "string" ? value : (safeJsonStringify(value) ?? formatErrorMessage(value));
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}

export function describeSessionMessagesPayload(payload: unknown): string {
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

export function describePromptResultData(data: unknown): string | null {
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

export function isOpaqueDiagnosticMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim();
  return !normalized || normalized === "{}" || normalized === "[]" || normalized === "null";
}

function tailLogText(text: string, maxLines = 80, maxChars = 4_000): string {
  const lines = text.split("\n");
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length > maxChars ? `...${tail.slice(-maxChars)}` : tail;
}

export function extractAssistantTextFromSessionMessagesPayload(payload: unknown): string | null {
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

export function extractAssistantTextFromPromptResultData(payload: unknown): string | null {
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

export function getRuntimeStatusTypeForSession(
  payload: unknown,
  sessionId: string,
): string | null {
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

export async function collectOpenCodeEmptyCompletionDiagnostics(input: {
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
  sandbox?: SandboxLogReader | null;
}): Promise<OpenCodeEmptyCompletionDiagnostics> {
  let sessionGetError: string | null = null;
  let sessionGetErrorDetail: string | null = null;
  let sessionGetDataShape: string | null = null;
  let sessionGetDataDetail: string | null = null;
  let opencodeLogTail: string | null = null;
  let opencodeLogReadError: string | null = null;

  try {
    const sessionResult = await input.runtimeClient.getSession({ sessionID: input.sessionId });
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

  if (input.sandbox) {
    try {
      const rawLog = await input.sandbox.readFile("/tmp/opencode.log");
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

export async function resolveOpenCodePromptCompletion(input: {
  promptResultEnvelope: OpenCodePromptResultEnvelope;
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
  sandbox?: SandboxLogReader | null;
  needsAssistantText: boolean;
  observedTerminalIdle: boolean;
  logPromptTransportErrorAfterIdle?: (error: unknown) => void;
  logOpaquePromptResultError?: (error: unknown) => void;
  logFallbackMessagesError?: (error: unknown) => void;
}): Promise<OpenCodePromptCompletionResolution> {
  if (!input.promptResultEnvelope.ok) {
    if (!input.observedTerminalIdle) {
      throw input.promptResultEnvelope.error;
    }
    input.logPromptTransportErrorAfterIdle?.(input.promptResultEnvelope.error);
  }

  const rawPromptResult = input.promptResultEnvelope.ok
    ? input.promptResultEnvelope.data
    : { data: null, error: null };
  const promptResult: { data: unknown; error: unknown } =
    rawPromptResult && typeof rawPromptResult === "object"
      ? "data" in rawPromptResult || "error" in rawPromptResult
        ? {
            data: "data" in rawPromptResult ? rawPromptResult.data : null,
            error: "error" in rawPromptResult ? rawPromptResult.error : null,
          }
        : { data: rawPromptResult, error: null }
      : { data: rawPromptResult ?? null, error: null };

  if (promptResult.error) {
    const promptResultErrorMessage = formatErrorMessage(promptResult.error);
    if (!input.observedTerminalIdle && !isOpaqueDiagnosticMessage(promptResultErrorMessage)) {
      throw new Error(promptResultErrorMessage);
    }
    if (input.observedTerminalIdle) {
      input.logPromptTransportErrorAfterIdle?.(promptResult.error);
    } else {
      input.logOpaquePromptResultError?.(promptResult.error);
    }
  }

  let assistantText: string | null = null;
  let assistantTextSource: "prompt_result" | "session_messages" | null = null;
  let fallbackMessagesError: string | null = null;
  let fallbackMessagesErrorDetail: string | null = null;
  let fallbackMessagesPayloadShape: string | null = null;

  if (input.needsAssistantText) {
    const promptResultText = extractAssistantTextFromPromptResultData(promptResult.data);
    if (promptResultText) {
      assistantText = promptResultText;
      assistantTextSource = "prompt_result";
    }
  }

  if (input.needsAssistantText && !assistantText) {
    try {
      const messagesResult = await input.runtimeClient.messages({
        sessionID: input.sessionId,
        limit: 20,
      });
      if (!messagesResult.error) {
        fallbackMessagesPayloadShape = describeSessionMessagesPayload(messagesResult.data);
        const fallbackText = extractAssistantTextFromSessionMessagesPayload(messagesResult.data);
        if (fallbackText) {
          assistantText = fallbackText;
          assistantTextSource = "session_messages";
        }
      } else {
        fallbackMessagesError = formatErrorMessage(messagesResult.error);
        fallbackMessagesErrorDetail = summarizeUnknownValue(messagesResult.error);
      }
    } catch (error) {
      fallbackMessagesError = formatErrorMessage(error);
      fallbackMessagesErrorDetail = summarizeUnknownValue(error);
      input.logFallbackMessagesError?.(error);
    }
  }

  let emptyCompletionDiagnostics: OpenCodeEmptyCompletionDiagnostics | null = null;
  let bestTranscriptError: string | null = null;
  if (input.needsAssistantText && !assistantText && !input.observedTerminalIdle) {
    emptyCompletionDiagnostics = await collectOpenCodeEmptyCompletionDiagnostics({
      runtimeClient: input.runtimeClient,
      sessionId: input.sessionId,
      sandbox: input.sandbox,
    });
    bestTranscriptError = isOpaqueDiagnosticMessage(fallbackMessagesError)
      ? emptyCompletionDiagnostics.sessionGetError
      : fallbackMessagesError;
  }

  return {
    promptResultData: promptResult.data,
    promptResultDataShape: describePromptResultData(promptResult.data),
    assistantText,
    assistantTextSource,
    fallbackMessagesError,
    fallbackMessagesErrorDetail,
    fallbackMessagesPayloadShape,
    emptyCompletionDiagnostics,
    bestTranscriptError,
  };
}

export async function waitForOpenCodeTerminalStateAfterEarlyStreamEnd(input: {
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
  maxReattachAttempts: number;
  reattachWaitMs: number;
  statusPollIntervalMs: number;
  getRemainingRunTimeMs: () => number;
  isAbortRequested: () => boolean;
  refreshCancellationSignal: () => Promise<boolean>;
  pollExternalInterruptAndSuspendIfNeeded: () => Promise<void>;
  onEvent: (event: unknown) => Promise<OpenCodeTerminalEventOutcome>;
  logReattachFailure?: (attempt: number, error: unknown) => void;
  logStatusPollError?: (error: unknown) => void;
  logStatusReconciliationFailure?: (error: unknown) => void;
}): Promise<OpenCodeTerminalReconciliationOutcome> {
  for (let attempt = 1; attempt <= input.maxReattachAttempts; attempt += 1) {
    const remainingRunTimeMs = input.getRemainingRunTimeMs();
    if (remainingRunTimeMs <= 0) {
      return "timed_out";
    }

    const reattachController = new AbortController();
    const reattachTimeoutId = setTimeout(
      () => reattachController.abort(),
      Math.min(remainingRunTimeMs, input.reattachWaitMs),
    );
    try {
      const eventResult = await input.runtimeClient.subscribe(
        {},
        {
          signal: reattachController.signal,
        },
      );
      for await (const rawEvent of eventResult.stream) {
        const eventOutcome = await input.onEvent(rawEvent);
        if (eventOutcome !== "continue") {
          return eventOutcome;
        }
        if (input.isAbortRequested()) {
          return "aborted";
        }
      }
    } catch (error) {
      if (!reattachController.signal.aborted) {
        input.logReattachFailure?.(attempt, error);
      }
    } finally {
      clearTimeout(reattachTimeoutId);
    }
  }

  if (!input.runtimeClient.status) {
    return "unknown";
  }

  let observedActiveStatus = false;
  while (true) {
    const remainingRunTimeMs = input.getRemainingRunTimeMs();
    if (remainingRunTimeMs <= 0) {
      return "timed_out";
    }
    if (input.isAbortRequested() || (await input.refreshCancellationSignal())) {
      return "aborted";
    }
    await input.pollExternalInterruptAndSuspendIfNeeded();

    try {
      const statusResult = await input.runtimeClient.status();
      if (statusResult.error) {
        input.logStatusPollError?.(statusResult.error);
        return "unknown";
      }

      const statusType = getRuntimeStatusTypeForSession(statusResult.data, input.sessionId);
      if (statusType === "idle") {
        return "idle";
      }
      if (statusType === "busy" || statusType === "retry") {
        observedActiveStatus = true;
      } else {
        const messagesResult = await input.runtimeClient.messages({
          sessionID: input.sessionId,
          limit: 20,
        });
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
      input.logStatusReconciliationFailure?.(error);
      return "unknown";
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(input.statusPollIntervalMs, remainingRunTimeMs)),
    );
  }
}

export async function captureOpenCodeUsageFromSession(
  runtimeClient: RuntimeHarnessClient,
  sessionId: string,
): Promise<{ inputTokens: number; outputTokens: number } | null> {
  const messagesResult = await runtimeClient.messages({ sessionID: sessionId });
  if (messagesResult.error) {
    return null;
  }
  return aggregateConversationUsageFromSessionMessages(messagesResult.data);
}
