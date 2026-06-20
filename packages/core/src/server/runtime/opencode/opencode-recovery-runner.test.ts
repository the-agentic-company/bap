import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHarnessClient, RuntimeEvent, SandboxHandle } from "../../sandbox/core/types";
import type { GenerationContext, GenerationEvent } from "../../services/generation/types";
import { OpenCodeTurnEventBridge } from "./opencode-turn-events";
import { OpenCodeRecoveryRunner } from "./opencode-recovery-runner";

const {
  conversationFindFirstMock,
  getOrCreateConversationRuntimeMock,
  writeRuntimeContextToSandboxMock,
  writeRuntimeEnvToSandboxMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  getOrCreateConversationRuntimeMock: vi.fn(),
  writeRuntimeContextToSandboxMock: vi.fn(),
  writeRuntimeEnvToSandboxMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      conversation: {
        findFirst: conversationFindFirstMock,
      },
    },
  },
}));

vi.mock("../../sandbox/core/orchestrator", () => ({
  getOrCreateConversationRuntime: getOrCreateConversationRuntimeMock,
}));

vi.mock("../../execution/runtime-context", () => ({
  writeRuntimeContextToSandbox: writeRuntimeContextToSandboxMock,
  writeRuntimeEnvToSandbox: writeRuntimeEnvToSandboxMock,
}));

vi.mock("../../utils/observability", () => ({
  logger: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../services/generation/prompts/opencode-prompt-context", () => ({
  composeContinuationPromptSpec: vi.fn().mockResolvedValue({
    agentId: "bap-chat",
    systemPrompt: "continue system",
  }),
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
    sessionId: "session-1",
    runtimeId: "runtime-1",
    runtimeTurnSeq: 1,
    runtimeCallbackToken: "callback-token",
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

async function* asAsyncIterable(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event;
  }
}

function createSandbox(): SandboxHandle {
  return {
    provider: "e2b",
    sandboxId: "sandbox-1",
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

function createRuntimeClient(overrides: Partial<RuntimeHarnessClient> = {}): RuntimeHarnessClient {
  return {
    subscribe: vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    }),
    prompt: vi.fn().mockResolvedValue({ data: null, error: null }),
    abort: vi.fn().mockResolvedValue({ data: null, error: null }),
    messages: vi.fn().mockResolvedValue({ data: [], error: null }),
    getSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    createSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    updatePart: vi.fn().mockResolvedValue({ data: null, error: null }),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyQuestion: vi.fn().mockResolvedValue(undefined),
    rejectQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockRuntime(input: {
  client?: RuntimeHarnessClient;
  sessionId?: string;
  sessionSource?: "live_session" | "restored_snapshot" | "created_session";
} = {}) {
  const client = input.client ?? createRuntimeClient();
  const sandbox = createSandbox();
  getOrCreateConversationRuntimeMock.mockResolvedValueOnce({
    sandbox,
    harnessClient: client,
    session: { id: input.sessionId ?? "session-1" },
    metadata: {
      sandboxProvider: "e2b",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
    },
    sessionSource: input.sessionSource ?? "live_session",
  });
  return { client, sandbox };
}

function createRunner() {
  const events: GenerationEvent[] = [];
  const finishGeneration = vi.fn().mockResolvedValue(undefined);
  const parkGenerationForRunDeadline = vi.fn().mockResolvedValue(undefined);
  const captureUsageFromRuntimeSession = vi.fn().mockResolvedValue(undefined);
  const bindRuntimeSessionToContext = vi.fn(async (ctx: GenerationContext, input) => {
    ctx.sandbox = input.runtimeSandbox;
    ctx.sandboxId = input.runtimeSandbox.sandboxId;
    ctx.runtimeHarness = input.runtimeMetadata.runtimeHarness;
    ctx.runtimeProtocolVersion = input.runtimeMetadata.runtimeProtocolVersion;
    ctx.sessionId = input.sessionId;
  });
  const turnEvents = new OpenCodeTurnEventBridge({
    markPhase: (ctx, phase) => {
      ctx.phaseMarks = { ...(ctx.phaseMarks ?? {}), [phase]: Date.now() };
    },
    broadcast: (_ctx, event) => {
      events.push(event);
    },
    scheduleSave: vi.fn(),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    markRuntimeProgress: (ctx, kind) => {
      ctx.lastRuntimeProgressAt = new Date();
      ctx.lastRuntimeProgressKind = kind;
    },
    refreshCancellationSignal: vi.fn().mockResolvedValue(false),
    handleActionableEvent: vi.fn().mockResolvedValue({ type: "none" }),
  });
  const callbacks = {
    bootstrapTimeoutMs: 45_000,
    turnEvents,
    refreshCancellationSignal: vi.fn().mockResolvedValue(false),
    finishGeneration,
    setCompletionReason: vi.fn((ctx: GenerationContext, reason) => {
      ctx.completionReason = reason;
    }),
    bindRuntimeSessionToContext,
    broadcast: (_ctx: GenerationContext, event: GenerationEvent) => {
      events.push(event);
    },
    resolveSandboxRuntimeEnvForContext: vi.fn().mockResolvedValue({ BAP_USER_ID: "user-1" }),
    applyResolvedInterruptToRuntime: vi.fn().mockResolvedValue(undefined),
    setSnapshotRestoreAllowance: vi.fn().mockResolvedValue(undefined),
    getRemainingRunTimeMs: vi.fn((ctx: GenerationContext) =>
      Math.max(0, ctx.deadlineAt.getTime() - Date.now()),
    ),
    parkGenerationForRunDeadline,
    awaitPromiseUntilRunDeadline: vi.fn(async (ctx: GenerationContext, promise) => {
      const remaining = ctx.deadlineAt.getTime() - Date.now();
      if (remaining <= 0) {
        return { type: "timed_out" as const };
      }
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise.then((value) => ({ type: "resolved" as const, value })),
          new Promise<{ type: "timed_out" }>((resolve) => {
            timeoutId = setTimeout(() => resolve({ type: "timed_out" }), remaining);
          }),
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }),
    captureUsageFromRuntimeSession,
    importIntegrationSkillDraftsFromSandbox: vi.fn().mockResolvedValue(undefined),
    resolveRuntimeFailure: vi.fn().mockResolvedValue("terminal_failed"),
    captureOriginalError: vi.fn(),
  };

  return {
    events,
    callbacks,
    finishGeneration,
    parkGenerationForRunDeadline,
    captureUsageFromRuntimeSession,
    bindRuntimeSessionToContext,
    runner: new OpenCodeRecoveryRunner(callbacks as never),
  };
}

describe("OpenCodeRecoveryRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationFindFirstMock.mockResolvedValue({ title: "Conversation" });
    writeRuntimeContextToSandboxMock.mockResolvedValue(undefined);
    writeRuntimeEnvToSandboxMock.mockResolvedValue(undefined);
  });

  it("reattaches to a live OpenCode session without resending the original prompt", async () => {
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    const { client } = mockRuntime({
      client: createRuntimeClient({ prompt }),
      sessionSource: "live_session",
    });
    const { runner, finishGeneration, captureUsageFromRuntimeSession, events } = createRunner();
    const ctx = createContext();

    await runner.run(ctx, { allowSnapshotRestore: false, requireLiveSession: true });

    expect(getOrCreateConversationRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        generationId: "gen-1",
        anthropicApiKey: expect.any(String),
      }),
      expect.objectContaining({
        replayHistory: false,
        allowSnapshotRestore: false,
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(writeRuntimeContextToSandboxMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: "runtime-1",
        turnSeq: 1,
        callbackToken: "callback-token",
      }),
    );
    expect(captureUsageFromRuntimeSession).toHaveBeenCalledWith(ctx, client, "session-1");
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status_change",
          status: "recovery_reattach_attached",
        }),
      ]),
    );
  });

  it("applies resolved runtime interrupts during suspended resume reattach", async () => {
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    const { client } = mockRuntime({
      client: createRuntimeClient({ prompt }),
      sessionSource: "restored_snapshot",
    });
    const { runner, callbacks, finishGeneration } = createRunner();
    const ctx = createContext({
      id: "gen-resume-runtime",
      resumeInterruptId: "interrupt-resume-runtime",
    });

    await runner.run(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      resumeInterruptId: "interrupt-resume-runtime",
      modeLabel: "resume_interrupt",
    });

    expect(callbacks.applyResolvedInterruptToRuntime).toHaveBeenCalledWith(
      ctx,
      "interrupt-resume-runtime",
      client,
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
  });

  it("normalizes OpenAI provider/model references on runtime-question resume continuation prompts", async () => {
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    const { client } = mockRuntime({
      client: createRuntimeClient({ prompt }),
      sessionSource: "restored_snapshot",
    });
    const { runner, callbacks, finishGeneration } = createRunner();
    const continuationParts = [
      {
        type: "text" as const,
        text: "Continue the interrupted assistant turn. The pending question has been answered. The resolved answer was: Beta.",
      },
    ];
    const ctx = createContext({
      id: "gen-resume-runtime-question",
      model: "openai/gpt-5.4-mini",
      resumeInterruptId: "interrupt-resume-runtime-question",
    });

    await runner.run(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      resumeInterruptId: "interrupt-resume-runtime-question",
      modeLabel: "resume_interrupt",
      onRuntimeAttached: async () => continuationParts,
    });

    expect(callbacks.applyResolvedInterruptToRuntime).toHaveBeenCalledWith(
      ctx,
      "interrupt-resume-runtime-question",
      client,
    );
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        parts: continuationParts,
        agent: "bap-chat",
        system: "continue system",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4-mini",
        },
      }),
    );
    expect(prompt.mock.calls[0]?.[0].model).not.toBe("openai/gpt-5.4-mini");
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "GENERATION_RECOVERY_CONTINUATION_PROMPT_REQUESTED",
        generationId: "gen-resume-runtime-question",
        mode: "resume_interrupt",
        resumeInterruptId: "interrupt-resume-runtime-question",
        modelReference: "openai/gpt-5.4-mini",
        modelProviderID: "openai",
        modelID: "gpt-5.4-mini",
        continuationPartCount: 1,
      }),
    );
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
  });

  it("rejects fresh and snapshot-restored sessions when a live reattach is required", async () => {
    const { runner, finishGeneration } = createRunner();
    const createdCtx = createContext({ id: "gen-created" });
    mockRuntime({ sessionSource: "created_session" });

    await runner.run(createdCtx, { requireLiveSession: true });

    expect(createdCtx.completionReason).toBe("sandbox_missing");
    expect(createdCtx.errorMessage).toContain("original sandbox was no longer available");
    expect(finishGeneration).toHaveBeenCalledWith(createdCtx, "error");

    const restoredCtx = createContext({ id: "gen-restored" });
    mockRuntime({ sessionSource: "restored_snapshot" });

    await runner.run(restoredCtx, { requireLiveSession: true });

    expect(restoredCtx.completionReason).toBe("broken_runtime_state");
    expect(restoredCtx.errorMessage).toContain("only a snapshot restore was available");
    expect(finishGeneration).toHaveBeenCalledWith(restoredCtx, "error");
  });

  it("parks a live reattach when no run budget remains after binding", async () => {
    mockRuntime({ sessionSource: "live_session" });
    const { runner, parkGenerationForRunDeadline, finishGeneration } = createRunner();
    const ctx = createContext({
      deadlineAt: new Date(Date.now() - 1_000),
    });

    await runner.run(ctx, { requireLiveSession: true });

    expect(parkGenerationForRunDeadline).toHaveBeenCalledWith(ctx, expect.anything());
    expect(finishGeneration).not.toHaveBeenCalled();
  });

  it("parks when a continuation prompt outlives the remaining run budget", async () => {
    vi.useFakeTimers();
    try {
      let promptStartedResolve: (() => void) | undefined;
      const promptStarted = new Promise<void>((resolve) => {
        promptStartedResolve = resolve;
      });
      const prompt = vi.fn(() => {
        promptStartedResolve?.();
        return new Promise<never>(() => undefined);
      });
      mockRuntime({
        client: createRuntimeClient({
          prompt,
          subscribe: vi.fn().mockResolvedValue({ stream: asAsyncIterable([]) }),
        }),
        sessionSource: "live_session",
      });
      const { runner, parkGenerationForRunDeadline, finishGeneration } = createRunner();
      const ctx = createContext({
        deadlineAt: new Date(Date.now() + 50),
      });

      const runPromise = runner.run(ctx, {
        requireLiveSession: true,
        onRuntimeAttached: async () => [{ type: "text", text: "continue" }],
      });

      await promptStarted;
      await vi.advanceTimersByTimeAsync(60);
      await runPromise;

      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "session-1",
          parts: [{ type: "text", text: "continue" }],
          agent: "bap-chat",
          system: "continue system",
        }),
      );
      expect(parkGenerationForRunDeadline).toHaveBeenCalledWith(ctx, expect.anything());
      expect(finishGeneration).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
