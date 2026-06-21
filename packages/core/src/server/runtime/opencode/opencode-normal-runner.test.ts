import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env";
import type { RuntimeHarnessClient, RuntimeEvent, SandboxHandle } from "../../sandbox/core/types";
import type { GenerationContext, GenerationEvent } from "../../services/generation/types";
import { BAP_CHAT_AGENT_ID } from "../../prompts/opencode-agent-ids";
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
    provider: "e2b", sandboxId: "sandbox-1",
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

  it("prepares runtime state, sends the OpenCode prompt, captures usage, and completes", async () => {
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    const messages = vi.fn().mockResolvedValue({
      data: [
        { info: { role: "assistant", tokens: { input: 123, output: 456 } }, parts: [] },
      ],
      error: null,
    });
    const { sandbox } = mockSandboxRuntime({
      client: createRuntimeClient({ prompt, messages }),
    });
    const { runner, finishGeneration, turnFinalizer } = createRunner();
    turnFinalizer.collectAndExposeMentionedSandboxFiles.mockResolvedValue(1);
    const ctx = createContext({
      id: "gen-opencode",
      conversationId: "conv-opencode",
      allowedIntegrations: ["github"],
      userMessageContent: "Process these files",
      assistantContent: "The generated file is report.txt.",
      attachments: [
        {
          name: "image.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
        {
          name: "notes.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
        },
      ],
    });

    await runner.run(ctx);

    expect(getOrCreateConversationSandboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-opencode",
        generationId: "gen-opencode",
        integrationEnvs: expect.objectContaining({
          ALLOWED_INTEGRATIONS: "github",
          BAP_USER_TIMEZONE: "Europe/Dublin",
        }),
      }),
      expect.objectContaining({
        replayHistory: true,
        allowSnapshotRestore: true,
      }),
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("/app/.bap/runtime-env.json"),
      expect.objectContaining({ timeoutMs: 15_000 }),
    );
    const runtimeEnvWriteCommand = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => String(call[0]).includes("/app/.bap/runtime-env.json"),
    )?.[0];
    expect(String(runtimeEnvWriteCommand)).toContain("/app/.bap/runtime-env.sh");
    expect(prompt).toHaveBeenCalledTimes(1);
    const promptInput = prompt.mock.calls[0]?.[0];
    expect(promptInput).toMatchObject({
      sessionID: "session-1",
      agent: BAP_CHAT_AGENT_ID,
      tools: { "*": true },
      model: { providerID: "openai", modelID: "gpt-5" },
    });
    expect(promptInput.system).toContain("cli instructions");
    expect(promptInput.system).toContain("memory prompt");
    expect(promptInput.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/home/user/uploads/image.png"),
        }),
        expect.objectContaining({
          type: "file",
          mime: "image/png",
          filename: "image.png",
        }),
      ]),
    );
    expect(ctx.userStagedFilePaths).toEqual(
      new Set(["/home/user/uploads/image.png", "/home/user/uploads/notes.txt"]),
    );
    expect(turnFinalizer.collectAndExposeMentionedSandboxFiles).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        collectionErrorMessage: expect.stringContaining("Failed to collect sandbox files"),
      }),
    );
    expect(ctx.usage).toMatchObject({ inputTokens: 123, outputTokens: 456 });
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
  });

  it("waits for early stream reattach before applying transcript assistant text", async () => {
    const subscribe = vi
      .fn()
      .mockResolvedValueOnce({
        stream: asAsyncIterable([{ type: "server.connected", properties: {} }]),
      })
      .mockResolvedValueOnce({
        stream: asAsyncIterable([{ type: "session.idle", properties: {} }]),
      });
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    const messages = vi.fn().mockResolvedValue({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "async prompt completed" }],
        },
      ],
      error: null,
    });
    mockSandboxRuntime({
      client: createRuntimeClient({ subscribe, prompt, messages }),
    });
    const { runner, finishGeneration } = createRunner();
    const ctx = createContext({
      id: "gen-early-stream",
      conversationId: "conv-early-stream",
      assistantContent: "",
    });

    await runner.run(ctx);

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(ctx.assistantContent).toBe("async prompt completed");
    expect(ctx.contentParts).toEqual(
      expect.arrayContaining([{ type: "text", text: "async prompt completed" }]),
    );
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
    expect(loggerErrorMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "OPENCODE_EMPTY_COMPLETION" }),
    );
  });

  it("polls durable cancellation while the OpenCode prompt is pending", async () => {
    const prompt = vi.fn(() => new Promise<never>(() => undefined));
    const abort = vi.fn().mockResolvedValue({ data: null, error: null });
    const subscribe = vi.fn().mockResolvedValue({
      stream: asAsyncIterableThenHang([]),
    });
    mockSandboxRuntime({
      client: createRuntimeClient({ subscribe, prompt, abort }),
    });
    const refreshCancellationSignal = vi.fn(async (ctx: GenerationContext) => {
      if (refreshCancellationSignal.mock.calls.length >= 2) {
        ctx.abortController.abort();
        return true;
      }
      return false;
    });
    const { runner, finishGeneration } = createRunner({
      refreshCancellationSignal,
    });
    const ctx = createContext({ id: "gen-cancel-pending-prompt" });

    const runPromise = runner.run(ctx);

    await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Runner did not finish after cancellation.")), 3_000);
      }),
    ]);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(refreshCancellationSignal).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "cancelled");
    expect(ctx.abortController.signal.aborted).toBe(true);
  });

  it("starts post-prompt cache writes without blocking prompt completion", async () => {
    const cacheWrite = createDeferred<void>();
    let cacheWriteStarted = false;
    stagePrePromptAssetsMock.mockResolvedValueOnce({
      enabledSkillRows: [{ name: "base-skill", updatedAt: new Date("2026-06-01T00:00:00Z") }],
      writtenSkills: ["base-skill"],
      writtenIntegrationSkills: [],
      prePromptCacheHit: false,
      startPostPromptCacheWrite: async () => {
        cacheWriteStarted = true;
        await cacheWrite.promise;
      },
    });
    const promptStarted = createDeferred<void>();
    const prompt = vi.fn().mockImplementation(async () => {
      promptStarted.resolve(undefined);
      return { data: null, error: null };
    });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt }) });
    const { runner, finishGeneration } = createRunner();
    const ctx = createContext({ assistantContent: "done" });

    const runPromise = runner.run(ctx);
    await promptStarted.promise;

    expect(cacheWriteStarted).toBe(true);
    await runPromise;
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");

    cacheWrite.resolve(undefined);
    await Promise.resolve();
  });

  it("treats post-prompt cache write failures as non-fatal", async () => {
    stagePrePromptAssetsMock.mockResolvedValueOnce({
      enabledSkillRows: [{ name: "base-skill", updatedAt: new Date("2026-06-01T00:00:00Z") }],
      writtenSkills: ["base-skill"],
      writtenIntegrationSkills: [],
      prePromptCacheHit: false,
      startPostPromptCacheWrite: async () => {
        throw new Error("cache write failed");
      },
    });
    const prompt = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt }) });
    const { runner, finishGeneration } = createRunner();
    const ctx = createContext({ assistantContent: "done" });

    await runner.run(ctx);
    await Promise.resolve();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "completed");
  });

  it("does not require Anthropic API keys for non-Anthropic runs but rejects Anthropic runs", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", {
      value: "",
      configurable: true,
    });
    const openAiPrompt = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt: openAiPrompt }) });
    const openAiRunner = createRunner();
    const openAiCtx = createContext({
      id: "gen-openai",
      conversationId: "conv-openai",
      model: "openai/gpt-5",
      assistantContent: "done",
    });

    await openAiRunner.runner.run(openAiCtx);

    expect(getOrCreateConversationSandboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5",
        anthropicApiKey: "",
      }),
      expect.anything(),
    );
    expect(openAiPrompt).toHaveBeenCalledTimes(1);
    expect(openAiRunner.finishGeneration).toHaveBeenCalledWith(openAiCtx, "completed");

    const anthropicRunner = createRunner();
    const anthropicCtx = createContext({
      id: "gen-anthropic",
      conversationId: "conv-anthropic",
      model: "anthropic/claude-sonnet-4-6",
    });

    await anthropicRunner.runner.run(anthropicCtx);

    expect(anthropicCtx.errorMessage).toBe("ANTHROPIC_API_KEY is not configured");
    expect(anthropicRunner.finishGeneration).toHaveBeenCalledWith(anthropicCtx, "error");
  });

  it("uses the snapshot-restore policy and finalizes bootstrap timeouts directly", async () => {
    mockSandboxRuntime();
    const { runner } = createRunner();
    const ctx = createContext({
      id: "gen-active-reattach",
      conversationId: "conv-active-reattach",
      assistantContent: "done",
      executionPolicy: { allowSnapshotRestoreOnRun: false },
    });

    await runner.run(ctx);

    expect(getOrCreateConversationSandboxMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowSnapshotRestore: false }),
    );

    getOrCreateConversationSandboxMock.mockReset();
    getOrCreateConversationSandboxMock.mockRejectedValueOnce(
      new Error("Agent preparation timed out after 45 seconds."),
    );
    const timeoutRunner = createRunner();
    const timeoutCtx = createContext({
      id: "gen-bootstrap-timeout",
      conversationId: "conv-bootstrap-timeout",
    });

    await timeoutRunner.runner.run(timeoutCtx);

    expect(timeoutCtx.completionReason).toBe("bootstrap_timeout");
    expect(timeoutCtx.errorMessage).toBe("Agent preparation timed out after 45 seconds.");
    expect(timeoutRunner.finishGeneration).toHaveBeenCalledWith(timeoutCtx, "error");
    expect(timeoutRunner.resolveRuntimeFailure).not.toHaveBeenCalled();
  });

  it("parks when the run deadline is already elapsed or the prompt hangs past it", async () => {
    const elapsedPrompt = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSandboxRuntime({ client: createRuntimeClient({ prompt: elapsedPrompt }) });
    const elapsedRunner = createRunner();
    const elapsedCtx = createContext({
      id: "gen-deadline-elapsed",
      conversationId: "conv-deadline-elapsed",
      deadlineAt: new Date(Date.now() - 1_000),
    });

    await elapsedRunner.runner.run(elapsedCtx);

    expect(elapsedPrompt).not.toHaveBeenCalled();
    expect(elapsedRunner.parkGenerationForRunDeadline).toHaveBeenCalledWith(
      elapsedCtx,
      expect.anything(),
    );
    expect(elapsedRunner.finishGeneration).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const promptStarted = createDeferred<void>();
      const hangingPrompt = vi.fn(() => {
        promptStarted.resolve(undefined);
        return new Promise<never>(() => undefined);
      });
      getOrCreateConversationSandboxMock.mockReset();
      mockSandboxRuntime({
        client: createRuntimeClient({ prompt: hangingPrompt }),
      });
      const hangingRunner = createRunner();
      const hangingCtx = createContext({
        id: "gen-deadline-hanging-prompt",
        conversationId: "conv-deadline-hanging-prompt",
        deadlineAt: new Date(Date.now() + 50),
        assistantContent: "done",
      });

      const runPromise = hangingRunner.runner.run(hangingCtx);
      await promptStarted.promise;
      await vi.advanceTimersByTimeAsync(60);
      await runPromise;

      expect(hangingRunner.parkGenerationForRunDeadline).toHaveBeenCalledWith(
        hangingCtx,
        expect.anything(),
      );
      expect(hangingRunner.finishGeneration).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });


});
