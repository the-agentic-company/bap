import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  generationFindFirstMock,
  messageFindFirstMock,
  getLatestGenerationStreamEnvelopeMock,
  generationStreamExistsMock,
  getLatestGenerationStreamCursorMock,
  publishGenerationStreamEventMock,
  readGenerationStreamAfterMock,
  getPendingInterruptForGenerationMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  getLatestGenerationStreamEnvelopeMock: vi.fn(),
  generationStreamExistsMock: vi.fn(),
  getLatestGenerationStreamCursorMock: vi.fn(),
  publishGenerationStreamEventMock: vi.fn(),
  readGenerationStreamAfterMock: vi.fn(),
  getPendingInterruptForGenerationMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      message: { findFirst: messageFindFirstMock },
    },
    insert: vi.fn(() => ({ values: vi.fn() })),
  },
}));

vi.mock("../../../redis/generation-event-bus", () => ({
  generationStreamExists: generationStreamExistsMock,
  getLatestGenerationStreamEnvelope: getLatestGenerationStreamEnvelopeMock,
  getLatestGenerationStreamCursor: getLatestGenerationStreamCursorMock,
  publishGenerationStreamEvent: publishGenerationStreamEventMock,
  readGenerationStreamAfter: readGenerationStreamAfterMock,
}));

vi.mock("../../../utils/observability", () => ({
  createTraceId: vi.fn(() => "trace-stream"),
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
  },
}));

import { GenerationEventLog } from "./generation-event-log";

const originalNodeEnv = process.env.NODE_ENV;

async function collectEvents(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe("GenerationEventLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    generationStreamExistsMock.mockResolvedValue(false);
    getLatestGenerationStreamEnvelopeMock.mockResolvedValue(null);
    getLatestGenerationStreamCursorMock.mockResolvedValue(null);
    publishGenerationStreamEventMock.mockResolvedValue("1-1");
    readGenerationStreamAfterMock.mockResolvedValue([]);
    messageFindFirstMock.mockResolvedValue(null);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("subscribes from database terminal state and replays terminal events", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-db",
      conversationId: "conv-db",
      runtimeId: "runtime-1",
      status: "completed",
      messageId: "msg-final",
      inputTokens: 7,
      outputTokens: 13,
      errorMessage: null,
      conversation: {
        userId: "user-1",
        type: "chat",
      },
      contentParts: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
          integration: "slack",
          operation: "send",
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
        { type: "thinking", id: "think-1", content: "..." },
      ],
    });

    const eventLog = new GenerationEventLog({
      projectInterruptPendingEvent: vi.fn(),
    });

    await expect(
      collectEvents(eventLog.subscribe({ generationId: "gen-db", userId: "user-1" })),
    ).resolves.toEqual([
      { type: "text", content: "hi" },
      {
        type: "tool_use",
        toolName: "bash",
        toolInput: { command: "echo hi" },
        toolUseId: "tool-1",
        integration: "slack",
        operation: "send",
      },
      {
        type: "tool_result",
        toolName: "bash",
        result: "ok",
        toolUseId: "tool-1",
      },
      { type: "thinking", content: "...", thinkingId: "think-1" },
      { type: "status_change", status: "completed" },
      {
        type: "done",
        generationId: "gen-db",
        conversationId: "conv-db",
        messageId: "msg-final",
        usage: { inputTokens: 7, outputTokens: 13, totalCostUsd: 0 },
      },
    ]);
  });

  it("recovers paused run deadline as a parked status event", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-paused",
      conversationId: "conv-paused",
      runtimeId: "runtime-paused",
      status: "paused",
      completionReason: "run_deadline",
      sandboxProvider: "daytona",
      sandboxId: null,
      messageId: null,
      inputTokens: 0,
      outputTokens: 0,
      errorMessage: null,
      conversation: {
        userId: "user-1",
        type: "coworker",
      },
      contentParts: [{ type: "text", text: "partial" }],
    });

    const eventLog = new GenerationEventLog({
      projectInterruptPendingEvent: vi.fn(),
    });

    await expect(
      collectEvents(eventLog.subscribe({ generationId: "gen-paused", userId: "user-1" })),
    ).resolves.toEqual([
      { type: "text", content: "partial" },
      {
        type: "status_change",
        status: "run_deadline_parked",
        metadata: {
          runtimeId: "runtime-paused",
          sandboxProvider: "daytona",
          sandboxId: undefined,
          releasedSandboxId: undefined,
        },
      },
    ]);
  });

  it("replays pending approval state while a Generation is waiting", async () => {
    const projectInterruptPendingEvent = vi.fn((interrupt) => ({
      type: "interrupt_pending",
      interruptId: interrupt.id,
      generationId: interrupt.generationId,
      conversationId: interrupt.conversationId,
      kind: interrupt.kind,
      status: interrupt.status,
      providerToolUseId: interrupt.providerToolUseId,
      display: interrupt.display,
    }));
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: "gen-1",
        conversationId: "conv-1",
        runtimeId: "runtime-1",
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      })
      .mockResolvedValueOnce({
        id: "gen-1",
        conversationId: "conv-1",
        runtimeId: "runtime-1",
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      })
      .mockResolvedValueOnce({
        id: "gen-1",
        conversationId: "conv-1",
        runtimeId: "runtime-1",
        status: "cancelled",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      });
    getPendingInterruptForGenerationMock.mockResolvedValueOnce({
      id: "interrupt-tool-pending",
      generationId: "gen-1",
      conversationId: "conv-1",
      kind: "plugin_write",
      status: "pending",
      providerToolUseId: "tool-pending",
      display: {
        title: "Bash",
        toolInput: { command: "rm -rf /tmp/x" },
        integration: "slack",
        operation: "send",
        command: "rm -rf /tmp/x",
      },
    });

    const eventLog = new GenerationEventLog({ projectInterruptPendingEvent });

    await expect(
      collectEvents(eventLog.subscribe({ generationId: "gen-1", userId: "user-1" })),
    ).resolves.toEqual([
      { type: "status_change", status: "awaiting_approval" },
      {
        type: "interrupt_pending",
        interruptId: "interrupt-tool-pending",
        generationId: "gen-1",
        conversationId: "conv-1",
        kind: "plugin_write",
        status: "pending",
        providerToolUseId: "tool-pending",
        display: {
          title: "Bash",
          toolInput: { command: "rm -rf /tmp/x" },
          integration: "slack",
          operation: "send",
          command: "rm -rf /tmp/x",
        },
      },
      { type: "status_change", status: "cancelled" },
      {
        type: "cancelled",
        generationId: "gen-1",
        conversationId: "conv-1",
        messageId: undefined,
      },
    ]);
  });

  it("emits pending approval even when a Redis stream already exists", async () => {
    process.env.NODE_ENV = "development";
    const projectInterruptPendingEvent = vi.fn((interrupt) => ({
      type: "interrupt_pending",
      interruptId: interrupt.id,
      generationId: interrupt.generationId,
      conversationId: interrupt.conversationId,
      kind: interrupt.kind,
      status: interrupt.status,
      providerToolUseId: interrupt.providerToolUseId,
      display: interrupt.display,
    }));
    generationFindFirstMock.mockResolvedValue({
      id: "gen-stream-present",
      conversationId: "conv-stream-present",
      runtimeId: "runtime-1",
      status: "awaiting_approval",
      messageId: null,
      inputTokens: 0,
      outputTokens: 0,
      errorMessage: null,
      conversation: { userId: "user-1", type: "chat" },
      contentParts: [{ type: "text", text: "persisted text not replayed while Redis exists" }],
    });
    generationStreamExistsMock.mockResolvedValue(true);
    getPendingInterruptForGenerationMock.mockResolvedValue({
      id: "interrupt-stream-present",
      generationId: "gen-stream-present",
      conversationId: "conv-stream-present",
      kind: "plugin_write",
      status: "pending",
      providerToolUseId: "tool-stream-present",
      display: {
        title: "Bash",
        toolInput: { command: "gh issue edit" },
        integration: "github",
        operation: "write",
        command: "gh issue edit",
      },
    });
    const eventLog = new GenerationEventLog({ projectInterruptPendingEvent });
    const stream = eventLog.subscribe({ generationId: "gen-stream-present", userId: "user-1" });

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: "status_change", status: "awaiting_approval" },
    });
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: {
        type: "interrupt_pending",
        interruptId: "interrupt-stream-present",
        generationId: "gen-stream-present",
        conversationId: "conv-stream-present",
        kind: "plugin_write",
        status: "pending",
        providerToolUseId: "tool-stream-present",
        display: {
          title: "Bash",
          toolInput: { command: "gh issue edit" },
          integration: "github",
          operation: "write",
          command: "gh issue edit",
        },
      },
    });
    expect(generationStreamExistsMock).toHaveBeenCalledWith("gen-stream-present");
    expect(projectInterruptPendingEvent).toHaveBeenCalledTimes(1);
    await stream.return(undefined);
  });

  it("replays pending auth state while a Generation is waiting", async () => {
    const projectInterruptPendingEvent = vi.fn((interrupt) => ({
      type: "interrupt_pending",
      interruptId: interrupt.id,
      generationId: interrupt.generationId,
      conversationId: interrupt.conversationId,
      kind: interrupt.kind,
      status: interrupt.status,
      providerToolUseId: interrupt.providerToolUseId,
      display: interrupt.display,
    }));
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: "gen-auth",
        conversationId: "conv-auth",
        runtimeId: "runtime-1",
        status: "awaiting_auth",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      })
      .mockResolvedValueOnce({
        id: "gen-auth",
        conversationId: "conv-auth",
        runtimeId: "runtime-1",
        status: "awaiting_auth",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      })
      .mockResolvedValueOnce({
        id: "gen-auth",
        conversationId: "conv-auth",
        runtimeId: "runtime-1",
        status: "cancelled",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: { userId: "user-1", type: "chat" },
        contentParts: [],
      });
    getPendingInterruptForGenerationMock.mockResolvedValueOnce({
      id: "interrupt-auth-pending",
      generationId: "gen-auth",
      conversationId: "conv-auth",
      kind: "auth",
      status: "pending",
      providerToolUseId: "auth-notion",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["notion"] },
      },
    });
    const eventLog = new GenerationEventLog({ projectInterruptPendingEvent });

    await expect(
      collectEvents(eventLog.subscribe({ generationId: "gen-auth", userId: "user-1" })),
    ).resolves.toEqual([
      { type: "status_change", status: "awaiting_auth" },
      {
        type: "interrupt_pending",
        interruptId: "interrupt-auth-pending",
        generationId: "gen-auth",
        conversationId: "conv-auth",
        kind: "auth",
        status: "pending",
        providerToolUseId: "auth-notion",
        display: {
          title: "Connection Required",
          authSpec: { integrations: ["notion"] },
        },
      },
      { type: "status_change", status: "cancelled" },
      {
        type: "cancelled",
        generationId: "gen-auth",
        conversationId: "conv-auth",
        messageId: undefined,
      },
    ]);
  });

  it("publishes detached pending approval events with the next stream sequence", async () => {
    getLatestGenerationStreamEnvelopeMock.mockResolvedValue({
      envelope: {
        generationId: "gen-detached-stream",
        conversationId: "conv-detached-stream",
        sequence: 4,
        eventType: "text",
        payload: { type: "text", content: "previous" },
        createdAtMs: Date.now() - 100,
      },
    });
    const eventLog = new GenerationEventLog({ projectInterruptPendingEvent: vi.fn() });

    await eventLog.publishDetached({
      generationId: "gen-detached-stream",
      conversationId: "conv-detached-stream",
      event: {
        type: "interrupt_pending",
        interruptId: "interrupt-detached-stream",
        generationId: "gen-detached-stream",
        conversationId: "conv-detached-stream",
        kind: "plugin_write",
        status: "pending",
        providerToolUseId: "tool-detached-stream",
        display: {
          title: "Bash",
          toolInput: { command: "gh pr merge" },
          integration: "github",
          operation: "write",
          command: "gh pr merge",
        },
      },
    });

    expect(publishGenerationStreamEventMock).toHaveBeenCalledWith(
      "gen-detached-stream",
      expect.objectContaining({
        generationId: "gen-detached-stream",
        conversationId: "conv-detached-stream",
        sequence: 5,
        eventType: "interrupt_pending",
        payload: expect.objectContaining({
          type: "interrupt_pending",
          interruptId: "interrupt-detached-stream",
          providerToolUseId: "tool-detached-stream",
        }),
      }),
    );
  });
});
