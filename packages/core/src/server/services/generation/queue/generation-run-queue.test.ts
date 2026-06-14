import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { GenerationContext, GenerationRunMode } from "../types";
import type { QueuedGenerationRecord } from "../turn-runner";

const {
  generationFindFirstMock,
  messageFindFirstMock,
  coworkerRunFindFirstMock,
  coworkerFindFirstMock,
  getPendingInterruptForGenerationMock,
  getRuntimeMock,
  getRuntimeForConversationMock,
  resolveCoworkerBuilderContextByConversationMock,
  generationStreamExistsMock,
  queueAddMock,
  getQueueMock,
  createTraceIdMock,
  loggerWarnMock,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const generationFindFirstMock = vi.fn();
  const messageFindFirstMock = vi.fn();
  const coworkerRunFindFirstMock = vi.fn();
  const coworkerFindFirstMock = vi.fn();
  const getPendingInterruptForGenerationMock = vi.fn();
  const getRuntimeMock = vi.fn();
  const getRuntimeForConversationMock = vi.fn();
  const resolveCoworkerBuilderContextByConversationMock = vi.fn();
  const generationStreamExistsMock = vi.fn();
  const queueAddMock = vi.fn();
  const queueMock = {
    add: queueAddMock,
  };
  const getQueueMock = vi.fn(() => queueMock);
  const createTraceIdMock = vi.fn();
  const loggerWarnMock = vi.fn();

  const dbMock = {
    query: {
      generation: {
        findFirst: generationFindFirstMock,
      },
      message: {
        findFirst: messageFindFirstMock,
      },
      coworkerRun: {
        findFirst: coworkerRunFindFirstMock,
      },
      coworker: {
        findFirst: coworkerFindFirstMock,
      },
    },
  };

  return {
    generationFindFirstMock,
    messageFindFirstMock,
    coworkerRunFindFirstMock,
    coworkerFindFirstMock,
    getPendingInterruptForGenerationMock,
    getRuntimeMock,
    getRuntimeForConversationMock,
    resolveCoworkerBuilderContextByConversationMock,
    generationStreamExistsMock,
    queueAddMock,
    getQueueMock,
    createTraceIdMock,
    loggerWarnMock,
    queueMock,
    dbMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../../../redis/generation-event-bus", () => ({
  generationStreamExists: generationStreamExistsMock,
}));

vi.mock("../../../queues/queue-client", () => ({
  CHAT_GENERATION_JOB_NAME: "generation:chat-run",
  COWORKER_GENERATION_JOB_NAME: "generation:coworker-run",
  buildQueueJobId: (parts: Array<string | number | null | undefined>) =>
    parts
      .map((part) => String(part ?? "").trim())
      .filter((part) => part.length > 0)
      .join("-")
      .replaceAll(":", "-")
      .replaceAll(/\s+/g, "-")
      .replaceAll(/-+/g, "-"),
  getQueue: getQueueMock,
}));

vi.mock("../../../utils/observability", () => ({
  createTraceId: createTraceIdMock,
  logger: {
    warn: loggerWarnMock,
  },
}));

vi.mock("../../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    getRuntime: getRuntimeMock,
    getRuntimeForConversation: getRuntimeForConversationMock,
  },
}));

vi.mock("../../coworker-builder-service", () => ({
  resolveCoworkerBuilderContextByConversation: resolveCoworkerBuilderContextByConversationMock,
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
  },
}));

import { GenerationRunQueue } from "./generation-run-queue";
import { TurnRunnerContextLoader } from "../turn-runner";

type GenerationRunQueuePrivate = GenerationRunQueue & {
  runQueuedGenerationSelfHealIfStalled(input: {
    generationId: string;
    runMode: GenerationRunMode;
  }): Promise<void>;
  isGenerationLeaseHeld(generationId: string): Promise<boolean>;
};

const originalNodeEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.REDIS_URL;

function createQueue() {
  const activeGenerations = new Map<string, GenerationContext>();
  const lifecycleStore = {
    resumeResolvedInterrupt: vi.fn(),
    touchConversationLastUserVisibleAction: vi.fn(),
  };
  const runQueuedGeneration = vi.fn().mockResolvedValue(undefined);

  const queue = new GenerationRunQueue({
    activeGenerations,
    lifecycleStore: lifecycleStore as unknown as GenerationLifecycleStore,
    runQueuedGeneration,
    formatErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return {
    queue,
    activeGenerations,
    lifecycleStore,
    runQueuedGeneration,
  };
}

function pristineRunningGenerationRecord(generationId: string) {
  return {
    id: generationId,
    conversationId: "conv-self-heal",
    status: "running",
    messageId: null,
    sandboxId: null,
    runtimeHarness: null,
    runtimeProtocolVersion: null,
    completedAt: null,
  };
}

function queuedGenerationRecord(overrides: Partial<QueuedGenerationRecord> = {}) {
  return {
    id: "gen-queued",
    traceId: "trace-queued",
    conversationId: "conv-queued",
    runtimeId: null,
    status: "running",
    startedAt: new Date("2026-06-14T10:00:00.000Z"),
    deadlineAt: null,
    remainingRunMs: null,
    suspendedAt: null,
    resumeInterruptId: null,
    lastRuntimeProgressAt: null,
    recoveryAttempts: 0,
    completionReason: null,
    debugInfo: null,
    contentParts: [],
    inputTokens: 0,
    outputTokens: 0,
    spawnDepth: 0,
    conversation: {
      id: "conv-queued",
      userId: "user-1",
      workspaceId: null,
      autoApprove: false,
      model: "anthropic/claude-sonnet-4-6",
      authSource: null,
      type: "chat",
    },
    ...overrides,
  } as QueuedGenerationRecord;
}

describe("GenerationRunQueue", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.REDIS_URL = originalRedisUrl;
    getQueueMock.mockReturnValue(queueMock);
    queueAddMock.mockResolvedValue(undefined);
    generationFindFirstMock.mockResolvedValue(null);
    messageFindFirstMock.mockResolvedValue({ content: "run the queued turn" });
    coworkerRunFindFirstMock.mockResolvedValue(null);
    coworkerFindFirstMock.mockResolvedValue(null);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
    getRuntimeMock.mockResolvedValue(null);
    getRuntimeForConversationMock.mockResolvedValue(null);
    resolveCoworkerBuilderContextByConversationMock.mockResolvedValue(null);
    createTraceIdMock.mockReturnValue("trace-generated");
    generationStreamExistsMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.REDIS_URL = originalRedisUrl;
  });

  it("enqueues chat and coworker Generation runs with stable job ids", async () => {
    const { queue } = createQueue();

    await queue.enqueueGenerationRun("gen-chat", "chat", {
      traceId: "trace-1",
    });
    await queue.enqueueGenerationRun("gen-coworker", "coworker", {
      delayMs: 42,
      dedupeKey: "retry",
      runMode: "recovery_reattach",
    });

    expect(queueAddMock).toHaveBeenNthCalledWith(
      1,
      "generation:chat-run",
      { generationId: "gen-chat", runMode: "normal_run", traceId: "trace-1" },
      {
        jobId: "generation-chat-run-gen-chat",
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
    expect(queueAddMock).toHaveBeenNthCalledWith(
      2,
      "generation:coworker-run",
      { generationId: "gen-coworker", runMode: "recovery_reattach" },
      {
        jobId: "generation-coworker-run-gen-coworker-retry",
        delay: 42,
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  });

  it("enqueues resolved interrupt resumes with restored running state and resume job ids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T15:00:00.000Z"));
    const { queue, lifecycleStore } = createQueue();
    const interrupt = {
      id: "interrupt-detached-approval",
      generationId: "gen-detached-approval",
      runtimeId: "runtime-1",
      conversationId: "conv-detached-approval",
      turnSeq: 1,
      kind: "runtime_permission",
      status: "accepted",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        command: "external_directory",
        toolInput: { permission: "external_directory" },
      },
      provider: "runtime",
      providerRequestId: "permission-request-1",
      providerToolUseId: "tool-detached-approval",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T14:59:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:00:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
      appliedAt: null,
    };

    await queue.enqueueResolvedInterruptResume({
      generationId: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      interrupt: interrupt as never,
      runType: "chat",
      remainingRunMs: 222_000,
    });

    expect(lifecycleStore.resumeResolvedInterrupt).toHaveBeenCalledWith({
      generationId: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      coworkerRunId: undefined,
      interruptId: "interrupt-detached-approval",
      deadlineAt: new Date("2026-03-11T15:03:42.000Z"),
    });
    expect(queueAddMock).toHaveBeenCalledWith(
      "generation:chat-run",
      { generationId: "gen-detached-approval", runMode: "normal_run" },
      {
        jobId: "generation-chat-run-gen-detached-approval-resume-interrupt-interrupt-detached-approval",
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  });

  it("does not enqueue a resolved interrupt resume after the interrupt has already been applied", async () => {
    const { queue, lifecycleStore } = createQueue();

    await queue.enqueueResolvedInterruptResume({
      generationId: "gen-applied",
      conversationId: "conv-applied",
      interrupt: { id: "interrupt-applied", appliedAt: new Date() } as never,
      runType: "chat",
      remainingRunMs: 120_000,
    });

    expect(lifecycleStore.resumeResolvedInterrupt).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("self-heals queued Generations that never leave their pristine running state", async () => {
    vi.useFakeTimers();
    process.env.NODE_ENV = "development";
    delete process.env.REDIS_URL;
    generationFindFirstMock.mockResolvedValueOnce(pristineRunningGenerationRecord("gen-self-heal"));
    generationStreamExistsMock.mockResolvedValueOnce(false);

    const { queue, runQueuedGeneration } = createQueue();
    await queue.enqueueGenerationRun("gen-self-heal", "chat");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(runQueuedGeneration).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(generationStreamExistsMock).toHaveBeenCalledWith("gen-self-heal");
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "GENERATION_QUEUE_SELF_HEAL_TRIGGERED",
        generationId: "gen-self-heal",
        conversationId: "conv-self-heal",
        runMode: "normal_run",
      }),
    );
    expect(runQueuedGeneration).toHaveBeenCalledWith("gen-self-heal", "normal_run");
  });

  it("skips queued Generation self-heal when another process already holds the lease", async () => {
    const { queue, runQueuedGeneration } = createQueue();
    const queuePrivate = queue as unknown as GenerationRunQueuePrivate;
    vi.spyOn(queuePrivate, "isGenerationLeaseHeld").mockResolvedValueOnce(true);
    generationFindFirstMock.mockResolvedValueOnce(pristineRunningGenerationRecord("gen-self-heal"));

    await queuePrivate.runQueuedGenerationSelfHealIfStalled({
      generationId: "gen-self-heal",
      runMode: "normal_run",
    });

    expect(generationStreamExistsMock).not.toHaveBeenCalled();
    expect(runQueuedGeneration).not.toHaveBeenCalled();
  });

  it("delays queued Generation self-heal by the queue delay plus the grace period", async () => {
    vi.useFakeTimers();
    process.env.NODE_ENV = "development";
    delete process.env.REDIS_URL;
    generationFindFirstMock.mockResolvedValueOnce(pristineRunningGenerationRecord("gen-timer"));

    const { queue, runQueuedGeneration } = createQueue();
    await queue.enqueueGenerationRun("gen-timer", "chat", {
      delayMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(5_999);
    expect(runQueuedGeneration).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runQueuedGeneration).toHaveBeenCalledWith("gen-timer", "normal_run");
  });

  it("rehydrates queued file attachments into the Generation context", async () => {
    const queuedAttachment = {
      name: "questionnaire.pdf",
      mimeType: "application/pdf",
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
    };
    const loader = new TurnRunnerContextLoader({
      getExecutionPolicyFromRecord: vi.fn(() => ({
        autoApprove: false,
        queuedFileAttachments: [queuedAttachment],
      })),
    });

    const result = await loader.loadQueuedGenerationContext(queuedGenerationRecord());

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        context: expect.objectContaining({
          id: "gen-queued",
          userMessageContent: "run the queued turn",
          attachments: [queuedAttachment],
        }),
      }),
    );
  });

  it("rehydrates Coworker ids for queued Coworker Generations", async () => {
    coworkerRunFindFirstMock.mockResolvedValueOnce({
      id: "wf-run-1",
      coworkerId: "wf-1",
      triggerPayload: null,
      spawnDepth: 1,
    });
    coworkerFindFirstMock.mockResolvedValueOnce({
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: [],
      allowedSkillSlugs: [],
      prompt: "prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: false,
    });
    const loader = new TurnRunnerContextLoader({
      getExecutionPolicyFromRecord: vi.fn(() => ({
        autoApprove: false,
      })),
    });

    const result = await loader.loadQueuedGenerationContext(
      queuedGenerationRecord({
        id: "gen-coworker-queued",
        conversationId: "conv-coworker-queued",
        conversation: {
          id: "conv-coworker-queued",
          userId: "user-1",
          workspaceId: null,
          autoApprove: false,
          model: "anthropic/claude-sonnet-4-6",
          authSource: null,
          type: "coworker",
        },
      } as Partial<QueuedGenerationRecord>),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        context: expect.objectContaining({
          coworkerId: "wf-1",
          coworkerRunId: "wf-run-1",
          allowedIntegrations: ["github"],
          spawnDepth: 1,
        }),
      }),
    );
  });

  it("skips queued Generation rehydration when the runtime has been rebound", async () => {
    getRuntimeMock.mockResolvedValueOnce({
      id: "runtime-1",
      conversationId: "conv-queued",
      callbackToken: "runtime-token",
      sandboxProvider: null,
      runtimeHarness: null,
      runtimeProtocolVersion: null,
      sandboxId: null,
      sessionId: null,
      status: "active",
      activeGenerationId: "gen-other",
      activeTurnSeq: 2,
      lastBoundAt: null,
      createdAt: new Date("2026-03-11T15:00:00.000Z"),
      updatedAt: new Date("2026-03-11T15:00:00.000Z"),
    });
    const loader = new TurnRunnerContextLoader({
      getExecutionPolicyFromRecord: vi.fn(() => ({
        autoApprove: false,
      })),
    });

    const result = await loader.loadQueuedGenerationContext(
      queuedGenerationRecord({
        id: "gen-stale",
        runtimeId: "runtime-1",
      }),
    );

    expect(result).toEqual({ status: "runtime_stale" });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "QUEUED_GENERATION_RUNTIME_STALE",
        generationId: "gen-stale",
        runtimeId: "runtime-1",
        runtimeActiveGenerationId: "gen-other",
      }),
    );
  });
});
