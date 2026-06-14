import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationContext } from "../../services/generation/types";
import type { RuntimeHarnessClient } from "../../sandbox/core/types";
import type {
  RuntimeActionableEvent,
  RuntimeApprovalRequest,
  RuntimeToolRef,
} from "../runtime-driver";
import { OpenCodeGenerationRuntimeDriver } from "./opencode-generation-runtime-driver";

const {
  normalRunnerCtorMock,
  normalRunMock,
  recoveryRunnerCtorMock,
  recoveryRunMock,
  getPendingInterruptForGenerationMock,
  inspectOpenCodeRuntimeFailureStateMock,
} = vi.hoisted(() => ({
  normalRunnerCtorMock: vi.fn(),
  normalRunMock: vi.fn(),
  recoveryRunnerCtorMock: vi.fn(),
  recoveryRunMock: vi.fn(),
  getPendingInterruptForGenerationMock: vi.fn(),
  inspectOpenCodeRuntimeFailureStateMock: vi.fn(),
}));

vi.mock("./opencode-normal-runner", () => ({
  OpenCodeNormalRunner: vi.fn().mockImplementation(function OpenCodeNormalRunner(callbacks) {
    normalRunnerCtorMock(callbacks);
    return { run: normalRunMock };
  }),
}));

vi.mock("./opencode-recovery-runner", () => ({
  OpenCodeRecoveryRunner: vi.fn().mockImplementation(function OpenCodeRecoveryRunner(callbacks) {
    recoveryRunnerCtorMock(callbacks);
    return { run: recoveryRunMock };
  }),
}));

vi.mock("../../services/generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
  },
}));

vi.mock("./opencode-reattach", () => ({
  inspectOpenCodeRuntimeFailureState: inspectOpenCodeRuntimeFailureStateMock,
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
    executionPolicy: { allowSnapshotRestoreOnRun: true },
    deadlineAt: new Date(Date.now() + 60_000),
    remainingRunMs: 60_000,
    approvalHotWaitMs: 250,
    suspendedAt: null,
    resumeInterruptId: null,
    lastRuntimeProgressAt: new Date(),
    lastRuntimeProgressKind: null,
    recoveryAttempts: 0,
    completionReason: null,
    contentParts: [],
    assistantContent: "",
    abortController: new AbortController(),
    pendingApproval: null,
    pendingAuth: null,
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
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
    runtimeId: "runtime-1",
    runtimeTurnSeq: 7,
    sessionId: "session-1",
    ...overrides,
  };
}

function createDriver(input: { ctx?: GenerationContext } = {}) {
  const ctx = input.ctx ?? createContext();
  const saveProgress = vi.fn().mockResolvedValue(undefined);
  const broadcast = vi.fn();
  const parkForInterrupt = vi.fn().mockResolvedValue(undefined);
  const decisionFlow = {
    handleRuntimeActionableEvent: vi.fn().mockResolvedValue({ type: "none" }),
    applyResolvedInterruptToRuntime: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    bootstrapTimeoutMs: 45_000,
    contextState: {
      markPhase: vi.fn(),
      markRuntimeProgress: vi.fn(),
      setCompletionReason: vi.fn((target: GenerationContext, reason) => {
        target.completionReason = reason;
      }),
      ensureRemoteRunDebugInfo: vi.fn(),
      recordRemoteRunPhase: vi.fn(),
      bindRuntimeSandboxToContext: vi.fn().mockResolvedValue(undefined),
      bindRuntimeSessionToContext: vi.fn().mockResolvedValue(undefined),
      persistRuntimeSessionBinding: vi.fn().mockResolvedValue(undefined),
      getRemainingRunTimeMs: vi.fn(() => 60_000),
      captureOriginalError: vi.fn(),
      getCurrentPhase: vi.fn(() => null),
      resolveSandboxRuntimeEnvForContext: vi.fn().mockResolvedValue({}),
      getApprovalHotWaitMs: vi.fn(() => 250),
    },
    decisionFlow,
    interruptParking: {
      startExternalInterruptPolling: vi.fn(),
      stopExternalInterruptPolling: vi.fn(),
      pollExternalInterruptAndSuspendIfNeeded: vi.fn().mockResolvedValue(undefined),
      parkGenerationForInterrupt: parkForInterrupt,
    },
    turnFinalizer: {
      collectAndExposeMentionedSandboxFiles: vi.fn().mockResolvedValue(0),
    },
    refreshCancellationSignal: vi.fn().mockResolvedValue(false),
    finishGeneration: vi.fn().mockResolvedValue(undefined),
    setSnapshotRestoreAllowance: vi.fn().mockResolvedValue(undefined),
    parkGenerationForRunDeadline: vi.fn().mockResolvedValue(undefined),
    awaitPromiseUntilRunDeadline: vi.fn(async (_target, promise) => ({
      type: "resolved" as const,
      value: await promise,
    })),
    importIntegrationSkillDraftsFromSandbox: vi.fn().mockResolvedValue(undefined),
    scheduleRecoveryReattach: vi.fn(),
    recordRecoveryAttempt: vi.fn().mockResolvedValue(undefined),
    saveProgress,
    scheduleSave: vi.fn(),
    broadcast,
    getActiveContext: vi.fn((generationId: string) =>
      generationId === ctx.id ? ctx : undefined,
    ),
  };

  return {
    ctx,
    deps,
    decisionFlow,
    saveProgress,
    broadcast,
    parkForInterrupt,
    driver: new OpenCodeGenerationRuntimeDriver(deps as never),
  };
}

describe("OpenCodeGenerationRuntimeDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalRunMock.mockResolvedValue(undefined);
    recoveryRunMock.mockResolvedValue(undefined);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
    inspectOpenCodeRuntimeFailureStateMock.mockResolvedValue({
      classification: "terminal_failed",
    });
  });

  it("dispatches start/resume turns to the normal runner and reattach turns to recovery", async () => {
    const ctx = createContext({ assistantContent: "done" });
    const { driver } = createDriver({ ctx });

    const started = await driver.startTurn({
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      model: ctx.model,
      authSource: null,
      prompt: { user: "hello" },
      environment: {} as never,
      runtimeBinding: { runtimeId: "runtime-1", turnSeq: 7 },
    });
    expect(normalRunMock).toHaveBeenCalledWith(ctx);
    await expect(started.completion).resolves.toEqual({
      status: "completed",
      assistantText: "done",
    });

    await driver.resumeTurn({
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      model: ctx.model,
      authSource: null,
      environment: {} as never,
      runtimeBinding: { runtimeId: "runtime-1", turnSeq: 7, sessionId: "session-1" },
      reason: "decision_resolved",
    });
    expect(normalRunMock).toHaveBeenCalledTimes(2);

    await driver.reattachTurn({
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      environment: {} as never,
      runtimeBinding: { runtimeId: "runtime-1", turnSeq: 7, sessionId: "session-1" },
      requireLiveSession: true,
      allowSnapshotRestore: false,
    });
    expect(recoveryRunMock).toHaveBeenCalledWith(ctx, {
      allowSnapshotRestore: false,
      requireLiveSession: true,
    });
  });

  it("delegates OpenCode actionable events through DecisionFlow with runtime decision sending", async () => {
    const { ctx, driver, decisionFlow, saveProgress, broadcast, parkForInterrupt } =
      createDriver();
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    const runtimeClient = {
      replyPermission,
    } as unknown as RuntimeHarnessClient;
    const event: RuntimeActionableEvent = {
      type: "permission",
      request: {
        id: "permission-1",
        permission: "file access",
        patterns: ["/work"],
      },
    };

    decisionFlow.handleRuntimeActionableEvent.mockImplementationOnce(async (input) => {
      await input.saveProgress();
      input.broadcast({ type: "status_change", status: "awaiting_approval" });
      await input.parkForInterrupt({ id: "interrupt-1" });
      await input.sendRuntimeDecision({
        kind: "permission",
        requestId: "permission-1",
        reply: "always",
      } satisfies RuntimeApprovalRequest);
      return { type: "permission" };
    });

    await expect(
      driver.handleRuntimeActionableEvent(ctx, event, async (request) => {
        if (request.kind === "permission") {
          await runtimeClient.replyPermission({
            requestID: request.requestId,
            reply: request.reply,
          });
        }
      }),
    ).resolves.toEqual({ type: "permission" });

    expect(decisionFlow.handleRuntimeActionableEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx,
        event,
        hotWaitMs: 250,
        timeoutMs: expect.any(Number),
      }),
    );
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(ctx, {
      type: "status_change",
      status: "awaiting_approval",
    });
    expect(parkForInterrupt).toHaveBeenCalledWith(ctx, { id: "interrupt-1" });
    expect(replyPermission).toHaveBeenCalledWith({
      requestID: "permission-1",
      reply: "always",
    });
  });

  it("updates OpenCode tool parts and fails fast when the saved session id is missing", async () => {
    const { driver } = createDriver();
    const updatePart = vi.fn().mockResolvedValue({ data: null, error: null });
    const runtimeClient = { updatePart } as unknown as RuntimeHarnessClient;
    const runtimeTool: RuntimeToolRef = {
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      callId: "call-1",
      toolName: "bash",
      input: { command: "echo ok" },
    };

    await driver.updateRuntimeToolPart(runtimeClient, runtimeTool, {
      status: "completed",
      input: { command: "echo ok" },
      output: "ok",
    });

    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        messageID: "message-1",
        partID: "part-1",
        part: expect.objectContaining({
          type: "tool",
          id: "part-1",
          callID: "call-1",
          tool: "bash",
          state: expect.objectContaining({
            status: "completed",
            output: "ok",
          }),
        }),
      }),
    );

    await expect(
      driver.updateRuntimeToolPart(
        runtimeClient,
        { ...runtimeTool, sessionId: undefined },
        {
          status: "error",
          input: {},
          error: "failed",
        },
      ),
    ).rejects.toThrow("saved session id is missing");
  });

  it("classifies runtime failure state and records only recoverable live reattach attempts", async () => {
    const ctx = createContext({ recoveryAttempts: 0 });
    const { driver, deps } = createDriver({ ctx });
    const runtimeClient = { getSession: vi.fn() } as unknown as RuntimeHarnessClient;

    getPendingInterruptForGenerationMock.mockResolvedValueOnce({ kind: "auth" });
    inspectOpenCodeRuntimeFailureStateMock.mockResolvedValueOnce({
      classification: "waiting_auth",
    });

    await expect(driver.resolveRuntimeFailure(ctx, runtimeClient)).resolves.toBe(
      "waiting_auth",
    );
    expect(inspectOpenCodeRuntimeFailureStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        client: runtimeClient,
        pendingInterruptKind: "auth",
        canRecover: true,
      }),
    );
    expect(deps.recordRecoveryAttempt).not.toHaveBeenCalled();

    getPendingInterruptForGenerationMock.mockResolvedValueOnce(null);
    inspectOpenCodeRuntimeFailureStateMock.mockResolvedValueOnce({
      classification: "recoverable_live_runtime",
    });

    await expect(driver.resolveRuntimeFailure(ctx, runtimeClient)).resolves.toBe(
      "recoverable_live_runtime",
    );
    expect(deps.recordRecoveryAttempt).toHaveBeenCalledWith(ctx);

    const exhaustedCtx = createContext({ recoveryAttempts: 1 });
    const exhausted = createDriver({ ctx: exhaustedCtx });
    getPendingInterruptForGenerationMock.mockResolvedValueOnce(null);
    inspectOpenCodeRuntimeFailureStateMock.mockResolvedValueOnce({
      classification: "sandbox_missing",
    });

    await expect(
      exhausted.driver.resolveRuntimeFailure(exhaustedCtx, runtimeClient),
    ).resolves.toBe("sandbox_missing");
    expect(inspectOpenCodeRuntimeFailureStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canRecover: false,
      }),
    );
    expect(exhausted.deps.recordRecoveryAttempt).not.toHaveBeenCalled();
  });
});
