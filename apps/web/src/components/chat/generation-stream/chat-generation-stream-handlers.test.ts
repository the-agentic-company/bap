import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedGenerationError } from "@/lib/generation-errors";
import type { GenerationRuntime } from "@/lib/generation-runtime";
import type { Message } from "../message-list";
import {
  createChatGenerationStreamHandlers,
  type ChatGenerationStreamHandlersParams,
} from "./chat-generation-stream-handlers";

const mockRuntimeMethod = () => vi.fn<(...args: unknown[]) => unknown>();

function createRuntime() {
  return {
    buildAssistantMessage: vi.fn<
      () => {
        content: string;
        parts: { type: "text"; text: string }[];
        integrationsUsed: string[];
        sandboxFiles: [];
      }
    >(() => ({
      content: "assistant text",
      parts: [{ type: "text", text: "assistant text" }],
      integrationsUsed: ["github"],
      sandboxFiles: [],
    })),
    getActivityStats: vi.fn<() => []>(() => []),
    handleApproval: mockRuntimeMethod(),
    handleApprovalResult: mockRuntimeMethod(),
    handleAuthNeeded: mockRuntimeMethod(),
    handleAuthProgress: mockRuntimeMethod(),
    handleAuthResult: mockRuntimeMethod(),
    handleDone: mockRuntimeMethod(),
    handleError: mockRuntimeMethod(),
    handlePendingApproval: mockRuntimeMethod(),
    handleSandboxFile: mockRuntimeMethod(),
    handleSystem: mockRuntimeMethod(),
    handleText: mockRuntimeMethod(),
    handleThinking: mockRuntimeMethod(),
    handleToolResult: mockRuntimeMethod(),
    handleToolUse: mockRuntimeMethod(),
    resolveAuthSuccess: mockRuntimeMethod(),
    snapshot: {
      parts: [],
      segments: [],
      integrationsUsed: [],
      sandboxFiles: [],
      traceStatus: "streaming",
    },
  } as unknown as GenerationRuntime & {
    buildAssistantMessage: ReturnType<typeof vi.fn>;
    handleText: ReturnType<typeof vi.fn>;
    handleToolUse: ReturnType<typeof vi.fn>;
    handleToolResult: ReturnType<typeof vi.fn>;
    handleSystem: ReturnType<typeof vi.fn>;
    handleDone: ReturnType<typeof vi.fn>;
    handlePendingApproval: ReturnType<typeof vi.fn>;
    handleAuthNeeded: ReturnType<typeof vi.fn>;
    resolveAuthSuccess: ReturnType<typeof vi.fn>;
  };
}

function createParams(
  overrides: Partial<ChatGenerationStreamHandlersParams> = {},
): ChatGenerationStreamHandlersParams & {
  runtime: ReturnType<typeof createRuntime>;
} {
  const runtime = createRuntime();
  const params: ChatGenerationStreamHandlersParams = {
    activeConversationId: "conversation-1",
    autoApproveEnabled: false,
    authCompletionRef: { current: null },
    currentGenerationIdRef: { current: "generation-1" },
    forceCoworkerQuerySync: true,
    handleGenerationCancelledUi: vi.fn<() => void>(),
    handleGenerationDoneUi: vi.fn<() => void>(),
    handleInitStatusChange: vi.fn<ChatGenerationStreamHandlersParams["handleInitStatusChange"]>(),
    handleVisibleGenerationError:
      vi.fn<ChatGenerationStreamHandlersParams["handleVisibleGenerationError"]>(),
    hydrateAssistantMessage: vi.fn<
      (newConversationId: string, messageId: string, fallback: Message) => Promise<Message>
    >(async (_conversationId, messageId, fallback) => ({
      ...fallback,
      id: messageId,
      content: "hydrated",
    })),
    isStreamEventForActiveScope: vi.fn<
      ChatGenerationStreamHandlersParams["isStreamEventForActiveScope"]
    >(() => true),
    locallyCompletedGenerationIdRef: { current: null },
    locallyStoppedGenerationIdRef: { current: null },
    markInitMissingAtEnd: vi.fn<ChatGenerationStreamHandlersParams["markInitMissingAtEnd"]>(),
    markInitSignal: vi.fn<ChatGenerationStreamHandlersParams["markInitSignal"]>(),
    persistInterruptedRuntimeMessage:
      vi.fn<ChatGenerationStreamHandlersParams["persistInterruptedRuntimeMessage"]>(),
    queryClient: new QueryClient(),
    runtime,
    runtimeRef: { current: runtime },
    streamGenerationId: "generation-1",
    streamScope: 1,
    submitApproval: vi.fn<ChatGenerationStreamHandlersParams["submitApproval"]>(
      async () => undefined,
    ),
    suppressLiveActivityRef: { current: false },
    syncConversationForNewChat:
      vi.fn<ChatGenerationStreamHandlersParams["syncConversationForNewChat"]>(),
    syncCoworkerAfterToolResult:
      vi.fn<ChatGenerationStreamHandlersParams["syncCoworkerAfterToolResult"]>(),
    syncFromRuntime: vi.fn<ChatGenerationStreamHandlersParams["syncFromRuntime"]>(),
    trackCoworkerEditToolUse:
      vi.fn<ChatGenerationStreamHandlersParams["trackCoworkerEditToolUse"]>(),
    triggerCoworkerSync: vi.fn<ChatGenerationStreamHandlersParams["triggerCoworkerSync"]>(),
    upsertMessageById: vi.fn<ChatGenerationStreamHandlersParams["upsertMessageById"]>(),
    ...overrides,
  };
  return params as ChatGenerationStreamHandlersParams & {
    runtime: ReturnType<typeof createRuntime>;
  };
}

describe("createChatGenerationStreamHandlers", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("rejects stale stream events before mutating runtime state", () => {
    const params = createParams({
      isStreamEventForActiveScope: vi.fn<
        ChatGenerationStreamHandlersParams["isStreamEventForActiveScope"]
      >(() => false),
    });
    const handlers = createChatGenerationStreamHandlers(params);

    handlers.onText?.("ignored");
    handlers.onToolUse?.({
      toolUseId: "tool-1",
      toolName: "coworker.edit",
      integration: "coworker",
      operation: "edit",
      toolInput: {},
    });

    expect(params.runtime.handleText).not.toHaveBeenCalled();
    expect(params.runtime.handleToolUse).not.toHaveBeenCalled();
    expect(params.syncFromRuntime).not.toHaveBeenCalled();
    expect(params.trackCoworkerEditToolUse).not.toHaveBeenCalled();
  });

  it("shares text handling for start and reconnect handlers", () => {
    const startParams = createParams({
      streamGenerationId: undefined,
      onStarted: vi.fn<NonNullable<ChatGenerationStreamHandlersParams["onStarted"]>>(),
    });
    const reconnectParams = createParams({
      streamGenerationId: "generation-1",
    });

    const startHandlers = createChatGenerationStreamHandlers(startParams);
    const reconnectHandlers = createChatGenerationStreamHandlers(reconnectParams);
    startHandlers.onStarted?.("generation-1", "conversation-1");
    startHandlers.onText?.("start text");
    reconnectHandlers.onText?.("reconnect text");

    expect(startParams.runtime.handleText).toHaveBeenCalledWith("start text");
    expect(reconnectParams.runtime.handleText).toHaveBeenCalledWith("reconnect text");
    expect(startParams.syncFromRuntime).toHaveBeenCalledWith(startParams.runtime);
    expect(reconnectParams.syncFromRuntime).toHaveBeenCalledWith(reconnectParams.runtime);
  });

  it("hydrates done messages, clears active generation, and ignores later errors", async () => {
    const params = createParams();
    const handlers = createChatGenerationStreamHandlers(params);

    await handlers.onDone?.("generation-1", "conversation-1", "message-1", {
      inputTokens: 1,
      outputTokens: 2,
      totalCostUsd: 0.01,
    });
    handlers.onError?.({
      message: "late error",
      phase: "stream",
    } as NormalizedGenerationError);

    expect(params.runtime.handleDone).toHaveBeenCalledWith({
      generationId: "generation-1",
      conversationId: "conversation-1",
      messageId: "message-1",
    });
    expect(params.locallyCompletedGenerationIdRef.current).toBe("generation-1");
    expect(params.suppressLiveActivityRef.current).toBe(true);
    expect(params.handleGenerationDoneUi).toHaveBeenCalledTimes(1);
    expect(params.upsertMessageById).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1", content: "assistant text" }),
    );
    expect(params.upsertMessageById).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1", content: "hydrated" }),
    );
    expect(params.handleVisibleGenerationError).not.toHaveBeenCalled();
  });

  it("routes errors through visible error handling", () => {
    const params = createParams();
    const handlers = createChatGenerationStreamHandlers(params);
    const error = { message: "failed", phase: "stream" } as NormalizedGenerationError;

    handlers.onError?.(error);
    handlers.onText?.("ignored after error");

    expect(params.handleVisibleGenerationError).toHaveBeenCalledWith(error, params.runtime);
    expect(params.runtime.handleText).not.toHaveBeenCalled();
  });

  it("persists interrupted runtime messages on cancellation", () => {
    const params = createParams();
    const handlers = createChatGenerationStreamHandlers(params);

    handlers.onCancelled?.({
      generationId: "generation-1",
      conversationId: "conversation-1",
      messageId: "message-1",
    });

    expect(params.persistInterruptedRuntimeMessage).toHaveBeenCalledWith(
      params.runtime,
      "message-1",
    );
    expect(params.markInitMissingAtEnd).toHaveBeenCalledWith("cancelled");
    expect(params.handleGenerationCancelledUi).toHaveBeenCalledTimes(1);
  });

  it("resumes matching auth completion while handling auth-needed events", () => {
    const params = createParams({
      authCompletionRef: {
        current: {
          integration: "github",
          interruptId: "auth-1",
        },
      },
    });
    const handlers = createChatGenerationStreamHandlers(params);

    handlers.onAuthNeeded?.({
      conversationId: "conversation-1",
      generationId: "generation-1",
      integrations: ["github"],
      interruptId: "auth-1",
    });

    expect(params.runtime.handleAuthNeeded).toHaveBeenCalled();
    expect(params.runtime.resolveAuthSuccess).toHaveBeenCalledWith("github");
    expect(params.syncFromRuntime).toHaveBeenCalledWith(params.runtime);
  });

  it("submits auto approval for non-question approval requests", async () => {
    const params = createParams({ autoApproveEnabled: true });
    const handlers = createChatGenerationStreamHandlers(params);

    await handlers.onPendingApproval?.({
      conversationId: "conversation-1",
      generationId: "generation-1",
      integration: "github",
      interruptId: "approval-1",
      operation: "create_issue",
      toolInput: {},
      toolName: "github.create_issue",
      toolUseId: "tool-1",
    });

    expect(params.currentGenerationIdRef.current).toBe("generation-1");
    expect(params.runtime.handlePendingApproval).toHaveBeenCalled();
    expect(params.submitApproval).toHaveBeenCalledWith({
      interruptId: "approval-1",
      decision: "approve",
    });
  });

  it("invokes Coworker sync adapter callbacks for relevant stream events", () => {
    const params = createParams();
    const handlers = createChatGenerationStreamHandlers(params);

    handlers.onSystem?.({ content: "updated", coworkerId: "coworker-1" });
    handlers.onToolUse?.({
      toolUseId: "tool-1",
      toolName: "coworker.edit",
      integration: "coworker",
      operation: "edit",
      toolInput: {},
    });
    handlers.onToolResult?.("coworker.edit", { coworkerId: "coworker-1" }, "tool-1");

    expect(params.triggerCoworkerSync).toHaveBeenCalledWith({ coworkerId: "coworker-1" });
    expect(params.trackCoworkerEditToolUse).toHaveBeenCalledWith(
      expect.objectContaining({
        toolUseId: "tool-1",
        integration: "coworker",
        operation: "edit",
      }),
    );
    expect(params.syncCoworkerAfterToolResult).toHaveBeenCalledWith("tool-1", {
      coworkerId: "coworker-1",
    });
  });
});
