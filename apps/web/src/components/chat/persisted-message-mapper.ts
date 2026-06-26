import type { MessageTiming } from "./chat-performance-metrics";
import type { Message, MessagePart, SandboxFileData } from "./message-list";

type PersistedContentPart =
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
  contentParts?: PersistedContentPart[] | null;
  timing?: MessageTiming | null;
  attachments?: Array<{
    id?: string;
    filename: string;
    mimeType: string;
    previewUrl?: string;
  }>;
  sandboxFiles?: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number | null;
    downloadUrl?: string | null;
  }>;
};

export function mapPersistedMessagesToChatMessages(
  messages: PersistedConversationMessage[],
): Message[] {
  return messages.map((message) => {
    let parts: MessagePart[] | undefined;

    if (message.contentParts && message.contentParts.length > 0) {
      const toolResults = new Map<string, unknown>();

      for (const part of message.contentParts) {
        if (part.type === "tool_result") {
          toolResults.set(part.tool_use_id, part.content);
        }
      }

      parts = message.contentParts
        .filter((part) => part.type !== "tool_result")
        .map((part) => {
          if (part.type === "text") {
            return { type: "text", content: part.text } as MessagePart;
          }
          if (part.type === "thinking") {
            return { type: "thinking", id: part.id, content: part.content } as MessagePart;
          }
          if (part.type === "system") {
            return { type: "system", content: part.content } as MessagePart;
          }
          if (part.type === "approval") {
            return {
              type: "approval",
              toolUseId: part.tool_use_id,
              toolName: part.tool_name,
              toolInput: part.tool_input,
              integration: part.integration,
              operation: part.operation,
              command: part.command,
              status: part.status,
              questionAnswers: part.question_answers,
            } as MessagePart;
          }
          if (part.type === "coworker_invocation") {
            return {
              type: "coworker_invocation",
              coworkerId: part.coworker_id,
              username: part.username,
              name: part.name,
              runId: part.run_id,
              conversationId: part.conversation_id,
              generationId: part.generation_id,
              status: part.status,
              attachmentNames: part.attachment_names ?? [],
              message: part.message,
            } as MessagePart;
          }

          return {
            type: "tool_call",
            id: part.id,
            name: part.name,
            input: part.input,
            result: toolResults.get(part.id),
            integration: part.integration,
            operation: part.operation,
          } as MessagePart;
        });
    }

    return {
      id: message.id,
      role: (message.role as Message["role"]) ?? "assistant",
      content: message.content,
      parts,
      timing: message.timing ?? undefined,
      attachments: message.attachments?.map((attachment) => ({
        id: attachment.id,
        name: attachment.filename,
        mimeType: attachment.mimeType,
        previewUrl: attachment.previewUrl,
      })),
      sandboxFiles: message.sandboxFiles?.map(
        (file) =>
          ({
            path: file.path,
            filename: file.filename,
            mimeType: file.mimeType,
            fileId: file.fileId,
            sizeBytes: file.sizeBytes ?? null,
            downloadUrl: file.downloadUrl,
          }) satisfies SandboxFileData,
      ),
    } satisfies Message;
  });
}
