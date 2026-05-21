import type { ContentPart } from "@cmdclaw/db/schema";
import { parseBashCommand } from "../../../ai/permission-checker";
import type { GenerationEvent } from "../types";

type ToolUseMetadata = {
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

function getToolUseMetadata(
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

function getReplayToolUseMetadata(
  part: Extract<ContentPart, { type: "tool_use" }>,
): ToolUseMetadata {
  if (part.integration || part.operation) {
    return {
      integration: part.integration,
      operation: part.operation,
    };
  }
  const parsed = getToolUseMetadata(part.name, part.input);
  if (!parsed.integration && !parsed.operation) {
    return {};
  }
  return parsed;
}

export function buildGenerationReplayPartEvent(input: {
  generationId: string;
  runtimeId: string | null;
  conversationId: string;
  turnSeq: number;
  part: ContentPart;
  parts: ContentPart[];
}): GenerationEvent | null {
  const { generationId, runtimeId, conversationId, turnSeq, part, parts } = input;
  if (part.type === "text") {
    return { type: "text", content: part.text };
  }
  if (part.type === "tool_use") {
    const metadata = getReplayToolUseMetadata(part);
    const event: GenerationEvent = {
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
    const toolUse = parts.find(
      (candidate): candidate is ContentPart & { type: "tool_use" } =>
        candidate.type === "tool_use" && candidate.id === part.tool_use_id,
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

export { getToolUseMetadata };
