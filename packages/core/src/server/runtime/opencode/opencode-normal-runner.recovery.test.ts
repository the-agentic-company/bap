import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env";
import type { RuntimeHarnessClient, RuntimeEvent, SandboxHandle } from "../../sandbox/core/types";
import type { GenerationContext, GenerationEvent } from "../../services/generation/types";
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
  db: { query: { conversation: { findFirst: conversationFindFirstMock } } },
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
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerErrorMock },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function* asAsyncIterable(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event;
  }
}

function preparedAssets() {
  return {
    enabledSkillRows: [],
    writtenSkills: ["base-skill"],
    writtenIntegrationSkills: [],
    prePromptCacheHit: false,
    startPostPromptCacheWrite: null,
  };
}

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
    debugInfo: undefined,
    contentParts: [],
    assistantContent: "",
    abortController: new AbortController(),
    pendingApproval: null,
    pendingAuth: null,
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
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
    uploadedSandboxFileIds: new Set(),
    ...overrides,
  };
}

function createSandbox(overrides: Partial<SandboxHandle> = {}): SandboxHandle {
  return {
    provider: "e2b",
    sandboxId: "sandbox-1",
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
  completeAgentInit?: ReturnType<typeof vi.fn>;
} = {}) {
  const client = input.client ?? createRuntimeClient();
  const completeAgentInit =
    input.completeAgentInit ??
    vi.fn().mockResolvedValue({
      harnessClient: client,
      session: { id: "session-1" },
      sessionSource: "live_session",
      mcpWarnings: [],
    });
  getOrCreateConversationSandboxMock.mockResolvedValueOnce({
    sandbox: createSandbox(),
    metadata: {
      sandboxProvider: "e2b",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
    },
    completeAgentInit,
  });
  return { client, completeAgentInit };
}

function createRunner(callbackOverrides: Record<string, unknown> = {}) {
  const events: GenerationEvent[] = [];
  const finishGeneration = vi.fn().mockResolvedValue(undefined);
  const scheduleRecoveryReattach = vi.fn();
  const bridge = new OpenCodeTurnEventBridge({
    markPhase: (ctx, phase) => {
      ctx.phaseMarks = { ...(ctx.phaseMarks ?? {}), [phase]: Date.now() };
    },
    broadcast: (_ctx, event) => events.push(event),
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
    broadcast: vi.fn((_ctx: GenerationContext, event: GenerationEvent) => events.push(event)),
    bindRuntimeSandboxToContext: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.sandbox = input.runtimeSandbox;
      ctx.sandboxId = input.runtimeSandbox.sandboxId;
    }),
    bindRuntimeSessionToContext: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.sandbox = input.runtimeSandbox;
      ctx.sandboxId = input.runtimeSandbox.sandboxId;
      ctx.sessionId = input.sessionId;
    }),
    persistRuntimeSessionBinding: vi.fn(async (ctx: GenerationContext, input) => {
      ctx.sessionId = input.sessionId;
    }),
    setSnapshotRestoreAllowance: vi.fn().mockResolvedValue(undefined),
    getRemainingRunTimeMs: vi.fn((ctx: Pick<GenerationContext, "deadlineAt">) =>
      Math.max(0, ctx.deadlineAt.getTime() - Date.now()),
    ),
    parkGenerationForRunDeadline: vi.fn().mockResolvedValue(undefined),
    startExternalInterruptPolling: vi.fn(),
    stopExternalInterruptPolling: vi.fn(),
    pollExternalInterruptAndSuspendIfNeeded: vi.fn().mockResolvedValue(undefined),
    awaitPromiseUntilRunDeadline: vi.fn(async (_ctx, promise) => ({
      type: "resolved" as const,
      value: await promise,
    })),
    scheduleSave: vi.fn(),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    importIntegrationSkillDraftsFromSandbox: vi.fn().mockResolvedValue(undefined),
    captureUsageFromRuntimeSession: vi.fn().mockResolvedValue(undefined),
    captureOriginalError: vi.fn((ctx: GenerationContext, error: unknown, input) => {
      ctx.debugInfo = {
        ...(ctx.debugInfo ?? {}),
        originalErrorMessage: error instanceof Error ? error.message : String(error),
        originalErrorPhase: input?.phase ?? null,
      };
    }),
    getCurrentPhase: vi.fn(() => "prompt_sent"),
    resolveRuntimeFailure: vi.fn().mockResolvedValue("terminal_failed"),
    scheduleRecoveryReattach,
    turnFinalizer: {
      collectAndExposeMentionedSandboxFiles: vi.fn().mockResolvedValue(0),
    },
    ...callbackOverrides,
  };

  return {
    callbacks,
    events,
    finishGeneration,
    scheduleRecoveryReattach,
    runner: new OpenCodeNormalRunner(callbacks as never),
  };
}

describe("OpenCodeNormalRunner recovery and binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(env, "ANTHROPIC_API_KEY", { value: "test-key", configurable: true });
    conversationFindFirstMock.mockResolvedValue({ title: "Conversation" });
    resolveRuntimeEnvironmentForTurnMock.mockResolvedValue({
      allowedIntegrations: [],
      cliInstructions: "",
      integrationEnvs: {},
      sandboxRuntimeEnv: { BAP_USER_ID: "user-1" },
      userTimezone: "Europe/Dublin",
    });
    stagePrePromptAssetsMock.mockResolvedValue(preparedAssets());
    writeCoworkerDocumentsToSandboxMock.mockResolvedValue([]);
    resolveWorkspaceMcpServersForGenerationMock.mockResolvedValue({
      requestedServers: [],
      unavailableServers: [],
    });
    resolveBapPlatformMcpServerMock.mockResolvedValue({
      server: { type: "stdio", name: "bap", command: "bap", args: [], env: [] },
    });
    captureRuntimeNoProgressDiagnosticSnapshotMock.mockResolvedValue({});
  });

  it("binds the active runtime sandbox before pre-prompt work finishes and binds the session after init", async () => {
    const stageStarted = createDeferred<void>();
    const releaseStage = createDeferred<void>();
    stagePrePromptAssetsMock.mockImplementationOnce(async () => {
      stageStarted.resolve(undefined);
      await releaseStage.promise;
      return preparedAssets();
    });
    mockSandboxRuntime();
    const { runner, callbacks } = createRunner();
    const ctx = createContext();

    const runPromise = runner.run(ctx);
    await stageStarted.promise;

    expect(callbacks.bindRuntimeSandboxToContext).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        runtimeSandbox: expect.objectContaining({ sandboxId: "sandbox-1" }),
      }),
    );
    expect(callbacks.bindRuntimeSessionToContext).not.toHaveBeenCalled();

    releaseStage.resolve(undefined);
    await runPromise;

    expect(callbacks.persistRuntimeSessionBinding).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ sessionId: "session-1" }),
    );
    expect(callbacks.bindRuntimeSessionToContext).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });

  it("schedules recovery reattach without terminal finalization for recoverable live runtimes", async () => {
    const prompt = vi.fn().mockRejectedValue(new Error("transport closed"));
    mockSandboxRuntime({
      client: createRuntimeClient({
        prompt,
        subscribe: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([
            { type: "session.error", properties: { error: { message: "session failed" } } },
          ]),
        }),
      }),
    });
    const { runner, callbacks, scheduleRecoveryReattach, finishGeneration } = createRunner({
      resolveRuntimeFailure: vi.fn().mockResolvedValue("recoverable_live_runtime"),
    });
    const ctx = createContext({ id: "gen-recoverable", conversationId: "conv-recoverable" });

    await runner.run(ctx);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(callbacks.resolveRuntimeFailure).toHaveBeenCalledWith(ctx, expect.anything());
    expect(scheduleRecoveryReattach).toHaveBeenCalledWith(ctx);
    expect(finishGeneration).not.toHaveBeenCalled();
  });

  it("waits for the prompt rejection after a session error before finalizing", async () => {
    const promptResult = createDeferred<{ data: null; error: null }>();
    const prompt = vi.fn(() => promptResult.promise);
    mockSandboxRuntime({
      client: createRuntimeClient({
        prompt,
        subscribe: vi.fn().mockResolvedValue({
          stream: asAsyncIterable([
            { type: "session.error", properties: { error: { message: "session failed" } } },
          ]),
        }),
      }),
    });
    const { runner, callbacks, finishGeneration } = createRunner({
      resolveRuntimeFailure: vi.fn().mockResolvedValue("terminal_failed"),
    });
    const ctx = createContext({ id: "gen-session-error", conversationId: "conv-session-error" });

    const runPromise = runner.run(ctx);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(callbacks.resolveRuntimeFailure).not.toHaveBeenCalled();
    expect(finishGeneration).not.toHaveBeenCalled();

    promptResult.reject(new Error("prompt transport closed"));
    await runPromise;

    expect(callbacks.resolveRuntimeFailure).toHaveBeenCalledWith(ctx, expect.anything());
    expect(callbacks.setCompletionReason).toHaveBeenCalledWith(ctx, "runtime_error");
    expect(finishGeneration).toHaveBeenCalledWith(ctx, "error");
  });
});
