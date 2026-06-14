import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationContext, GenerationEvent } from "../types";
import { GenerationSuspendedError, GenerationTurnSuspender } from "./turn-suspension";

const {
  suspendRuntimeMock,
  saveConversationSessionSnapshotMock,
  getInterruptMock,
} = vi.hoisted(() => ({
  suspendRuntimeMock: vi.fn(),
  saveConversationSessionSnapshotMock: vi.fn(),
  getInterruptMock: vi.fn(),
}));

vi.mock("../../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    suspendRuntime: suspendRuntimeMock,
  },
}));

vi.mock("../../runtime-session-snapshot-service", () => ({
  saveConversationSessionSnapshot: saveConversationSessionSnapshotMock,
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getInterrupt: getInterruptMock,
  },
}));

function createContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    id: "gen-1",
    traceId: "trace-1",
    conversationId: "conv-1",
    userId: "user-1",
    workspaceId: "ws-1",
    spawnDepth: 0,
    status: "running",
    executionPolicy: { allowSnapshotRestoreOnRun: false },
    deadlineAt: new Date(Date.now() - 1_000),
    remainingRunMs: 0,
    approvalHotWaitMs: 250,
    suspendedAt: null,
    resumeInterruptId: null,
    lastRuntimeProgressAt: new Date("2026-06-14T10:00:00.000Z"),
    lastRuntimeProgressKind: "tool_result",
    recoveryAttempts: 0,
    completionReason: null,
    contentParts: [{ type: "text", text: "partial answer" }],
    assistantContent: "partial answer",
    abortController: new AbortController(),
    pendingApproval: {
      toolUseId: "tool-1",
      toolName: "bash",
      toolInput: { command: "touch file" },
      requestedAt: new Date().toISOString(),
    },
    pendingAuth: {
      integrations: ["github"],
      connectedIntegrations: [],
      requestedAt: new Date().toISOString(),
    },
    currentInterruptId: "interrupt-1",
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
    runtimeId: "runtime-1",
    runtimeTurnSeq: 1,
    sessionId: "session-1",
    sandboxId: "sandbox-1",
    sandbox: {
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
      teardown: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as never,
    startedAt: new Date(),
    lastSaveAt: new Date(),
    isNewConversation: false,
    model: "openai/gpt-5",
    userMessageContent: "hello",
    assistantMessageIds: new Set(),
    messageRoles: new Map(),
    pendingMessageParts: new Map(),
    runtimeTools: new Map(),
    backendType: "runtime",
    autoApprove: false,
    streamSequence: 0,
    streamPublishedCount: 0,
    streamDeliveredCount: 0,
    ...overrides,
  };
}

function createSuspender() {
  const events: GenerationEvent[] = [];
  const lifecycleStore = {
    pauseForRunDeadline: vi.fn().mockResolvedValue(undefined),
    suspendForInterrupt: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    lifecycleStore,
    refreshRemainingRunBudget: vi.fn((ctx: GenerationContext) => {
      ctx.remainingRunMs = Math.max(0, ctx.deadlineAt.getTime() - Date.now());
      return ctx.remainingRunMs;
    }),
    setCompletionReason: vi.fn((ctx: GenerationContext, reason) => {
      ctx.completionReason = reason;
    }),
    stopExternalInterruptPolling: vi.fn(),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    releaseSandboxSlotLease: vi.fn().mockResolvedValue(undefined),
    evictActiveGenerationContext: vi.fn(),
    broadcast: vi.fn((_ctx: GenerationContext, event: GenerationEvent) => {
      events.push(event);
    }),
  };
  return {
    events,
    lifecycleStore,
    deps,
    suspender: new GenerationTurnSuspender(deps),
  };
}

describe("GenerationTurnSuspender run-deadline parking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveConversationSessionSnapshotMock.mockResolvedValue(undefined);
    suspendRuntimeMock.mockResolvedValue(undefined);
    getInterruptMock.mockResolvedValue({
      id: "interrupt-1",
      generationId: "gen-1",
      runtimeId: "runtime-1",
      conversationId: "conv-1",
      turnSeq: 1,
      kind: "plugin_write",
      status: "pending",
      display: {
        title: "Bash",
        toolInput: { command: "touch file" },
        integration: "github",
        operation: "write",
        command: "touch file",
      },
      provider: "plugin",
      providerRequestId: "plugin-request-1",
      providerToolUseId: "tool-1",
      responsePayload: undefined,
      requestedAt: new Date("2026-06-14T10:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });
  });

  it("pauses a Generation with snapshot, runtime abort, teardown, and active-context eviction", async () => {
    const teardown = vi.fn().mockResolvedValue(undefined);
    const runtimeAbort = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = createContext({
      coworkerRunId: "coworker-run-1",
      sandbox: {
        execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown,
      } as never,
    });
    const { suspender, deps, lifecycleStore, events } = createSuspender();

    await suspender.parkGenerationForRunDeadline(ctx, { abort: runtimeAbort });

    expect(runtimeAbort).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(saveConversationSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        sessionId: "session-1",
      }),
    );
    expect(ctx.status).toBe("paused");
    expect(ctx.completionReason).toBe("run_deadline");
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.pendingAuth).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(deps.stopExternalInterruptPolling).toHaveBeenCalledWith(ctx);
    expect(deps.saveProgress).toHaveBeenCalledWith(ctx);
    expect(lifecycleStore.pauseForRunDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        conversationId: "conv-1",
        coworkerRunId: "coworker-run-1",
        contentParts: [{ type: "text", text: "partial answer" }],
        lastRuntimeProgressAt: new Date("2026-06-14T10:00:00.000Z"),
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status_change",
          status: "run_deadline_parked",
          metadata: expect.objectContaining({
            runtimeId: "runtime-1",
            releasedSandboxId: "sandbox-1",
          }),
        }),
      ]),
    );
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-1");
    expect(ctx.sandbox).toBeUndefined();
    expect(ctx.sandboxId).toBeUndefined();
    expect(ctx.sessionId).toBeUndefined();
    expect(deps.releaseSandboxSlotLease).toHaveBeenCalledWith(ctx);
    expect(deps.evictActiveGenerationContext).toHaveBeenCalledWith("gen-1");
  });

  it("continues parking when snapshot export hangs", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const teardown = vi.fn().mockResolvedValue(undefined);
      const runtimeAbort = vi.fn().mockResolvedValue({ data: null, error: null });
      saveConversationSessionSnapshotMock.mockImplementation(
        () => new Promise<never>(() => undefined),
      );
      const ctx = createContext({
        id: "gen-snapshot-timeout",
        conversationId: "conv-snapshot-timeout",
        runtimeId: "runtime-snapshot-timeout",
        sessionId: "session-snapshot-timeout",
        sandboxId: "sandbox-snapshot-timeout",
        sandbox: {
          execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
          writeFile: vi.fn().mockResolvedValue(undefined),
          teardown,
        } as never,
      });
      const { suspender, lifecycleStore, deps } = createSuspender();

      const parkPromise = suspender.parkGenerationForRunDeadline(ctx, {
        abort: runtimeAbort,
      });

      await vi.advanceTimersByTimeAsync(15_100);
      await parkPromise;

      expect(runtimeAbort).toHaveBeenCalledWith({
        sessionID: "session-snapshot-timeout",
      });
      expect(lifecycleStore.pauseForRunDeadline).toHaveBeenCalledWith(
        expect.objectContaining({
          generationId: "gen-snapshot-timeout",
          conversationId: "conv-snapshot-timeout",
        }),
      );
      expect(teardown).toHaveBeenCalledTimes(1);
      expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-snapshot-timeout");
      expect(deps.evictActiveGenerationContext).toHaveBeenCalledWith("gen-snapshot-timeout");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Timed out saving session snapshot before run deadline park"),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("suspends an interrupt with snapshot, teardown, persisted waiting status, and active eviction", async () => {
    const teardown = vi.fn().mockResolvedValue(undefined);
    const ctx = createContext({
      deadlineAt: new Date(Date.now() + 60_000),
      sandbox: {
        execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        teardown,
      } as never,
    });
    const { suspender, deps, lifecycleStore } = createSuspender();

    await expect(
      suspender.suspendGenerationForInterrupt(ctx, {
        id: "interrupt-1",
        kind: "plugin_write",
      } as never),
    ).rejects.toBeInstanceOf(GenerationSuspendedError);

    expect(saveConversationSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        sessionId: "session-1",
      }),
    );
    expect(ctx.status).toBe("awaiting_approval");
    expect(ctx.currentInterruptId).toBe("interrupt-1");
    expect(ctx.suspendedAt).toBeInstanceOf(Date);
    expect(deps.stopExternalInterruptPolling).toHaveBeenCalledWith(ctx);
    expect(deps.saveProgress).toHaveBeenCalledWith(ctx);
    expect(lifecycleStore.suspendForInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        conversationId: "conv-1",
        status: "awaiting_approval",
        contentParts: [{ type: "text", text: "partial answer" }],
        lastRuntimeProgressAt: new Date("2026-06-14T10:00:00.000Z"),
      }),
    );
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(suspendRuntimeMock).toHaveBeenCalledWith("runtime-1");
    expect(ctx.sandbox).toBeUndefined();
    expect(ctx.sandboxId).toBeUndefined();
    expect(ctx.sessionId).toBeUndefined();
    expect(deps.releaseSandboxSlotLease).toHaveBeenCalledWith(ctx);
    expect(deps.evictActiveGenerationContext).toHaveBeenCalledWith("gen-1");
  });

  it("persists interrupt suspension and keeps the live runtime when snapshot export hangs", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const teardown = vi.fn().mockResolvedValue(undefined);
      saveConversationSessionSnapshotMock.mockImplementation(
        () => new Promise<never>(() => undefined),
      );
      const ctx = createContext({
        id: "gen-interrupt-snapshot-timeout",
        conversationId: "conv-interrupt-snapshot-timeout",
        runtimeId: "runtime-interrupt-snapshot-timeout",
        sessionId: "session-interrupt-snapshot-timeout",
        sandboxId: "sandbox-interrupt-snapshot-timeout",
        deadlineAt: new Date(Date.now() + 60_000),
        sandbox: {
          execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
          writeFile: vi.fn().mockResolvedValue(undefined),
          teardown,
        } as never,
      });
      const { suspender, lifecycleStore, deps } = createSuspender();

      const suspendPromise = expect(
        suspender.suspendGenerationForInterrupt(ctx, {
          id: "interrupt-1",
          kind: "plugin_write",
        } as never),
      ).rejects.toBeInstanceOf(GenerationSuspendedError);

      await vi.advanceTimersByTimeAsync(15_100);
      await suspendPromise;

      expect(lifecycleStore.suspendForInterrupt).toHaveBeenCalledWith(
        expect.objectContaining({
          generationId: "gen-interrupt-snapshot-timeout",
          conversationId: "conv-interrupt-snapshot-timeout",
          status: "awaiting_approval",
        }),
      );
      expect(teardown).not.toHaveBeenCalled();
      expect(suspendRuntimeMock).not.toHaveBeenCalledWith("runtime-interrupt-snapshot-timeout");
      expect(ctx.sandbox).toBeDefined();
      expect(ctx.sandboxId).toBe("sandbox-interrupt-snapshot-timeout");
      expect(ctx.sessionId).toBe("session-interrupt-snapshot-timeout");
      expect(deps.releaseSandboxSlotLease).toHaveBeenCalledWith(ctx);
      expect(deps.evictActiveGenerationContext).toHaveBeenCalledWith(
        "gen-interrupt-snapshot-timeout",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Timed out saving session snapshot before interrupt park"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Keeping live runtime after failed interrupt snapshot"),
        expect.objectContaining({
          generationId: "gen-interrupt-snapshot-timeout",
          interruptId: "interrupt-1",
        }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
