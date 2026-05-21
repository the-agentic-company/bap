import type { RuntimeHarnessClient } from "../../sandbox/core/types";
import type { SandboxBackend } from "../../sandbox/types";
import {
  buildOpencodeExportCommand,
  extractEmbeddedJsonObject,
} from "../../services/opencode-session-snapshot-service";
import {
  classifyRuntimeFailure,
  type RuntimeExportState,
  type RuntimeFailureClassification,
} from "../../services/lifecycle-policy";

export type OpenCodeRuntimeFailurePendingInterruptKind = "auth" | "approval" | null | undefined;

export type OpenCodeRuntimeFailureInspection = {
  classification: RuntimeFailureClassification;
  exportState: RuntimeExportState;
  exportedPayload?: unknown;
};

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
  const data = payload as {
    messages?: Array<{
      info?: { role?: string };
      parts?: ExportedAssistantPart[];
    }>;
  };
  const assistantMessages = (data.messages ?? []).filter(
    (entry) => entry?.info?.role === "assistant",
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

export function isMissingOpenCodeSandboxError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sandbox") &&
    (normalized.includes("not found") ||
      normalized.includes("not_running") ||
      normalized.includes("not running") ||
      normalized.includes("dead") ||
      normalized.includes("paused"))
  );
}

export async function inspectOpenCodeRuntimeFailureState(input: {
  sessionId?: string | null;
  client?: RuntimeHarnessClient;
  sandbox?: SandboxBackend;
  pendingInterruptKind?: OpenCodeRuntimeFailurePendingInterruptKind;
  canRecover: boolean;
}): Promise<OpenCodeRuntimeFailureInspection> {
  if (input.pendingInterruptKind === "auth") {
    return {
      classification: "waiting_auth",
      exportState: "waiting_auth",
    };
  }
  if (input.pendingInterruptKind === "approval") {
    return {
      classification: "waiting_approval",
      exportState: "waiting_approval",
    };
  }

  let sandboxState: "live" | "missing" | "paused" | "dead" | "unknown" = input.sandbox
    ? "live"
    : "unknown";
  let exportState: RuntimeExportState = "non_terminal";
  let exportedPayload: unknown;

  if (input.sessionId && input.client) {
    try {
      const sessionResult = await input.client.getSession({ sessionID: input.sessionId });
      if (sessionResult.error) {
        if (isMissingOpenCodeSandboxError(sessionResult.error)) {
          sandboxState = "missing";
        }
      } else if (sessionResult.data && sandboxState === "unknown") {
        sandboxState = "live";
      }
    } catch (error) {
      if (isMissingOpenCodeSandboxError(error)) {
        sandboxState = "missing";
      }
    }
  }

  if (input.sandbox && input.sessionId) {
    try {
      const exportResult = await input.sandbox.execute(
        buildOpencodeExportCommand(input.sessionId),
        {
          timeout: 15_000,
        },
      );
      if (exportResult.exitCode === 0) {
        exportedPayload = JSON.parse(extractEmbeddedJsonObject(exportResult.stdout));
        exportState = extractRuntimeExportState(exportedPayload);
        sandboxState = "live";
      } else if (isMissingOpenCodeSandboxError(exportResult.stderr || exportResult.stdout)) {
        sandboxState = "missing";
      } else {
        exportState = "broken";
      }
    } catch (error) {
      if (isMissingOpenCodeSandboxError(error)) {
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
      canRecover: input.canRecover,
    }),
    exportState,
    exportedPayload,
  };
}
