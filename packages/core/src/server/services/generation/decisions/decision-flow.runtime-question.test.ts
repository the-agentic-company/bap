import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createInterruptMock,
  findPendingInterruptByToolUseIdMock,
  generationFindFirstMock,
  getInterruptMock,
  interruptStore,
  markInterruptAppliedMock,
  projectInterruptEventMock,
  resolveInterruptMock,
} = vi.hoisted(() => {
  const store = new Map<string, any>();
  const projectInterruptEvent = vi.fn((interrupt: any) => ({
    interruptId: interrupt.id,
    generationId: interrupt.generationId,
    runtimeId: interrupt.runtimeId,
    conversationId: interrupt.conversationId,
    turnSeq: interrupt.turnSeq,
    kind: interrupt.kind,
    status: interrupt.status,
    providerToolUseId: interrupt.providerToolUseId,
    display: interrupt.display,
    responsePayload: interrupt.responsePayload ?? undefined,
  }));

  return {
    createInterruptMock: vi.fn(async (input: any) => {
      const interrupt = {
        id: `interrupt-${input.providerToolUseId}`,
        generationId: input.generationId,
        runtimeId: input.runtimeId,
        conversationId: input.conversationId,
        turnSeq: input.turnSeq,
        kind: input.kind,
        status: "pending",
        display: input.display,
        provider: input.provider,
        providerRequestId: input.providerRequestId ?? null,
        providerToolUseId: input.providerToolUseId,
        responsePayload: undefined,
        requestedAt: new Date("2026-03-11T15:00:00.000Z"),
        expiresAt: input.expiresAt ?? null,
        resolvedAt: null,
        requestedByUserId: input.requestedByUserId ?? null,
        resolvedByUserId: null,
      };
      store.set(interrupt.id, interrupt);
      return interrupt;
    }),
    findPendingInterruptByToolUseIdMock: vi.fn(async (params: any) => {
      return (
        [...store.values()].find(
          (interrupt) =>
            interrupt.generationId === params.generationId &&
            interrupt.providerToolUseId === params.providerToolUseId &&
            interrupt.status === "pending",
        ) ?? null
      );
    }),
    generationFindFirstMock: vi.fn(),
    getInterruptMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    interruptStore: store,
    markInterruptAppliedMock: vi.fn(async (interruptId: string) => {
      const current = store.get(interruptId);
      if (!current) {
        return null;
      }
      const updated = { ...current, appliedAt: new Date("2026-03-11T15:02:00.000Z") };
      store.set(interruptId, updated);
      return updated;
    }),
    projectInterruptEventMock: projectInterruptEvent,
    resolveInterruptMock: vi.fn(async (params: any) => {
      const current = store.get(params.interruptId);
      if (!current) {
        return null;
      }
      const resolved = {
        ...current,
        status: params.status,
        responsePayload: params.responsePayload,
        resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
        resolvedByUserId: params.resolvedByUserId ?? null,
      };
      store.set(params.interruptId, resolved);
      return resolved;
    }),
  };
});

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      coworkerRun: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  },
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    createInterrupt: createInterruptMock,
    findPendingInterruptByToolUseId: findPendingInterruptByToolUseIdMock,
    getInterrupt: getInterruptMock,
    markInterruptApplied: markInterruptAppliedMock,
    projectInterruptEvent: projectInterruptEventMock,
    resolveInterrupt: resolveInterruptMock,
  },
}));

import { DecisionFlow } from "./decision-flow";

describe("DecisionFlow runtime-question decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptStore.clear();
    generationFindFirstMock.mockResolvedValue(null);
  });

  function createLifecycleStore() {
    return {
      persistDecisionContentParts: vi.fn(async () => undefined),
      resumeAfterDecision: vi.fn(async () => undefined),
      cancelAfterAuthFailure: vi.fn(async () => undefined),
      markCoworkerRunAwaitingAuth: vi.fn(async () => undefined),
      markCoworkerRunAwaitingApproval: vi.fn(async () => undefined),
      clearAppliedResumeInterrupt: vi.fn(async () => undefined),
      resumeGenerationRequest: vi.fn(async () => undefined),
    };
  }

  function createRuntimeQuestionInterrupt(overrides: Record<string, unknown> = {}) {
    const interrupt = {
      id: "interrupt-question",
      generationId: "gen-question",
      runtimeId: "runtime-question",
      conversationId: "conv-question",
      turnSeq: 3,
      kind: "runtime_question",
      status: "pending",
      display: {
        title: "question",
        integration: "bap",
        operation: "question",
        command: "Question: Choose one [Alpha | Beta]",
        toolInput: {
          questions: [
            {
              header: "Pick",
              question: "Choose one",
              options: [
                { label: "Alpha", description: "Alpha" },
                { label: "Beta", description: "Beta" },
              ],
            },
          ],
        },
        questionSpec: {
          questions: [
            {
              header: "Pick",
              question: "Choose one",
              options: [
                { label: "Alpha", description: "Alpha" },
                { label: "Beta", description: "Beta" },
              ],
            },
          ],
        },
      },
      provider: "runtime",
      providerRequestId: "question-request-1",
      providerToolUseId: "question-tool-1",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
      ...overrides,
    };
    interruptStore.set(interrupt.id, interrupt);
    return interrupt;
  }

  it("submits frontend question answers after trimming empty selections", async () => {
    const lifecycleStore = createLifecycleStore();
    const activeCtx = {
      id: "gen-question",
      conversationId: "conv-question",
      contentParts: [],
      runtimeTools: new Map(),
    };
    createRuntimeQuestionInterrupt({
      providerToolUseId: "question-tool-frontend",
    });
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-question",
      conversationId: "conv-question",
      status: "awaiting_approval",
      contentParts: [],
      conversation: {
        id: "conv-question",
        userId: "user-1",
        autoApprove: false,
      },
    });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () => activeCtx as never,
    });

    await expect(
      flow.submitApproval({
        generationId: "gen-question",
        toolUseId: "question-tool-frontend",
        decision: "approve",
        userId: "user-1",
        questionAnswers: [["  Coding/Development  ", "   "]],
      }),
    ).resolves.toBe(true);

    expect(activeCtx.contentParts).toEqual([
      expect.objectContaining({
        type: "approval",
        tool_use_id: "question-tool-frontend",
        question_answers: [["Coding/Development"]],
        status: "approved",
      }),
    ]);
    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-question",
      status: "accepted",
      responsePayload: { questionAnswers: [["Coding/Development"]] },
      resolvedByUserId: "user-1",
    });
  });

  it("queues a runtime question as a tool use and rejects it when the hot decision is denied", async () => {
    const lifecycleStore = createLifecycleStore();
    const ctx = {
      id: "gen-question",
      conversationId: "conv-question",
      coworkerRunId: "coworker-run-1",
      runtimeId: "runtime-question",
      runtimeTurnSeq: 3,
      status: "running",
      contentParts: [],
      runtimeTools: new Map(),
    };
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
    });
    vi.spyOn(flow, "waitForRuntimeApprovalDecision").mockResolvedValue({
      decision: "deny",
    });
    const saveProgress = vi.fn(async () => undefined);
    const broadcast = vi.fn();
    const sendRuntimeDecision = vi.fn(async () => undefined);

    await expect(
      flow.handleRuntimeActionableEvent({
        ctx,
        event: {
          type: "question",
          request: {
            id: "question-request-manual",
            sessionId: "session-1",
            questions: [
              {
                header: "Destination",
                question: "Where should this run?",
                options: [{ label: "Slack", description: "Slack" }],
              },
            ],
            tool: {
              messageId: "msg-1",
              callId: "call-1",
            },
          },
        },
        hotWaitMs: 1_000,
        timeoutMs: 30_000,
        saveProgress,
        broadcast,
        parkForInterrupt: vi.fn(async () => undefined),
        sendRuntimeDecision,
      }),
    ).resolves.toEqual({ type: "question" });

    expect(ctx.contentParts).toEqual([
      expect.objectContaining({
        type: "tool_use",
        id: "call-1",
        name: "question",
        integration: "bap",
        operation: "question",
      }),
      expect.objectContaining({
        type: "approval",
        tool_use_id: "call-1",
        status: "denied",
      }),
    ]);
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(createInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-question",
        runtimeId: "runtime-question",
        conversationId: "conv-question",
        turnSeq: 3,
        kind: "runtime_question",
        provider: "runtime",
        providerRequestId: "question-request-manual",
        providerToolUseId: "call-1",
        display: expect.objectContaining({
          title: "question",
          integration: "bap",
          operation: "question",
          command: "Question: Where should this run? [Slack]",
          questionSpec: {
            questions: [
              {
                header: "Destination",
                question: "Where should this run?",
                options: [{ label: "Slack", description: "Slack" }],
                multiple: undefined,
                custom: undefined,
              },
            ],
          },
        }),
      }),
    );
    expect(lifecycleStore.markCoworkerRunAwaitingApproval).toHaveBeenCalledWith("coworker-run-1");
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_use",
        toolName: "question",
        toolUseId: "call-1",
        integration: "bap",
        operation: "question",
      }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "interrupt_pending",
        kind: "runtime_question",
        status: "pending",
      }),
    );
    expect(sendRuntimeDecision).toHaveBeenCalledWith({
      kind: "question",
      requestId: "question-request-manual",
      reject: true,
    });
  });

  it("applies a hot runtime question answer through the live runtime sender", async () => {
    const lifecycleStore = createLifecycleStore();
    createRuntimeQuestionInterrupt();
    const ctx = {
      id: "gen-question",
      conversationId: "conv-question",
      contentParts: [],
      runtimeTools: new Map(),
      status: "awaiting_approval",
      currentInterruptId: "interrupt-question",
    };
    const sendRuntimeDecision = vi.fn(async () => undefined);
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
    });

    await expect(
      flow.applyRuntimeApprovalDecision({
        ctx,
        interruptId: "interrupt-question",
        decision: "allow",
        questionAnswers: [["  Beta  "]],
        sendRuntimeDecision,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "interrupt-question", status: "accepted" }));

    expect(sendRuntimeDecision).toHaveBeenCalledWith({
      kind: "question",
      requestId: "question-request-1",
      answers: [["  Beta  "]],
    });
    expect(ctx.contentParts).toEqual([
      expect.objectContaining({
        type: "approval",
        tool_use_id: "question-tool-1",
        question_answers: [["Beta"]],
        status: "approved",
      }),
    ]);
    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-question",
      status: "accepted",
      responsePayload: { questionAnswers: [["Beta"]] },
    });
    expect(ctx.status).toBe("running");
    expect(ctx.currentInterruptId).toBeUndefined();
  });

  it("applies a resolved runtime question during resume and clears the resume interrupt", async () => {
    const lifecycleStore = createLifecycleStore();
    createRuntimeQuestionInterrupt({
      status: "accepted",
      responsePayload: {
        questionAnswers: [["Beta"]],
      },
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      resolvedByUserId: "user-1",
    });
    const ctx = {
      id: "gen-question",
      conversationId: "conv-question",
      contentParts: [],
      runtimeTools: new Map(),
      status: "awaiting_approval",
      currentInterruptId: "interrupt-question",
      resumeInterruptId: "interrupt-question",
    };
    const sendRuntimeDecision = vi.fn(async () => undefined);
    const broadcastResolvedEvent = vi.fn();
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
    });

    await expect(
      flow.applyResolvedInterruptToRuntime({
        ctx,
        interruptId: "interrupt-question",
        sendRuntimeDecision,
        broadcastResolvedEvent,
      }),
    ).resolves.toBeUndefined();

    expect(sendRuntimeDecision).toHaveBeenCalledWith({
      kind: "question",
      requestId: "question-request-1",
      answers: [["Beta"]],
    });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith("interrupt-question");
    expect(ctx.resumeInterruptId).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(lifecycleStore.clearAppliedResumeInterrupt).toHaveBeenCalledWith("gen-question");
    expect(broadcastResolvedEvent).not.toHaveBeenCalled();
  });

  it("builds a resumed runtime-question continuation prompt with the selected answers", () => {
    const flow = new DecisionFlow({
      lifecycleStore: createLifecycleStore() as never,
    });
    const interrupt = createRuntimeQuestionInterrupt({
      status: "accepted",
      responsePayload: {
        questionAnswers: [[" Beta ", "Gamma"]],
      },
    });

    expect(flow.buildResumedRuntimeQuestionContinuationPrompt(interrupt as never)).toEqual([
      {
        type: "text",
        text: "Continue the interrupted assistant turn. The pending question has been answered. The resolved answer was: Beta, Gamma.",
      },
    ]);
  });
});
