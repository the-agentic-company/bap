import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generationFindFirstMock,
  messageFindFirstMock,
  clearPendingRequestMock,
  collectMentionedSandboxFilesMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  clearPendingRequestMock: vi.fn(),
  collectMentionedSandboxFilesMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      message: { findFirst: messageFindFirstMock },
    },
  },
}));

vi.mock("../../../utils/observability", () => ({
  logger: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../sandbox-slot-manager", () => ({
  getSandboxSlotManager: () => ({
    clearPendingRequest: clearPendingRequestMock,
  }),
}));

vi.mock("../files/sandbox-file-collection", () => ({
  collectMentionedSandboxFiles: collectMentionedSandboxFilesMock,
}));

import { GenerationTurnFinalizer } from "./turn-finalizer";

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-1",
    traceId: "trace-1",
    conversationId: "conv-1",
    userId: "user-1",
    runtimeId: "runtime-1",
    sessionId: "session-1",
    status: "running",
    contentParts: [{ type: "text", text: "Final answer" }],
    assistantContent: "Final answer",
    usage: { inputTokens: 3, outputTokens: 5, totalCostUsd: 0 },
    startedAt: new Date("2026-03-11T15:00:00.000Z"),
    lastRuntimeProgressAt: new Date("2026-03-11T15:01:00.000Z"),
    remainingRunMs: 60_000,
    recoveryAttempts: 0,
    completionReason: null,
    isNewConversation: false,
    userMessageContent: "hello",
    model: "openai/gpt-5",
    uploadedSandboxFileIds: new Set<string>(),
    streamPublishedCount: 0,
    streamSequence: 0,
    ...overrides,
  } as any;
}

function createFinalizer(overrides: Partial<Record<string, any>> = {}) {
  const deps = {
    lifecycleStore: {
      appendProgress: vi.fn(),
      finishTurn: vi.fn(async (input: any) => ({
        contentParts: input.contentParts,
        messageId: "msg-1",
      })),
    },
    markPhase: vi.fn(),
    broadcast: vi.fn(),
    stopExternalInterruptPolling: vi.fn(),
    releaseSandboxSlotLease: vi.fn(async () => undefined),
    evictActiveGenerationContext: vi.fn(),
    enqueueConversationQueuedMessageProcess: vi.fn(async () => undefined),
    saveSessionSnapshotIfPossible: vi.fn(async () => undefined),
    ...overrides,
  };
  return { finalizer: new GenerationTurnFinalizer(deps as any), deps };
}

describe("GenerationTurnFinalizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationFindFirstMock.mockResolvedValue(null);
    messageFindFirstMock.mockResolvedValue(null);
    clearPendingRequestMock.mockResolvedValue(undefined);
    collectMentionedSandboxFilesMock.mockResolvedValue({ uploadedCount: 0 });
  });

  it("finishes completed Generations, emits done, and evicts active state", async () => {
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext();

    await finalizer.finishGeneration(ctx, "completed");

    expect(deps.lifecycleStore.finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        conversationId: "conv-1",
        status: "completed",
        assistantContent: "Final answer",
      }),
    );
    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: "done",
        generationId: "gen-1",
        conversationId: "conv-1",
        messageId: "msg-1",
      }),
    );
    expect(deps.saveSessionSnapshotIfPossible).toHaveBeenCalledWith(ctx, "finish:completed");
    expect(deps.evictActiveGenerationContext).toHaveBeenCalledWith("gen-1");
    expect(ctx.status).toBe("completed");
  });

  it("emits cancelled terminal events without saving a completed session snapshot", async () => {
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext();

    await finalizer.finishGeneration(ctx, "cancelled");

    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: "cancelled",
        generationId: "gen-1",
        conversationId: "conv-1",
        messageId: "msg-1",
      }),
    );
    expect(deps.saveSessionSnapshotIfPossible).not.toHaveBeenCalled();
    expect(ctx.status).toBe("cancelled");
  });

  it("publishes captured original errors as stream diagnostics", async () => {
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext({
      errorMessage: "The sandbox stopped while this run was still active.",
      debugInfo: {
        originalErrorMessage: "SandboxError: 403: blocked: team is blocked",
      },
    });

    await finalizer.finishGeneration(ctx, "error");

    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: "error",
        message:
          "The sandbox stopped while this run was still active.\nUnderlying error: SandboxError: 403: blocked: team is blocked",
        diagnosticMessage: "SandboxError: 403: blocked: team is blocked",
      }),
    );
    expect(ctx.status).toBe("error");
  });

  it("finalizes runner-declared failures after the runtime completes", async () => {
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext({
      completionReason: "runner_declared_failure",
      failureKind: "runner_declared_failure",
      errorMessage: "Runner marked this run as failed.",
    });

    await finalizer.finishGeneration(ctx, "completed");

    expect(deps.lifecycleStore.finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        status: "completed",
        completionReason: "runner_declared_failure",
        failureKind: "runner_declared_failure",
        errorMessage: "Runner marked this run as failed.",
      }),
    );
    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ type: "done" }),
    );
    expect(deps.saveSessionSnapshotIfPossible).toHaveBeenCalledWith(ctx, "finish:completed");
    expect(ctx.status).toBe("completed");
  });

  it("uses durable runner-declared failure intent only when the runtime completes", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      completionReason: "runner_declared_failure",
      failureKind: "runner_declared_failure",
      errorMessage: "The agent marked this run as failed.",
      debugInfo: { reason: "self_test_requested", markedFailedBy: "runner_mcp_tool" },
    });
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext({
      contentParts: [
        { type: "tool_use", id: "tool-1", name: "bap_runner_markFailed", input: {} },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
      ],
      assistantContent: "",
    });

    await finalizer.finishGeneration(ctx, "completed");

    expect(deps.lifecycleStore.finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        status: "completed",
        contentParts: ctx.contentParts,
        completionReason: "runner_declared_failure",
        failureKind: "runner_declared_failure",
        errorMessage: "The agent marked this run as failed.",
        debugInfo: expect.objectContaining({
          reason: "self_test_requested",
          markedFailedBy: "runner_mcp_tool",
        }),
      }),
    );
    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ type: "done" }),
    );
    expect(ctx.status).toBe("completed");
  });

  it("broadcasts sandbox files uploaded during finalization", async () => {
    collectMentionedSandboxFilesMock.mockImplementationOnce(async (input: any) => {
      input.onUploadedFile({
        id: "sandbox-file-output-html",
        path: "/app/output.html",
        filename: "output.html",
        mimeType: "text/html",
        sizeBytes: 29,
      });
      return { uploadedCount: 1 };
    });
    const { finalizer, deps } = createFinalizer();
    const ctx = createContext({
      sandbox: { provider: "e2b", sandboxId: "sandbox-1" },
      generationMarkerTime: 1_710_000_000_000,
      contentParts: [
        { type: "text", text: "Done." },
        { type: "tool_use", name: "bash", id: "tool-use-1", input: {} },
      ],
    });

    await finalizer.finishGeneration(ctx, "completed");

    expect(collectMentionedSandboxFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: ctx.sandbox,
        markerTime: ctx.generationMarkerTime,
        conversationId: "conv-1",
      }),
    );
    expect(ctx.uploadedSandboxFileIds.has("sandbox-file-output-html")).toBe(true);
    expect(ctx.sentFilePaths.has("/app/output.html")).toBe(true);
    expect(deps.broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: "sandbox_file",
        fileId: "sandbox-file-output-html",
        path: "/app/output.html",
      }),
    );
  });
});
