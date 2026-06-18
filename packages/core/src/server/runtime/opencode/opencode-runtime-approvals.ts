import type {
  RuntimeHarnessClient,
  RuntimePermissionRequest,
  RuntimeQuestionRequest,
} from "../../sandbox/core/types";
import type { OpenCodeActionableEvent } from "./opencode-runtime-events";
import { coverOpenCodeToolState } from "./opencode-runtime-events";

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
          integration: "bap",
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
          integration: "bap",
          operation: "question",
          command,
        },
      };
    }
    default:
      return assertNever(input.event);
  }
}
