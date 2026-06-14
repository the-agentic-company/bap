import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  bindGenerationToRuntimeMock,
  checkModelAccessForUserMock,
  conversationFindFirstMock,
  createTraceIdMock,
  dbMock,
  enqueueGenerationRunMock,
  enqueuePreparingStuckCheckMock,
  generationFindFirstMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  insertReturningMock,
  insertValuesMock,
  lifecycleStoreMock,
  loggerErrorMock,
  loggerInfoMock,
  loggerWarnMock,
  markConversationGenerationStartedMock,
  persistMessageAttachmentsMock,
  resolveCoworkerBuilderContextByConversationMock,
  resolveSelectedPlatformSkillSlugsMock,
  updateSetMock,
  updateWhereMock,
  userFindFirstMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => {
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const generationFindFirstMock = vi.fn();
  const conversationFindFirstMock = vi.fn();
  const userFindFirstMock = vi.fn();
  const coworkerFindFirstMock = vi.fn();

  const dbMock = {
    query: {
      generation: { findFirst: generationFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
      user: { findFirst: userFindFirstMock },
      coworker: { findFirst: coworkerFindFirstMock },
    },
    insert: insertMock,
    update: updateMock,
  };

  const markConversationGenerationStartedMock = vi.fn();
  const lifecycleStoreMock = {
    updateConversationModelSelection: vi.fn(),
    markConversationGenerationStarted: markConversationGenerationStartedMock,
  };

  return {
    bindGenerationToRuntimeMock: vi.fn(),
    checkModelAccessForUserMock: vi.fn(),
    conversationFindFirstMock,
    createTraceIdMock: vi.fn(),
    dbMock,
    enqueueGenerationRunMock: vi.fn(),
    enqueuePreparingStuckCheckMock: vi.fn(),
    generationFindFirstMock,
    generateCoworkerMetadataOnFirstPromptFillMock: vi.fn(),
    insertReturningMock,
    insertValuesMock,
    lifecycleStoreMock,
    loggerErrorMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    markConversationGenerationStartedMock,
    persistMessageAttachmentsMock: vi.fn(),
    resolveCoworkerBuilderContextByConversationMock: vi.fn(),
    resolveSelectedPlatformSkillSlugsMock: vi.fn(),
    updateSetMock,
    updateWhereMock,
    userFindFirstMock,
    coworkerFindFirstMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../../utils/observability", () => ({
  createTraceId: createTraceIdMock,
  logger: {
    error: loggerErrorMock,
    info: loggerInfoMock,
    warn: loggerWarnMock,
  },
}));

vi.mock("../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    bindGenerationToRuntime: bindGenerationToRuntimeMock,
  },
}));

vi.mock("../coworker-builder-service", () => ({
  resolveCoworkerBuilderContextByConversation: resolveCoworkerBuilderContextByConversationMock,
}));

vi.mock("../coworker-metadata", () => ({
  generateCoworkerMetadataOnFirstPromptFill: generateCoworkerMetadataOnFirstPromptFillMock,
}));

vi.mock("../platform-skill-service", () => ({
  resolveSelectedPlatformSkillSlugs: resolveSelectedPlatformSkillSlugsMock,
}));

vi.mock("./model-access", () => ({
  checkModelAccessForUser: checkModelAccessForUserMock,
}));

import { generationLifecyclePolicy } from "../lifecycle-policy";
import { TurnIntake } from "./turn-intake";

function createTurnIntake() {
  return new TurnIntake({
    lifecycleStore: lifecycleStoreMock,
    persistMessageAttachments: persistMessageAttachmentsMock,
    enqueuePreparingStuckCheck: enqueuePreparingStuckCheckMock,
    enqueueGenerationRun: enqueueGenerationRunMock,
  } as never);
}

function insertedValues(): Array<Record<string, unknown>> {
  return insertValuesMock.mock.calls.map(([values]) => values as Record<string, unknown>);
}

function insertedGenerationValues(): Record<string, unknown> {
  const values = insertedValues().find((entry) => entry.status === "running");
  if (!values) {
    throw new Error("Generation insert values were not captured");
  }
  return values;
}

function chatConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    model: "anthropic/claude-opus-4-1",
    authSource: "shared",
    autoApprove: false,
    type: "chat",
    ...overrides,
  };
}

describe("TurnIntake.startGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createTraceIdMock.mockReturnValue("trace-1");
    generationFindFirstMock.mockResolvedValue(null);
    conversationFindFirstMock.mockResolvedValue(null);
    userFindFirstMock.mockResolvedValue({ activeWorkspaceId: "workspace-1" });
    coworkerFindFirstMock.mockResolvedValue(null);
    checkModelAccessForUserMock.mockResolvedValue({ allowed: true });
    resolveSelectedPlatformSkillSlugsMock.mockResolvedValue([]);
    resolveCoworkerBuilderContextByConversationMock.mockResolvedValue(null);
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValue({});
    bindGenerationToRuntimeMock.mockResolvedValue({ runtimeId: "runtime-1", turnSeq: 1 });
    lifecycleStoreMock.updateConversationModelSelection.mockResolvedValue(null);
    markConversationGenerationStartedMock.mockResolvedValue(undefined);
    persistMessageAttachmentsMock.mockResolvedValue(undefined);
    enqueuePreparingStuckCheckMock.mockResolvedValue(undefined);
    enqueueGenerationRunMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it("starts a new Generation and enqueues the background run", async () => {
    insertReturningMock
      .mockResolvedValueOnce([chatConversation({ id: "conv-new", model: "openai/gpt-5.5" })])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-new" }]);

    const result = await createTurnIntake().startGeneration({
      content: "Write a status update",
      userId: "user-1",
    });

    expect(result).toEqual({
      generationId: "gen-new",
      conversationId: "conv-new",
      traceId: "trace-1",
    });
    expect(enqueuePreparingStuckCheckMock).toHaveBeenCalledWith("gen-new");
    expect(enqueueGenerationRunMock).toHaveBeenCalledWith("gen-new", "chat", {
      traceId: "trace-1",
    });
    expect(markConversationGenerationStartedMock).toHaveBeenCalledWith({
      conversationId: "conv-new",
      generationId: "gen-new",
    });
  });

  it("persists a debug run deadline override when starting a chat Generation", async () => {
    const startedAtMs = Date.now();
    insertReturningMock
      .mockResolvedValueOnce([
        chatConversation({ id: "conv-debug-deadline", model: "anthropic/claude-opus-4-1" }),
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-debug-deadline" }]);

    await createTurnIntake().startGeneration({
      content: "Run until the debug deadline",
      userId: "user-1",
      debugRunDeadlineMs: 60_000,
    });

    const generationInsert = insertedGenerationValues() as {
      deadlineAt?: Date;
      executionPolicy?: { debugRunDeadlineMs?: number };
      remainingRunMs?: number;
    };
    expect(generationInsert.remainingRunMs).toBe(60_000);
    expect(generationInsert.executionPolicy?.debugRunDeadlineMs).toBe(60_000);
    expect(generationInsert.deadlineAt).toBeInstanceOf(Date);
    const deadlineDeltaMs = generationInsert.deadlineAt!.getTime() - startedAtMs;
    expect(deadlineDeltaMs).toBeGreaterThanOrEqual(60_000);
    expect(deadlineDeltaMs).toBeLessThan(generationLifecyclePolicy.runDeadlineMs);
  });

  it("rejects invalid debug run deadline overrides", async () => {
    await expect(
      createTurnIntake().startGeneration({
        content: "hello",
        userId: "user-1",
        debugRunDeadlineMs: 999,
      }),
    ).rejects.toThrow("debugRunDeadlineMs must be an integer");

    await expect(
      createTurnIntake().startGeneration({
        content: "hello",
        userId: "user-1",
        debugRunDeadlineMs: 16 * 60 * 1000,
      }),
    ).rejects.toThrow("debugRunDeadlineMs must be an integer");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("does not persist per-run autoApprove onto an existing conversation", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      chatConversation({ id: "conv-existing", autoApprove: true }),
    );
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-existing" }]);

    const result = await createTurnIntake().startGeneration({
      conversationId: "conv-existing",
      content: "hello",
      userId: "user-1",
      autoApprove: false,
    });

    expect(result).toEqual({
      generationId: "gen-existing",
      conversationId: "conv-existing",
      traceId: "trace-1",
    });
    expect(insertedGenerationValues().executionPolicy).toEqual(
      expect.objectContaining({ autoApprove: false }),
    );
    expect(updateSetMock).not.toHaveBeenCalledWith(expect.objectContaining({ autoApprove: false }));
  });

  it("fills Coworker metadata from the first builder user message before the prompt patch lands", async () => {
    const builderContext = {
      coworkerId: "cw-1",
      updatedAt: "2026-03-12T10:00:00.000Z",
      prompt: "",
      model: "anthropic/claude-opus-4-1",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["slack"],
      requiresUserInput: false,
      userInputPrompt: null,
    };
    conversationFindFirstMock.mockResolvedValueOnce(
      chatConversation({ id: "conv-coworker-builder", type: "coworker" }),
    );
    resolveCoworkerBuilderContextByConversationMock
      .mockResolvedValueOnce(builderContext)
      .mockResolvedValueOnce({ ...builderContext, updatedAt: "2026-03-12T10:00:01.000Z" });
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: "cw-1",
      name: "",
      description: null,
      username: null,
      prompt: "",
      triggerType: "manual",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      autoApprove: false,
      promptDo: null,
      promptDont: null,
    });
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      name: "Follow up with new inbound leads after every sales call",
      description: "Follow up with new inbound leads after every sales call.",
      username: "follow-up-with-new-inbound-leads-after-every-sales-call",
    });
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-coworker-builder" }]);

    await createTurnIntake().startGeneration({
      conversationId: "conv-coworker-builder",
      content: "Follow up with new inbound leads after every sales call.",
      userId: "user-1",
    });

    expect(generateCoworkerMetadataOnFirstPromptFillMock).toHaveBeenCalledWith(
      expect.objectContaining({
        current: expect.objectContaining({ id: "cw-1", prompt: "" }),
        next: expect.objectContaining({
          id: "cw-1",
          prompt: "Follow up with new inbound leads after every sales call.",
        }),
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith({
      name: "Follow up with new inbound leads after every sales call",
      description: "Follow up with new inbound leads after every sales call.",
      username: "follow-up-with-new-inbound-leads-after-every-sales-call",
    });
    expect(enqueueGenerationRunMock).toHaveBeenCalledWith("gen-coworker-builder", "chat", {
      traceId: "trace-1",
    });
  });

  it("starts requested OpenAI subscription models after model access passes", async () => {
    insertReturningMock
      .mockResolvedValueOnce([
        chatConversation({
          id: "conv-openai",
          model: "openai/gpt-5.4",
          authSource: "shared",
        }),
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-openai" }]);

    await createTurnIntake().startGeneration({
      content: "hi",
      userId: "user-1",
      model: "openai/gpt-5.4",
    });

    expect(checkModelAccessForUserMock).toHaveBeenCalledWith({
      userId: "user-1",
      model: "openai/gpt-5.4",
      authSource: "shared",
    });
    expect(enqueueGenerationRunMock).toHaveBeenCalledWith("gen-openai", "chat", {
      traceId: "trace-1",
    });
  });

  it("rejects startGeneration when an active Generation already exists in the DB", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-existing",
      status: "running",
    });

    await expect(
      createTurnIntake().startGeneration({
        conversationId: "conv-existing",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Generation already in progress for this conversation");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("allows attach resume when the active Generation is paused for a run deadline and the new turn is continue", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-paused-deadline",
      status: "paused",
      completionReason: "run_deadline",
    });
    conversationFindFirstMock.mockResolvedValueOnce(chatConversation({ id: "conv-deadline" }));
    insertReturningMock
      .mockResolvedValueOnce([{ id: "msg-continue" }])
      .mockResolvedValueOnce([{ id: "gen-resumed" }]);

    const result = await createTurnIntake().startGeneration({
      conversationId: "conv-deadline",
      content: "continue",
      userId: "user-1",
    });

    expect(result).toEqual({
      generationId: "gen-resumed",
      conversationId: "conv-deadline",
      traceId: "trace-1",
    });
    expect(enqueueGenerationRunMock).toHaveBeenCalledWith("gen-resumed", "chat", {
      traceId: "trace-1",
    });
  });

  it("rejects startGeneration when the conversation belongs to another user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(
      chatConversation({
        id: "conv-1",
        userId: "other-user",
      }),
    );

    await expect(
      createTurnIntake().startGeneration({
        conversationId: "conv-1",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Access denied");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported auth sources for shared-only providers", async () => {
    await expect(
      createTurnIntake().startGeneration({
        content: "hello",
        userId: "user-1",
        model: "anthropic/claude-sonnet-4-6",
        authSource: "user",
      }),
    ).rejects.toThrow('Model provider "anthropic" does not support auth source "user".');
    expect(checkModelAccessForUserMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});

describe("TurnIntake.startCoworkerGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createTraceIdMock.mockReturnValue("trace-1");
    checkModelAccessForUserMock.mockResolvedValue({ allowed: true });
    resolveSelectedPlatformSkillSlugsMock.mockResolvedValue(["platform:calendar"]);
    bindGenerationToRuntimeMock.mockResolvedValue({ runtimeId: "runtime-1", turnSeq: 1 });
    lifecycleStoreMock.updateConversationModelSelection.mockResolvedValue(null);
    markConversationGenerationStartedMock.mockResolvedValue(undefined);
    persistMessageAttachmentsMock.mockResolvedValue(undefined);
    enqueuePreparingStuckCheckMock.mockResolvedValue(undefined);
    enqueueGenerationRunMock.mockResolvedValue(undefined);
  });

  it("starts a Coworker Generation and keeps Coworker context fields", async () => {
    insertReturningMock
      .mockResolvedValueOnce([
        chatConversation({
          id: "conv-coworker",
          model: "anthropic/claude-opus-4-1",
          autoApprove: true,
          type: "coworker",
        }),
      ])
      .mockResolvedValueOnce([{ id: "msg-coworker-user" }])
      .mockResolvedValueOnce([{ id: "gen-coworker" }]);

    const result = await createTurnIntake().startCoworkerGeneration({
      coworkerId: "wf-1",
      coworkerRunId: "wf-run-1",
      content: "Create a weekly report",
      userId: "user-1",
      autoApprove: true,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: ["custom-slug"],
      allowedWorkspaceMcpServerIds: ["server-1"],
      allowedSkillSlugs: ["calendar", "custom:research"],
      model: "anthropic/claude-opus-4-1",
    });

    expect(result).toEqual({
      generationId: "gen-coworker",
      conversationId: "conv-coworker",
    });
    expect(enqueueGenerationRunMock).toHaveBeenCalledWith("gen-coworker", "coworker", {
      traceId: "trace-1",
    });
    expect(insertedValues()[0]).toEqual(
      expect.objectContaining({
        userId: "user-1",
        title: "Create a weekly report",
        type: "coworker",
        model: "anthropic/claude-opus-4-1",
        authSource: "shared",
        autoApprove: true,
      }),
    );
    expect(insertedGenerationValues().executionPolicy).toEqual(
      expect.objectContaining({
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: ["custom-slug"],
        allowedWorkspaceMcpServerIds: ["server-1"],
        allowedSkillSlugs: ["calendar", "custom:research"],
        autoApprove: true,
        selectedPlatformSkillSlugs: ["platform:calendar"],
      }),
    );
  });

  it("rejects inaccessible saved Coworker models before a Generation starts", async () => {
    checkModelAccessForUserMock.mockResolvedValueOnce({
      allowed: false,
      reason: "openai_not_connected",
      userMessage:
        "This ChatGPT model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    });

    await expect(
      createTurnIntake().startCoworkerGeneration({
        coworkerId: "wf-1",
        coworkerRunId: "wf-run-1",
        content: "Create a weekly report",
        userId: "user-1",
        autoApprove: true,
        allowedIntegrations: ["github"],
        model: "openai/gpt-5.4",
      }),
    ).rejects.toThrow(
      "This ChatGPT model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    );
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(enqueueGenerationRunMock).not.toHaveBeenCalled();
  });
});
