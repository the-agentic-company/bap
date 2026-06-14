import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateMock,
  insertMock,
  insertValuesMock,
  insertReturningMock,
  updateSetCalls,
  updateWhereMock,
  clearActiveGenerationMock,
} = vi.hoisted(() => {
  const updateSetCalls: unknown[] = [];
  const updateWhereMock = vi.fn();
  const updateMock = vi.fn(() => ({
    set: vi.fn((values: unknown) => {
      updateSetCalls.push(values);
      return { where: updateWhereMock };
    }),
  }));
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({
    returning: insertReturningMock,
  }));
  const insertMock = vi.fn(() => ({
    values: insertValuesMock,
  }));
  return {
    updateMock,
    insertMock,
    insertValuesMock,
    insertReturningMock,
    updateSetCalls,
    updateWhereMock,
    clearActiveGenerationMock: vi.fn(),
  };
});

vi.mock("@bap/db/client", () => ({
  db: {
    update: updateMock,
    insert: insertMock,
  },
}));

vi.mock("../../../billing/service", () => ({
  trackGenerationBilling: vi.fn(async () => undefined),
}));

vi.mock("../../failure-alert-service", () => ({
  captureGenerationFailureAlert: vi.fn(async () => undefined),
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    cancelInterruptsForGeneration: vi.fn(async () => undefined),
  },
}));

vi.mock("../../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    clearActiveGeneration: clearActiveGenerationMock,
    updateRuntimeSession: vi.fn(async () => undefined),
  },
}));

vi.mock("../../../utils/generate-title", () => ({
  generateConversationTitle: vi.fn(async () => null),
}));

vi.mock("./canonical-generation-events", () => ({
  emitGenerationTerminalCanonicalEvent: vi.fn(async () => undefined),
}));

import { GenerationLifecycleStore } from "./lifecycle-store";

describe("GenerationLifecycleStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    insertReturningMock.mockResolvedValue([{ id: "msg-assistant-1", content: "Interrupted by user" }]);
  });

  it("persists resolved interrupt resumes as running and clears paused waiting state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T15:00:00.000Z"));
    try {
      const store = new GenerationLifecycleStore();
      const deadlineAt = new Date("2026-03-11T15:03:42.000Z");

      await store.resumeResolvedInterrupt({
        generationId: "gen-detached-approval",
        conversationId: "conv-detached-approval",
        coworkerRunId: "coworker-run-1",
        interruptId: "interrupt-detached-approval",
        deadlineAt,
      });

      expect(updateSetCalls).toContainEqual({
        status: "running",
        resumeInterruptId: "interrupt-detached-approval",
        deadlineAt,
        suspendedAt: null,
        isPaused: false,
        pendingApproval: null,
        pendingAuth: null,
      });
      expect(updateSetCalls).toContainEqual({
        generationStatus: "generating",
        sandboxLastUserVisibleActionAt: new Date("2026-03-11T15:00:00.000Z"),
      });
      expect(updateSetCalls).toContainEqual({ status: "running" });
      expect(updateWhereMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists a cancelled assistant message with the interruption marker content part", async () => {
    const store = new GenerationLifecycleStore();

    await store.finishTurn({
      generationId: "gen-cancelled",
      conversationId: "conv-cancelled",
      runtimeId: "runtime-1",
      sessionId: "session-1",
      status: "cancelled",
      contentParts: [{ type: "text", text: "partial answer" }],
      assistantContent: "",
      lastRuntimeProgressAt: new Date("2026-03-11T15:00:00.000Z"),
      recoveryAttempts: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      remainingRunMs: 0,
      model: "openai/gpt-5",
      startedAt: new Date("2026-03-11T14:59:00.000Z"),
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-cancelled",
        role: "assistant",
        content: "Interrupted by user",
        contentParts: [
          { type: "text", text: "partial answer" },
          { type: "system", content: "Interrupted by user" },
        ],
      }),
    );
    expect(clearActiveGenerationMock).toHaveBeenCalledWith({
      runtimeId: "runtime-1",
      generationId: "gen-cancelled",
    });
  });
});
