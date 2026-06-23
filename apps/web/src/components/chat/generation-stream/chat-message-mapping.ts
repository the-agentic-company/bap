import type { RuntimeActivityStats } from "@/lib/generation-runtime";
import type { AttachmentData, Message, MessagePart, SandboxFileData } from "../message-list";

export type PersistedContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | {
      type: "approval";
      tool_use_id: string;
      tool_name: string;
      tool_input: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
      question_answers?: string[][];
    }
  | {
      type: "coworker_invocation";
      coworker_id: string;
      username: string;
      name: string;
      run_id: string;
      conversation_id: string;
      generation_id: string | null;
      status:
        | "running"
        | "needs_user_input"
        | "awaiting_approval"
        | "awaiting_auth"
        | "paused"
        | "cancelling"
        | "completed"
        | "error"
        | "cancelled";
      attachment_names?: string[];
      message: string;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

export type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentParts?: PersistedContentPart[];
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles?: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
  }>;
  timing?: Message["timing"];
};

export function mapPersistedMessageToChatMessage(m: PersistedConversationMessage): Message {
  let parts: MessagePart[] | undefined;
  if (m.contentParts && m.contentParts.length > 0) {
    const toolResults = new Map<string, unknown>();
    for (const part of m.contentParts) {
      if (part.type === "tool_result") {
        toolResults.set(part.tool_use_id, part.content);
      }
    }
    parts = m.contentParts
      .filter((p) => p.type !== "tool_result")
      .map((p) => {
        if (p.type === "text") {
          return { type: "text" as const, content: p.text };
        }
        if (p.type === "thinking") {
          return {
            type: "thinking" as const,
            id: p.id,
            content: p.content,
          };
        }
        if (p.type === "system") {
          return { type: "system" as const, content: p.content };
        }
        if (p.type === "approval") {
          return {
            type: "approval" as const,
            toolUseId: p.tool_use_id,
            toolName: p.tool_name,
            toolInput: p.tool_input,
            integration: p.integration,
            operation: p.operation,
            command: p.command,
            status: p.status,
            questionAnswers: p.question_answers,
          };
        }
        if (p.type === "coworker_invocation") {
          return {
            type: "coworker_invocation" as const,
            coworkerId: p.coworker_id,
            username: p.username,
            name: p.name,
            runId: p.run_id,
            conversationId: p.conversation_id,
            generationId: p.generation_id,
            status: p.status,
            attachmentNames: p.attachment_names ?? [],
            message: p.message,
          };
        }
        return {
          type: "tool_call" as const,
          id: p.id,
          name: p.name,
          input: p.input,
          result: toolResults.get(p.id),
          integration: p.integration,
          operation: p.operation,
        };
      });
  }

  const attachments =
    m.attachments && m.attachments.length > 0
      ? m.attachments.map(
          (a): AttachmentData => ({
            id: a.id,
            name: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          }),
        )
      : undefined;

  const sandboxFiles =
    m.sandboxFiles && m.sandboxFiles.length > 0
      ? m.sandboxFiles.map(
          (f): SandboxFileData => ({
            fileId: f.fileId,
            path: f.path,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
          }),
        )
      : undefined;

  return {
    id: m.id,
    role: m.role as Message["role"],
    content: m.content,
    parts,
    attachments,
    sandboxFiles,
    timing: m.timing,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withEndToEndDuration(
  timing: Message["timing"] | undefined,
  startedAtMs: number | undefined,
  completedAtMs = Date.now(),
): Message["timing"] | undefined {
  if (!startedAtMs) {
    return timing;
  }
  return {
    ...timing,
    endToEndDurationMs: Math.max(0, completedAtMs - startedAtMs),
  };
}

export function withActivityDurations(
  timing: Message["timing"] | undefined,
  stats: RuntimeActivityStats,
): Message["timing"] | undefined {
  if (stats.totalToolCalls === 0) {
    return timing;
  }
  return {
    ...timing,
    activityDurationsMs: {
      ...timing?.activityDurationsMs,
      totalToolCalls: stats.totalToolCalls,
      completedToolCalls: stats.completedToolCalls,
      totalToolDurationMs: stats.totalToolDurationMs,
      maxToolDurationMs: stats.maxToolDurationMs,
      perToolUseIdMs: {
        ...timing?.activityDurationsMs?.perToolUseIdMs,
        ...stats.perToolUseIdMs,
      },
    },
  };
}
