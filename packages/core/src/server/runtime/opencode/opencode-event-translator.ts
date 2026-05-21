import type { ContentPart } from "@cmdclaw/db/schema";
import type {
  RuntimeEvent,
  RuntimePart,
  RuntimeQuestionRequest,
} from "../../sandbox/core/types";
import type { GenerationEvent } from "../../services/generation/types";

const PENDING_MESSAGE_PARTS_MAX_PER_MESSAGE = 100;
const PENDING_MESSAGE_PARTS_TTL_MS = 5 * 60 * 1000;
const MAX_TOOL_RESULT_CONTENT_CHARS = 100_000;

export type OpenCodeTrackedEvent = Extract<
  RuntimeEvent,
  {
    type: "message.updated" | "message.part.updated" | "session.updated" | "session.status";
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

export type OpenCodeToolUseMetadata = {
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export interface OpenCodeTranslationContext {
  id: string;
  userMessageContent: string;
  assistantContent: string;
  contentParts: ContentPart[];
  phaseMarks?: Record<string, number>;
  sessionId?: string;
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
}

type CurrentTextPart = { type: "text"; text: string } | null;

type OpenCodeEventTranslatorCallbacks<TContext extends OpenCodeTranslationContext> = {
  markPhase: (ctx: TContext, phase: string) => void;
  broadcast: (ctx: TContext, event: GenerationEvent) => void;
  scheduleSave: (ctx: TContext) => void;
  saveProgress: (ctx: TContext) => Promise<void>;
  getToolUseMetadata: (
    toolName: string,
    toolInput: Record<string, unknown>,
  ) => OpenCodeToolUseMetadata;
  appendToolResultDerivedContentParts?: (input: {
    ctx: TContext;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResult: unknown;
  }) => void;
};

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... (output truncated)`;
}

export function limitToolResultContent(value: unknown): unknown {
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

export function isOpenCodeTrackedEvent(event: RuntimeEvent): event is OpenCodeTrackedEvent {
  return (
    event.type === "message.updated" ||
    event.type === "message.part.updated" ||
    event.type === "session.updated" ||
    event.type === "session.status"
  );
}

export function isOpenCodeActionableEvent(event: RuntimeEvent): event is OpenCodeActionableEvent {
  return (
    event.type === "message.part.updated" ||
    event.type === "permission.asked" ||
    event.type === "question.asked"
  );
}

export class OpenCodeEventTranslator<TContext extends OpenCodeTranslationContext> {
  constructor(private readonly callbacks: OpenCodeEventTranslatorCallbacks<TContext>) {}

  pruneStalePendingMessageParts(ctx: TContext, now = Date.now()): void {
    for (const [messageId, queued] of ctx.pendingMessageParts.entries()) {
      if (now - queued.firstQueuedAtMs > PENDING_MESSAGE_PARTS_TTL_MS) {
        ctx.pendingMessageParts.delete(messageId);
      }
    }
  }

  async processEvent(input: {
    ctx: TContext;
    event: OpenCodeTrackedEvent;
    currentTextPart: CurrentTextPart;
    currentTextPartId: string | null;
    setCurrentTextPart: (part: CurrentTextPart, partId: string | null) => void;
  }): Promise<void> {
    const { ctx, event, currentTextPart, currentTextPartId, setCurrentTextPart } = input;
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
            ctx.pendingMessageParts.delete(messageId);
            let replayTextPart = currentTextPart;
            let replayTextPartId = currentTextPartId;
            const replaySetCurrentTextPart = (
              part: CurrentTextPart,
              partId: string | null,
            ) => {
              replayTextPart = part;
              replayTextPartId = partId;
              setCurrentTextPart(part, partId);
            };
            await Promise.all(
              pendingQueue.parts.map(async (pendingPart) => {
                await this.processMessagePart({
                  ctx,
                  part: pendingPart,
                  currentTextPart: replayTextPart,
                  currentTextPartId: replayTextPartId,
                  setCurrentTextPart: replaySetCurrentTextPart,
                });
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

        await this.processMessagePart({
          ctx,
          part,
          currentTextPart,
          currentTextPartId,
          setCurrentTextPart,
        });
        break;
      }

      case "session.updated": {
        ctx.sessionId = event.properties.info.id;
        break;
      }

      case "session.status": {
        break;
      }
      default:
        return assertNever(event);
    }
  }

  private shouldProcessUnknownMessagePart(ctx: TContext, part: RuntimePart): boolean {
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

    if (userText === fullText || userText.startsWith(fullText) || fullText.startsWith(userText)) {
      return false;
    }

    return true;
  }

  private async processMessagePart(input: {
    ctx: TContext;
    part: RuntimePart;
    currentTextPart: CurrentTextPart;
    currentTextPartId: string | null;
    setCurrentTextPart: (part: CurrentTextPart, partId: string | null) => void;
  }): Promise<void> {
    const { ctx, part, currentTextPart, currentTextPartId, setCurrentTextPart } = input;
    const partId = part.id;

    if (part.type === "text") {
      const fullText = part.text;
      if (fullText) {
        const isNewPart = partId !== currentTextPartId;
        const userText = ctx.userMessageContent.trim();
        const normalizedUserText = userText.trim().replace(/\s+/g, " ");
        let effectiveFullText = fullText;

        const dropEchoPrefix = (value: string): string => {
          let next = value;
          next = next.replace(/^\s*(?:user|human)\s*:\s*/i, "");
          next = next.replace(/^\s*["'`]+/, "");
          if (userText && next.startsWith(userText)) {
            return next.slice(userText.length).trimStart();
          }
          return value;
        };

        if (isNewPart && userText) {
          const normalizedFullText = fullText.trim().replace(/\s+/g, " ");
          if (normalizedFullText === normalizedUserText) {
            return;
          }
          effectiveFullText = dropEchoPrefix(fullText);
        }

        const previousLength = isNewPart ? 0 : (currentTextPart?.text.length ?? 0);
        const delta = effectiveFullText.slice(previousLength);

        if (delta) {
          if (!ctx.phaseMarks?.first_visible_output_emitted) {
            this.callbacks.markPhase(ctx, "first_visible_output_emitted");
          }
          if (!ctx.phaseMarks?.first_token_emitted) {
            this.callbacks.markPhase(ctx, "first_token_emitted");
          }
          ctx.assistantContent += delta;
          this.callbacks.broadcast(ctx, { type: "text", content: delta });

          if (currentTextPart && !isNewPart) {
            currentTextPart.text = effectiveFullText;
          } else {
            const newPart = { type: "text" as const, text: effectiveFullText };
            ctx.contentParts.push(newPart);
            setCurrentTextPart(newPart, partId);
          }
          this.callbacks.scheduleSave(ctx);
        }
      }
    }

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
          this.callbacks.markPhase(ctx, "first_visible_output_emitted");
        }
        this.callbacks.broadcast(ctx, {
          type: "thinking",
          content: delta,
          thinkingId: partId,
        });
      }

      this.callbacks.scheduleSave(ctx);
      return;
    }

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
      const metadata = this.callbacks.getToolUseMetadata(toolName, toolInput);

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

          this.callbacks.broadcast(ctx, {
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
          await this.callbacks.saveProgress(ctx);
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
          this.callbacks.broadcast(ctx, {
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
          this.callbacks.appendToolResultDerivedContentParts?.({
            ctx,
            toolName: existingToolUse.name,
            toolInput: existingToolUse.input,
            toolResult: result,
          });
          await this.callbacks.saveProgress(ctx);
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
          this.callbacks.broadcast(ctx, {
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
          await this.callbacks.saveProgress(ctx);
          return;
        }
        default:
          return assertNever(part.state);
      }
    }
  }
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
