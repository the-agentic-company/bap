import type {
  RuntimeEvent,
  RuntimeHarnessClient,
  RuntimePart,
} from "../../sandbox/core/types";
import type { RuntimeProgressKind } from "../../services/lifecycle-policy";
import { formatErrorMessage } from "./opencode-runtime-error-format";

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
}) => Promise<RuntimeProgressKind | null>;

export type OpenCodeRuntimeEventLoopCallbacks = {
  markFirstEvent: () => void;
  markRuntimeProgress: (kind: RuntimeProgressKind) => void;
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

function extractOpenCodeMessageInfoErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const record = message as Record<string, unknown>;
  const info =
    typeof record.info === "object" && record.info !== null
      ? (record.info as Record<string, unknown>)
      : null;

  if (info?.role !== "assistant" || info.error == null) {
    return null;
  }

  return formatErrorMessage(info.error);
}

function extractOpenCodeMessageErrorMessage(event: RuntimeEvent): string | null {
  if (event.type !== "message.updated") {
    return null;
  }

  const eventProps =
    typeof event.properties === "object" && event.properties !== null
      ? (event.properties as Record<string, unknown>)
      : {};
  return extractOpenCodeMessageInfoErrorMessage(eventProps);
}

export function extractOpenCodeMessageErrorFromSessionMessages(
  payload: unknown,
): string | null {
  const messages = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).messages
      : null;

  if (!Array.isArray(messages)) {
    return null;
  }

  for (const message of messages) {
    const errorMessage = extractOpenCodeMessageInfoErrorMessage(message);
    if (errorMessage) {
      return errorMessage;
    }
  }

  return null;
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

  const messageErrorMessage = extractOpenCodeMessageErrorMessage(event);
  if (messageErrorMessage) {
    return {
      eventCountDelta: 1,
      toolCallCountDelta,
      terminalOutcome: "error",
      errorMessage: messageErrorMessage,
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
  markRuntimeProgress: (kind: RuntimeProgressKind) => void;
  refreshCancellationSignal: () => Promise<boolean>;
  pollExternalInterruptAndSuspendIfNeeded?: () => Promise<void>;
  logEvent: (input: {
    event: RuntimeEvent;
    inspection: OpenCodeRuntimeEventInspection;
  }) => void;
  processTrackedEvent: (event: OpenCodeTrackedEvent) => Promise<RuntimeProgressKind | null>;
  handleActionableEvent: (
    event: OpenCodeActionableEvent,
  ) => Promise<{ type: "none" | "permission" | "question" }>;
  onIdle?: () => void;
  onSessionError?: (errorMessage: string) => void;
}): Promise<OpenCodeRuntimeEventProcessResult> {
  input.markFirstEvent();
  const event = input.event as RuntimeEvent;
  if (await input.refreshCancellationSignal()) {
    return { outcome: "error", errorMessage: null };
  }
  await input.pollExternalInterruptAndSuspendIfNeeded?.();

  const inspection = inspectOpenCodeRuntimeEvent(event);
  input.stats.eventCount += inspection.eventCountDelta;
  input.stats.toolCallCount += inspection.toolCallCountDelta;

  input.logEvent({ event, inspection });

  let progressKind: RuntimeProgressKind | null = null;
  if (isOpenCodeTrackedEvent(event)) {
    progressKind = await input.processTrackedEvent(event);
  }

  if (isOpenCodeActionableEvent(event)) {
    const actionableResult = await input.handleActionableEvent(event);
    if (actionableResult.type === "permission") {
      input.stats.permissionCount += 1;
      progressKind = "permission";
    } else if (actionableResult.type === "question") {
      input.stats.questionCount += 1;
      progressKind = "question";
    }
  }

  if (inspection.terminalOutcome === "idle") {
    progressKind = "session_idle";
    input.markRuntimeProgress(progressKind);
    input.stats.progressEventCount += 1;
    input.onIdle?.();
    return { outcome: "idle", errorMessage: null };
  }

  if (inspection.terminalOutcome === "error") {
    const errorMessage = inspection.errorMessage ?? "Unknown error";
    progressKind = "session_error";
    input.markRuntimeProgress(progressKind);
    input.stats.progressEventCount += 1;
    input.onSessionError?.(errorMessage);
    return { outcome: "error", errorMessage };
  }

  if (progressKind) {
    input.markRuntimeProgress(progressKind);
    input.stats.progressEventCount += 1;
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
      markRuntimeProgress: this.callbacks.markRuntimeProgress,
      refreshCancellationSignal: this.callbacks.refreshCancellationSignal,
      pollExternalInterruptAndSuspendIfNeeded:
        this.callbacks.pollExternalInterruptAndSuspendIfNeeded,
      logEvent: this.callbacks.logEvent ?? (() => undefined),
      processTrackedEvent: async (event) => {
        return await this.callbacks.processTrackedEvent({
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

export { coverOpenCodeToolState };
