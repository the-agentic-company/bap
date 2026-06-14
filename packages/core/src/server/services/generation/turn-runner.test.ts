import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationContext } from "./types";

const { generationFindFirstMock } = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
    },
  },
}));

import { TurnRunner } from "./turn-runner";

describe("TurnRunner runGeneration dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationFindFirstMock.mockResolvedValue({
      status: "running",
      messageId: null,
      completedAt: null,
    });
  });

  function createContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
    return {
      id: "gen-dispatch",
      traceId: "trace-dispatch",
      conversationId: "conv-dispatch",
      userId: "user-1",
      workspaceId: "ws-1",
      spawnDepth: 0,
      status: "running",
      executionPolicy: {},
      deadlineAt: new Date(Date.now() + 60_000),
      remainingRunMs: 60_000,
      approvalHotWaitMs: 1_000,
      suspendedAt: null,
      resumeInterruptId: null,
      lastRuntimeProgressAt: new Date(),
      lastRuntimeProgressKind: null,
      recoveryAttempts: 0,
      completionReason: null,
      debugInfo: undefined,
      contentParts: [],
      assistantContent: "",
      abortController: new AbortController(),
      pendingApproval: null,
      pendingAuth: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      startedAt: new Date(),
      lastSaveAt: new Date(),
      isNewConversation: false,
      model: "anthropic/claude-sonnet-4-6",
      userMessageContent: "write a plan",
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      runtimeTools: new Map(),
      backendType: "runtime",
      streamSequence: 0,
      streamPublishedCount: 0,
      streamDeliveredCount: 0,
      uploadedSandboxFileIds: new Set(),
      ...overrides,
    };
  }

  function createRunner() {
    const deps = {
      activeGenerations: new Map<string, GenerationContext>(),
      contextLoader: {} as never,
      acquireGenerationLease: vi.fn(),
      renewGenerationLease: vi.fn(async () => undefined),
      releaseGenerationLease: vi.fn(async () => undefined),
      failQueuedRunBeforeContext: vi.fn(async () => undefined),
      markPhase: vi.fn(),
      setCompletionReason: vi.fn((ctx: GenerationContext, reason) => {
        ctx.completionReason = reason;
      }),
      finishGeneration: vi.fn(async () => undefined),
      hydrateStreamSequence: vi.fn(async () => undefined),
      handleSessionReset: vi.fn(async () => undefined),
      refreshCancellationSignal: vi.fn(async () => false),
      waitForSandboxSlotLease: vi.fn(async () => "acquired" as const),
      releaseSandboxSlotLease: vi.fn(async () => undefined),
      enqueueGenerationTimeout: vi.fn(async () => undefined),
      processGenerationTimeout: vi.fn(async () => undefined),
      runSuspendedInterruptResume: vi.fn(async () => undefined),
      runRecoveryReattach: vi.fn(async () => undefined),
      runRuntimeGeneration: vi.fn(async () => undefined),
    };
    return { deps, runner: new TurnRunner(deps as never) };
  }

  it("dispatches /new turns to session reset before runtime work", async () => {
    const { deps, runner } = createRunner();
    const ctx = createContext({ userMessageContent: "  /new  " });

    await runner.runGeneration(ctx, "normal_run", "lease-worker");

    expect(deps.hydrateStreamSequence).toHaveBeenCalledWith(ctx);
    expect(deps.handleSessionReset).toHaveBeenCalledWith(ctx);
    expect(deps.refreshCancellationSignal).not.toHaveBeenCalled();
    expect(deps.waitForSandboxSlotLease).not.toHaveBeenCalled();
    expect(deps.runRuntimeGeneration).not.toHaveBeenCalled();
    expect(deps.releaseSandboxSlotLease).toHaveBeenCalledWith(ctx);
  });

  it("dispatches normal and recovery runs to the runtime backend", async () => {
    const { deps, runner } = createRunner();
    const normalCtx = createContext({ id: "gen-normal", userMessageContent: "hello" });
    const recoveryCtx = createContext({
      id: "gen-recovery",
      userMessageContent: "continue",
    });

    await runner.runGeneration(normalCtx, "normal_run", "lease-worker");
    await runner.runGeneration(recoveryCtx, "recovery_reattach", "lease-worker");

    expect(deps.handleSessionReset).not.toHaveBeenCalled();
    expect(deps.runRuntimeGeneration).toHaveBeenCalledWith(normalCtx);
    expect(deps.runRecoveryReattach).toHaveBeenCalledWith(recoveryCtx);
    expect(deps.waitForSandboxSlotLease).toHaveBeenCalledWith(normalCtx, {
      allowWorkerRequeue: true,
      runMode: "normal_run",
    });
    expect(deps.waitForSandboxSlotLease).toHaveBeenCalledWith(recoveryCtx, {
      allowWorkerRequeue: true,
      runMode: "recovery_reattach",
    });
  });
});
