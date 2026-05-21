import type {
  RuntimePermissionRequest,
  RuntimeQuestionRequest,
} from "./runtime-driver";
import {
  buildDefaultQuestionAnswers,
  buildQuestionCommand,
} from "./runtime-driver";

export const RUNTIME_INTERRUPT_PROVIDER = "opencode" as const;
export const RUNTIME_CONTENT_INTEGRATION = "cmdclaw" as const;

export type RuntimePendingApprovalDisplay = {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  integration?: string;
  operation?: string;
  command?: string;
};

function uniqueRuntimeToolUseId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function extractRuntimeCallIdFromProviderRequestId(
  providerRequestId: string | null | undefined,
): string | null {
  if (!providerRequestId) {
    return null;
  }
  const separatorIndex = providerRequestId.lastIndexOf(":");
  if (separatorIndex === -1 || separatorIndex === providerRequestId.length - 1) {
    return null;
  }
  return providerRequestId.slice(separatorIndex + 1);
}

export function isRuntimeInterruptProvider(provider: string | null | undefined): boolean {
  return provider === RUNTIME_INTERRUPT_PROVIDER;
}

export function buildRuntimePermissionPendingApproval(
  request: RuntimePermissionRequest,
): RuntimePendingApprovalDisplay {
  const permissionType = request.permission || "file access";
  const patterns = request.patterns;
  const command = patterns?.length
    ? `${permissionType}: ${patterns.join(", ")}`
    : permissionType;
  return {
    toolUseId: uniqueRuntimeToolUseId("runtime-perm"),
    toolName: "Permission",
    toolInput: request as unknown as Record<string, unknown>,
    integration: RUNTIME_CONTENT_INTEGRATION,
    operation: permissionType,
    command,
  };
}

export function buildRuntimeQuestionPendingApproval(
  request: RuntimeQuestionRequest,
): {
  display: RuntimePendingApprovalDisplay;
  defaultAnswers: string[][];
} {
  const linkedToolUseId = request.tool?.callId;
  return {
    display: {
      toolUseId:
        linkedToolUseId ?? uniqueRuntimeToolUseId("runtime-question"),
      toolName: "question",
      toolInput: request as unknown as Record<string, unknown>,
      integration: RUNTIME_CONTENT_INTEGRATION,
      operation: "question",
      command: buildQuestionCommand(request),
    },
    defaultAnswers: buildDefaultQuestionAnswers(request),
  };
}

export function buildRuntimeQuestionToolUseEvent(input: {
  toolUseId: string;
  toolInput: Record<string, unknown>;
}): {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  integration: string;
  operation: string;
} {
  return {
    toolName: "question",
    toolInput: input.toolInput,
    toolUseId: input.toolUseId,
    integration: RUNTIME_CONTENT_INTEGRATION,
    operation: "question",
  };
}
