import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env";
import type { RuntimeHarnessClient, RuntimeEvent, SandboxHandle } from "../../sandbox/core/types";
import type { GenerationContext, GenerationEvent } from "../../services/generation/types";
import {
  BAP_COWORKER_BUILDER_AGENT_ID,
  BAP_COWORKER_RUNNER_AGENT_ID,
} from "../../prompts/opencode-agent-ids";
import { OpenCodeTurnEventBridge } from "./opencode-turn-events";
import { OpenCodeNormalRunner } from "./opencode-normal-runner";

const {
  conversationFindFirstMock,
  getOrCreateConversationSandboxMock,
  resolveRuntimeEnvironmentForTurnMock,
  stagePrePromptAssetsMock,
  writeCoworkerDocumentsToSandboxMock,
  resolveWorkspaceMcpServersForGenerationMock,
  resolveBapPlatformMcpServerMock,
  captureRuntimeNoProgressDiagnosticSnapshotMock,
  loggerErrorMock,
  emitCanonicalServiceEventMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  getOrCreateConversationSandboxMock: vi.fn(),
  resolveRuntimeEnvironmentForTurnMock: vi.fn(),
  stagePrePromptAssetsMock: vi.fn(),
  writeCoworkerDocumentsToSandboxMock: vi.fn(),
  resolveWorkspaceMcpServersForGenerationMock: vi.fn(),
  resolveBapPlatformMcpServerMock: vi.fn(),
  captureRuntimeNoProgressDiagnosticSnapshotMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  emitCanonicalServiceEventMock: vi.fn(),
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
  getOrCreateConversationSandbox: getOrCreateConversationSandboxMock,
}));

vi.mock("../../execution/runtime-env", () => ({
  resolveRuntimeEnvironmentForTurn: resolveRuntimeEnvironmentForTurnMock,
}));

vi.mock("../../execution/pre-prompt-assets", () => ({
  stagePrePromptAssets: stagePrePromptAssetsMock,
}));

vi.mock("../../sandbox/prep/memory-prep", () => ({
  buildMemorySystemPrompt: vi.fn(() => "memory prompt"),
  syncMemoryFilesToSandbox: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../sandbox/prep/coworker-documents-prep", () => ({
  writeCoworkerDocumentsToSandbox: writeCoworkerDocumentsToSandboxMock,
}));

vi.mock("../../executor/workspace-sources", () => ({
  resolveWorkspaceMcpServersForGeneration: resolveWorkspaceMcpServersForGenerationMock,
}));

vi.mock("../../sandbox/platform-mcp-server", () => ({
  resolveBapPlatformMcpServer: resolveBapPlatformMcpServerMock,
}));

vi.mock("../../services/runtime-diagnostic-snapshot-service", () => ({
  captureRuntimeNoProgressDiagnosticSnapshot: captureRuntimeNoProgressDiagnosticSnapshotMock,
}));

vi.mock("../../utils/observability", () => ({
  emitCanonicalServiceEvent: emitCanonicalServiceEventMock,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function* asAsyncIterable(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event;
  }
}

async function* asAsyncIterableThenHang(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event;
  }
  await new Promise<never>(() => undefined);
}

function createContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    id: "gen-1", traceId: "trace-1", conversationId: "conv-1", userId: "user-1",
    workspaceId: "ws-1", spawnDepth: 0, status: "running",
    executionPolicy: { allowSnapshotRestoreOnRun: true },
    deadlineAt: new Date(Date.now() + 60_000), remainingRunMs: 60_000,
    approvalHotWaitMs: 250, suspendedAt: null, resumeInterruptId: null,
    lastRuntimeProgressAt: new Date(),
    lastRuntimeProgressKind: null, recoveryAttempts: 0, completionReason: null,
    debugInfo: undefined, contentParts: [], assistantContent: "",
    abortController: new AbortController(),
    pendingApproval: null, pendingAuth: null,
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
    runtimeId: "runtime-1", runtimeTurnSeq: 1, runtimeCallbackToken: "callback-token",
    startedAt: new Date(), lastSaveAt: new Date(), isNewConversation: false,
    model: "openai/gpt-5", userMessageContent: "hello",
    assistantMessageIds: new Set(),
    messageRoles: new Map(),
    pendingMessageParts: new Map(),
    runtimeTools: new Map(),
    backendType: "runtime", autoApprove: false,
    streamSequence: 0, streamPublishedCount: 0, streamDeliveredCount: 0,
    uploadedSandboxFileIds: new Set(),
    ...overrides,
  };
}

function createSandbox(overrides: Partial<SandboxHandle> = {}): SandboxHandle {
  return {
    provider: "daytona", sandboxId: "sandbox-1",
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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
    messages: vi.fn().mockResolvedValue({
      data: [
        {
          info: { role: "assistant", tokens: { input: 12, output: 34 } },
          parts: [{ type: "text", text: "assistant from transcript" }],
        },
      ],
      error: null,
    }),
    status: vi.fn().mockResolvedValue({ data: {}, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    createSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    updatePart: vi.fn().mockResolvedValue({ data: null, error: null }),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyQuestion: vi.fn().mockResolvedValue(undefined),
    rejectQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockSandboxRuntime(input: {
  client?: RuntimeHarnessClient;
  sandbox?: SandboxHandle;
  sessionId?: string;
  mcpWarnings?: Array<{ serverName: string; message: string }>;
} = {}) {
  const client = input.client ?? createRuntimeClient();
  const sandbox = input.sandbox ?? createSandbox();
  const completeAgentInit = vi.fn().mockResolvedValue({
    harnessClient: client,
    session: { id: input.sessionId ?? "session-1" },
    sessionSource: "live_session",
    mcpWarnings: input.mcpWarnings ?? [],
  });
  getOrCreateConversationSandboxMock.mockResolvedValueOnce({
    sandbox,
    metadata: {
      sandboxProvider: "e2b",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
    },
    completeAgentInit,
  });
  return { client, sandbox, completeAgentInit };
}

function createRunner(callbackOverrides: Record<string, unknown> = {}) {
  const events: GenerationEvent[] = [];
  const finishGeneration = vi.fn().mockResolvedValue(undefined);
  const parkGenerationForRunDeadline = vi.fn().mockResolvedValue(undefined);
  const resolveRuntimeFailure = vi.fn().mockResolvedValue("terminal_failed");
  const scheduleRecoveryReattach = vi.fn();
  const turnFinalizer = {
    collectAndExposeMentionedSandboxFiles: vi.fn().mockResolvedValue(0),
  };
  const bridge = new OpenCodeTurnEventBridge({
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
    opencodeTurnEvents: bridge,
    refreshCancellationSignal: vi.fn().mockResolvedValue(false),
    finishGeneration,
    setCompletionReason: vi.fn((ctx: GenerationContext, reason) => {
      ctx.completionReason = reason;
    }),
    ensureRemoteRunDebugInfo: vi.fn((ctx: GenerationContext) => {
      ctx.debugInfo ??= {};
    }),
    recordRemoteRunPhase: vi.fn(),
    markPhase: vi.fn((ctx: GenerationContext, phase: string) => {
      ctx.phaseMarks = { ...(ctx.phaseMarks ?? {}), [phase]: Date.now() };
    }),
    broadcast: vi.fn((_ctx: GenerationContext, event: GenerationEvent) => {
      events.push(event);
    }),
    bindRuntimeSandboxToContext: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.sandbox = input.runtimeSandbox;
      ctx.sandboxId = input.runtimeSandbox.sandboxId;
      ctx.runtimeHarness = input.runtimeMetadata?.runtimeHarness;
      ctx.runtimeProtocolVersion = input.runtimeMetadata?.runtimeProtocolVersion;
    }),
    bindRuntimeSessionToContext: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.sandbox = input.runtimeSandbox;
      ctx.sandboxId = input.runtimeSandbox.sandboxId;
      ctx.runtimeHarness = input.runtimeMetadata?.runtimeHarness;
      ctx.runtimeProtocolVersion = input.runtimeMetadata?.runtimeProtocolVersion;
      ctx.sessionId = input.sessionId;
    }),
    persistRuntimeSessionBinding: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.runtimeHarness = input.runtimeMetadata?.runtimeHarness;
      ctx.runtimeProtocolVersion = input.runtimeMetadata?.runtimeProtocolVersion;
      ctx.sessionId = input.sessionId;
    }),
    setSnapshotRestoreAllowance: vi.fn(async (ctx: GenerationContext, allowed: boolean) => {
      ctx.executionPolicy = {
        ...ctx.executionPolicy,
        allowSnapshotRestoreOnRun: allowed,
      };
    }),
    getRemainingRunTimeMs: vi.fn((ctx: Pick<GenerationContext, "deadlineAt">) =>
      Math.max(0, ctx.deadlineAt.getTime() - Date.now()),
    ),
    parkGenerationForRunDeadline,
    startExternalInterruptPolling: vi.fn(),
    stopExternalInterruptPolling: vi.fn(),
    pollExternalInterruptAndSuspendIfNeeded: vi.fn().mockResolvedValue(undefined),
    awaitPromiseUntilRunDeadline: vi.fn(async (ctx: Pick<GenerationContext, "deadlineAt">, promise) => {
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
    scheduleSave: vi.fn(),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    importIntegrationSkillDraftsFromSandbox: vi.fn().mockResolvedValue(undefined),
    captureUsageFromRuntimeSession: vi.fn(async (
      ctx: GenerationContext,
      runtimeClient: RuntimeHarnessClient,
      sessionId: string,
    ) => {
      const result = await runtimeClient.messages({ sessionID: sessionId });
      const messages = Array.isArray(result.data) ? result.data : [];
      const tokens = messages.find((entry) => entry?.info?.role === "assistant")?.info?.tokens;
      if (tokens) {
        ctx.usage = {
          ...ctx.usage,
          inputTokens: Number(tokens.input ?? 0),
          outputTokens: Number(tokens.output ?? 0),
        };
      }
    }),
    captureOriginalError: vi.fn((ctx: GenerationContext, error: unknown, input) => {
      ctx.debugInfo = {
        ...(ctx.debugInfo ?? {}),
        originalErrorMessage: error instanceof Error ? error.message : String(error),
        originalErrorPhase: input?.phase ?? null,
        runtimeFailure: input?.runtimeFailure ?? null,
      };
    }),
    getCurrentPhase: vi.fn(() => "sandbox_init_started"),
    resolveRuntimeFailure,
    scheduleRecoveryReattach,
    turnFinalizer,
    ...callbackOverrides,
  };

  return {
    events,
    callbacks,
    finishGeneration,
    parkGenerationForRunDeadline,
    resolveRuntimeFailure,
    scheduleRecoveryReattach,
    turnFinalizer,
    runner: new OpenCodeNormalRunner(callbacks as never),
  };
}

describe("OpenCodeNormalRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "test-key",
      configurable: true,
    });
    conversationFindFirstMock.mockResolvedValue({ title: "Conversation" });
    resolveRuntimeEnvironmentForTurnMock.mockResolvedValue({
      allowedIntegrations: ["github"],
      cliInstructions: "cli instructions",
      integrationEnvs: {
        ALLOWED_INTEGRATIONS: "github",
        BAP_USER_TIMEZONE: "Europe/Dublin",
      },
      sandboxRuntimeEnv: {
        ALLOWED_INTEGRATIONS: "github",
        BAP_USER_TIMEZONE: "Europe/Dublin",
        BAP_USER_ID: "user-1",
      },
      userTimezone: "Europe/Dublin",
    });
    stagePrePromptAssetsMock.mockResolvedValue({
      enabledSkillRows: [],
      writtenSkills: ["base-skill"],
      writtenIntegrationSkills: ["github"],
      prePromptCacheHit: false,
      startPostPromptCacheWrite: null,
      runtimeVolumeMountPlan: null,
    });
    writeCoworkerDocumentsToSandboxMock.mockResolvedValue([]);
    resolveWorkspaceMcpServersForGenerationMock.mockResolvedValue({
      requestedServers: [],
      unavailableServers: [],
    });
    resolveBapPlatformMcpServerMock.mockResolvedValue({
      server: { type: "stdio", name: "bap", command: "bap", args: [], env: [] },
    });
    captureRuntimeNoProgressDiagnosticSnapshotMock.mockResolvedValue({
      id: "snapshot-1",
      storageKey: "runtime-diagnostic-snapshots/gen-1/snapshot.json",
      capturedAt: new Date("2026-06-14T10:00:00.000Z").toISOString(),
      reason: "runtime_no_progress_after_prompt",
      phase: "prompt_sent",
      timeoutMs: 1_000,
      uploadSucceeded: true,
      eventStats: { eventCount: 1, progressEventCount: 0 },
    });
  });

  it("fails after prompt send when OpenCode emits no Runtime Progress", async () => {
    vi.useFakeTimers();
    try {
      const promptStarted = createDeferred<void>();
      const prompt = vi.fn(() => {
        promptStarted.resolve(undefined);
        return new Promise<never>(() => undefined);
      });
      const abort = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSandboxRuntime({
        client: createRuntimeClient({
          prompt,
          abort,
          subscribe: vi.fn().mockResolvedValue({
            stream: asAsyncIterableThenHang([{ type: "server.connected", properties: {} }]),
          }),
        }),
      });
      const { runner, finishGeneration, parkGenerationForRunDeadline } = createRunner();
      const ctx = createContext({
        id: "gen-no-progress",
        conversationId: "conv-no-progress",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() + 60_000),
        executionPolicy: {
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
        },
      });

      const runPromise = runner.run(ctx);
      await promptStarted.promise;
      await vi.advanceTimersByTimeAsync(1_100);
      await runPromise;

      expect(abort).toHaveBeenCalledWith({ sessionID: "session-1" });
      expect(parkGenerationForRunDeadline).not.toHaveBeenCalled();
      expect(ctx.completionReason).toBe("runtime_no_progress_after_prompt");
      expect(ctx.errorMessage).toBe(
        "The runtime stopped responding before producing any output. Please retry.",
      );
      expect(captureRuntimeNoProgressDiagnosticSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx,
          reason: "runtime_no_progress_after_prompt",
          timeoutMs: 1_000,
          eventLoopSnapshot: expect.objectContaining({
            stats: expect.objectContaining({
              eventCount: 1,
              progressEventCount: 0,
            }),
          }),
        }),
      );
      expect(ctx.debugInfo?.runtimeDiagnosticSnapshot).toEqual(
        expect.objectContaining({
          reason: "runtime_no_progress_after_prompt",
          phase: "prompt_sent",
        }),
      );
      expect(finishGeneration).toHaveBeenCalledWith(ctx, "error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces assistant message errors discovered during the no-progress probe", async () => {
    vi.useFakeTimers();
    try {
      const promptStarted = createDeferred<void>();
      const prompt = vi.fn(() => {
        promptStarted.resolve(undefined);
        return new Promise<never>(() => undefined);
      });
      const messages = vi.fn().mockResolvedValue({
        data: [
          {
            info: {
              role: "assistant",
              error: { message: "Provider rejected model openai/gpt-5" },
            },
            parts: [],
          },
        ],
        error: null,
      });
      mockSandboxRuntime({
        client: createRuntimeClient({
          prompt,
          messages,
          subscribe: vi.fn().mockResolvedValue({
            stream: asAsyncIterableThenHang([{ type: "server.connected", properties: {} }]),
          }),
        }),
      });
      const { runner, finishGeneration } = createRunner();
      const ctx = createContext({
        id: "gen-message-error",
        conversationId: "conv-message-error",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() + 60_000),
        executionPolicy: {
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
        },
      });

      const runPromise = runner.run(ctx);
      await promptStarted.promise;
      await vi.advanceTimersByTimeAsync(1_100);
      await runPromise;

      expect(messages).toHaveBeenCalledWith({ sessionID: "session-1", limit: 20 });
      expect(ctx.completionReason).toBe("runtime_error");
      expect(ctx.errorMessage).toBe("Provider rejected model openai/gpt-5");
      expect(ctx.debugInfo?.originalErrorMessage).toContain(
        "OpenCode assistant message failed after prompt",
      );
      expect(finishGeneration).toHaveBeenCalledWith(ctx, "error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails after a settled prompt when OpenCode emits no Runtime Progress", async () => {
    vi.useFakeTimers();
    try {
      const prompt = vi.fn().mockResolvedValue({});
      mockSandboxRuntime({
        client: createRuntimeClient({
          prompt,
          messages: vi.fn().mockResolvedValue({ data: [], error: null }),
          getSession: vi.fn().mockResolvedValue({
            data: { id: "session-1", status: "busy" },
            error: null,
          }),
          subscribe: vi.fn().mockResolvedValue({
            stream: asAsyncIterableThenHang([{ type: "server.connected", properties: {} }]),
          }),
        }),
      });
      const { runner, finishGeneration, parkGenerationForRunDeadline } = createRunner();
      const ctx = createContext({
        id: "gen-settled-prompt-no-progress",
        conversationId: "conv-settled-prompt-no-progress",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() + 60_000),
        executionPolicy: {
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
        },
      });

      const runPromise = runner.run(ctx);
      await vi.advanceTimersByTimeAsync(1_100);
      await runPromise;

      expect(prompt).toHaveBeenCalledTimes(1);
      expect(parkGenerationForRunDeadline).not.toHaveBeenCalled();
      expect(ctx.completionReason).toBe("runtime_no_progress_after_prompt");
      expect(ctx.debugInfo?.runtimeDiagnosticSnapshot).toEqual(
        expect.objectContaining({
          reason: "runtime_no_progress_after_prompt",
          timeoutMs: 1_000,
        }),
      );
      expect(finishGeneration).toHaveBeenCalledWith(ctx, "error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails as a Runtime Progress Stall after tool-result progress stops", async () => {
    vi.useFakeTimers();
    try {
      const promptStarted = createDeferred<void>();
      const prompt = vi.fn(() => {
        promptStarted.resolve(undefined);
        return new Promise<never>(() => undefined);
      });
      const toolResultYielded = createDeferred<void>();
      async function* stalledToolResultStream(): AsyncIterable<RuntimeEvent> {
        for (const event of [
            {
              type: "message.updated",
              properties: { info: { id: "assistant-msg", role: "assistant" } },
            },
            {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "tool-part",
                  type: "tool",
                  tool: "bash",
                  callID: "tool-1",
                  messageID: "assistant-msg",
                  state: { status: "pending", input: { command: "echo hi" } },
                },
              },
            },
            {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "tool-part",
                  type: "tool",
                  tool: "bash",
                  callID: "tool-1",
                  messageID: "assistant-msg",
                  state: { status: "running", input: { command: "echo hi" } },
                },
              },
            },
            {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "tool-part",
                  type: "tool",
                  tool: "bash",
                  callID: "tool-1",
                  messageID: "assistant-msg",
                  state: {
                    status: "completed",
                    input: { command: "echo hi" },
                    output: "hi",
                  },
                },
              },
            },
          ] satisfies RuntimeEvent[]) {
          yield event;
        }
        toolResultYielded.resolve(undefined);
        await new Promise<never>(() => undefined);
      }
      const subscribe = vi.fn().mockResolvedValue({
        stream: stalledToolResultStream(),
      });
      mockSandboxRuntime({
        client: createRuntimeClient({
          prompt,
          subscribe,
        }),
      });
      const { runner, finishGeneration } = createRunner();
      const ctx = createContext({
        id: "gen-stalled",
        conversationId: "conv-stalled",
        model: "anthropic/claude-sonnet-4-6",
        deadlineAt: new Date(Date.now() + 60_000),
        executionPolicy: {
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
        },
      });

      const runPromise = runner.run(ctx);
      await promptStarted.promise;
      await toolResultYielded.promise;
      expect(ctx.lastRuntimeProgressKind).toBe("tool_result");
      const lastRuntimeProgressAt = ctx.lastRuntimeProgressAt;
      await vi.advanceTimersByTimeAsync(1_100);
      await runPromise;

      expect(ctx.completionReason).toBe("runtime_progress_stalled");
      expect(ctx.errorMessage).toBe("The runtime stopped making progress. Please retry.");
      expect(ctx.lastRuntimeProgressAt).toBe(lastRuntimeProgressAt);
      expect(captureRuntimeNoProgressDiagnosticSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "runtime_progress_stalled",
          timeoutMs: 1_000,
          lastRuntimeProgressAt,
          lastRuntimeProgressKind: "tool_result",
          eventLoopSnapshot: expect.objectContaining({
            stats: expect.objectContaining({
              eventCount: 4,
              progressEventCount: 2,
              toolCallCount: 1,
            }),
          }),
        }),
      );
      expect(finishGeneration).toHaveBeenCalledWith(ctx, "error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes coworker builder and runner turns to their OpenCode agents", async () => {
    const builderPrompt = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt: builderPrompt }) });
    const builderRunner = createRunner();
    const builderContext = {
      coworkerId: "coworker-1",
      updatedAt: "2026-06-14T10:00:00.000Z",
      prompt: "Current coworker prompt",
      model: "openai/gpt-5",
      toolAccessMode: "selected" as const,
      triggerType: "manual" as const,
      schedule: null,
      allowedIntegrations: ["github"],
    };
    await builderRunner.runner.run(
      createContext({
        id: "gen-builder",
        conversationId: "conv-builder",
        assistantContent: "done",
        builderCoworkerContext: builderContext,
      }),
    );

    expect(builderPrompt.mock.calls[0]?.[0]).toMatchObject({
      agent: BAP_COWORKER_BUILDER_AGENT_ID,
    });
    expect(builderPrompt.mock.calls[0]?.[0].system).toContain("Coworker Builder Runtime Context");
    expect(builderPrompt.mock.calls[0]?.[0].system).toContain("coworker-1");

    getOrCreateConversationSandboxMock.mockReset();
    writeCoworkerDocumentsToSandboxMock.mockResolvedValueOnce([
      "/home/user/coworker-documents/coworker-1/brief.pdf",
    ]);
    const runnerPrompt = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt: runnerPrompt }) });
    const coworkerRunner = createRunner();
    await coworkerRunner.runner.run(
      createContext({
        id: "gen-runner",
        conversationId: "conv-runner",
        assistantContent: "done",
        coworkerId: "coworker-1",
        coworkerRunId: "coworker-run-1",
        coworkerPrompt: "Run the scheduled report",
      }),
    );

    expect(runnerPrompt.mock.calls[0]?.[0]).toMatchObject({
      agent: BAP_COWORKER_RUNNER_AGENT_ID,
    });
    expect(runnerPrompt.mock.calls[0]?.[0].system).toContain("Run the scheduled report");
    expect(runnerPrompt.mock.calls[0]?.[0].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(
            "/home/user/coworker-documents/coworker-1/brief.pdf",
          ),
        }),
      ]),
    );
  });
});
