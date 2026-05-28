import { describe, expect, it, vi } from "vitest";
import type { ContentPart } from "@cmdclaw/db/schema";
import type { RuntimePart } from "../../sandbox/core/types";
import { OpenCodeEventTranslator, type OpenCodeTrackedEvent } from "./opencode-event-translator";

type TestContext = {
  id: string;
  userMessageContent: string;
  assistantContent: string;
  contentParts: ContentPart[];
  phaseMarks?: Record<string, number>;
  sessionId?: string;
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<string, { firstQueuedAtMs: number; parts: RuntimePart[] }>;
  runtimeTools: Map<
    string,
    {
      sessionId?: string;
      messageId: string;
      partId: string;
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  >;
};

function createContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    id: "gen-1",
    userMessageContent: "hello",
    assistantContent: "",
    contentParts: [],
    phaseMarks: {},
    assistantMessageIds: new Set(),
    messageRoles: new Map(),
    pendingMessageParts: new Map(),
    runtimeTools: new Map(),
    ...overrides,
  };
}

function createTranslator() {
  return new OpenCodeEventTranslator<TestContext>({
    markPhase: (ctx, phase) => {
      ctx.phaseMarks ??= {};
      ctx.phaseMarks[phase] = Date.now();
    },
    broadcast: () => {},
    scheduleSave: () => {},
    saveProgress: async () => {},
    getToolUseMetadata: () => ({}),
  });
}

describe("OpenCodeEventTranslator", () => {
  it("bounds pending unknown message parts and resets queue after TTL", async () => {
    vi.useFakeTimers();
    try {
      const translator = createTranslator();
      const ctx = createContext();

      const processEvent = async (id: string, text = "hello") => {
        const progressKind = await translator.processEvent({
          ctx,
          event: {
            type: "message.part.updated",
            properties: {
              part: {
                id,
                type: "text",
                text,
                messageID: "msg-unknown",
              },
            },
          } as unknown as OpenCodeTrackedEvent,
          currentTextPart: null,
          currentTextPartId: null,
          setCurrentTextPart: () => {},
        });
        expect(progressKind).toBeNull();
      };

      for (let i = 0; i < 120; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- sequential enqueueing is intentional
        await processEvent(`part-${i}`);
      }

      const queuedBeforeTtl = ctx.pendingMessageParts.get("msg-unknown");
      expect(queuedBeforeTtl).toBeDefined();
      expect(queuedBeforeTtl?.parts).toHaveLength(100);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      await processEvent("part-after-ttl");

      const queuedAfterTtl = ctx.pendingMessageParts.get("msg-unknown");
      expect(queuedAfterTtl).toBeDefined();
      expect(queuedAfterTtl?.parts).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("truncates oversized OpenCode tool results before storing content parts", async () => {
    const translator = createTranslator();
    const ctx = createContext({
      contentParts: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo big" },
        } as ContentPart,
      ],
      messageRoles: new Map([["assistant-msg", "assistant"]]),
    });

    const hugeOutput = "x".repeat(120_000);

    const progressKind = await translator.processEvent({
      ctx,
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-part-1",
            type: "tool",
            tool: "bash",
            callID: "tool-1",
            messageID: "assistant-msg",
            state: {
              status: "completed",
              output: hugeOutput,
            },
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });

    const toolResult = ctx.contentParts.find(
      (part) => part.type === "tool_result" && part.tool_use_id === "tool-1",
    );

    expect(toolResult).toBeDefined();
    expect(progressKind).toBe("tool_result");
    expect(typeof toolResult?.content).toBe("string");
    expect(String(toolResult?.content)).toContain("... (output truncated)");
    expect(String(toolResult?.content).length).toBeLessThanOrEqual(100_024);
  });

  it("sanitizes NUL bytes from OpenCode content before storing content parts", async () => {
    const translator = createTranslator();
    const ctx = createContext({
      messageRoles: new Map([["assistant-msg", "assistant"]]),
    });

    const baseEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          type: "tool",
          tool: "webfetch",
          callID: "tool-1",
          messageID: "assistant-msg",
        },
      },
    };

    const runningProgressKind = await translator.processEvent({
      ctx,
      event: {
        ...baseEvent,
        properties: {
          part: {
            ...baseEvent.properties.part,
            state: {
              status: "running",
              input: { url: "https://example.com/\u0000" },
            },
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });
    expect(runningProgressKind).toBe("tool_use");

    const completedProgressKind = await translator.processEvent({
      ctx,
      event: {
        ...baseEvent,
        properties: {
          part: {
            ...baseEvent.properties.part,
            state: {
              status: "completed",
              output: "before\u0000after",
            },
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });
    expect(completedProgressKind).toBe("tool_result");

    const serializedParts = JSON.stringify(ctx.contentParts);
    expect(serializedParts).not.toContain("\\u0000");
    expect(serializedParts).toContain("before�after");
  });

  it("reports text and reasoning deltas as runtime progress", async () => {
    const translator = createTranslator();
    const ctx = createContext({
      messageRoles: new Map([["assistant-msg", "assistant"]]),
    });

    const textProgressKind = await translator.processEvent({
      ctx,
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-1",
            type: "text",
            text: "Bonjour",
            messageID: "assistant-msg",
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });

    const reasoningProgressKind = await translator.processEvent({
      ctx,
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "reasoning-part-1",
            type: "reasoning",
            text: "Thinking",
            messageID: "assistant-msg",
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });

    expect(textProgressKind).toBe("text_delta");
    expect(reasoningProgressKind).toBe("reasoning_delta");
  });

  it("does not report empty assistant message creation as runtime progress", async () => {
    const translator = createTranslator();
    const ctx = createContext();

    const progressKind = await translator.processEvent({
      ctx,
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-empty",
            role: "assistant",
          },
        },
      } as unknown as OpenCodeTrackedEvent,
      currentTextPart: null,
      currentTextPartId: null,
      setCurrentTextPart: () => {},
    });

    expect(progressKind).toBeNull();
    expect(ctx.assistantMessageIds.has("assistant-empty")).toBe(true);
    expect(ctx.contentParts).toHaveLength(0);
  });
});
