import type { RuntimeHarnessClient } from "../../sandbox/core/types";
import { aggregateConversationUsageFromSessionMessages } from "../../services/conversation-usage-service";
import type { OpenCodeTerminalEventOutcome } from "./opencode-runtime-events";
import { formatErrorMessage, summarizeUnknownValue } from "./opencode-runtime-error-format";

export type OpenCodeTerminalReconciliationOutcome =
  | "idle"
  | "error"
  | "timed_out"
  | "aborted"
  | "unknown";

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
