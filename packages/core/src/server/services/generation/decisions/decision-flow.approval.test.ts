import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  coworkerRunFindFirstMock,
  generationFindFirstMock,
  getInterruptMock,
  getPendingInterruptForGenerationMock,
  findPendingInterruptByToolUseIdMock,
  interruptStore,
  markInterruptAppliedMock,
  projectInterruptEventMock,
  refreshInterruptExpiryMock,
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
    coworkerRunFindFirstMock: vi.fn(),
    generationFindFirstMock: vi.fn(),
    getInterruptMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    getPendingInterruptForGenerationMock: vi.fn(async () => null),
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
    interruptStore: store,
    markInterruptAppliedMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    projectInterruptEventMock: projectInterruptEvent,
    refreshInterruptExpiryMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
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
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
    },
  },
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    findPendingInterruptByToolUseId: findPendingInterruptByToolUseIdMock,
    getInterrupt: getInterruptMock,
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
    markInterruptApplied: markInterruptAppliedMock,
    projectInterruptEvent: projectInterruptEventMock,
    refreshInterruptExpiry: refreshInterruptExpiryMock,
    resolveInterrupt: resolveInterruptMock,
  },
}));

import { DecisionFlow } from "./decision-flow";

describe("DecisionFlow approval decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptStore.clear();
    generationFindFirstMock.mockResolvedValue(null);
    coworkerRunFindFirstMock.mockResolvedValue(null);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
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

  function createPluginWriteInterrupt(overrides: Record<string, unknown> = {}) {
    const interrupt = {
      id: "interrupt-tool-1",
      generationId: "gen-1",
      runtimeId: "runtime-1",
      conversationId: "conv-1",
      turnSeq: 1,
      kind: "plugin_write",
      status: "pending",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send",
        toolInput: { command: "slack send" },
      },
      provider: "plugin",
      providerRequestId: "plugin-request-1",
      providerToolUseId: "tool-1",
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

  it("stores an approval content part, resolves the interrupt, and resumes an active Generation", async () => {
    const lifecycleStore = createLifecycleStore();
    const activeCtx = {
      id: "gen-1",
      conversationId: "conv-1",
      contentParts: [],
      runtimeTools: new Map(),
    };
    const onPluginApprovalResolved = vi.fn(async () => undefined);
    const touchConversationLastUserVisibleAction = vi.fn(async () => undefined);
    createPluginWriteInterrupt();
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      conversationId: "conv-1",
      status: "awaiting_approval",
      contentParts: [],
      remainingRunMs: 120_000,
      conversation: {
        id: "conv-1",
        userId: "user-1",
        autoApprove: false,
      },
    });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () => activeCtx as never,
      onPluginApprovalResolved,
      touchConversationLastUserVisibleAction,
    });

    await expect(
      flow.submitApproval({
        generationId: "gen-1",
        toolUseId: "tool-1",
        decision: "approve",
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    const approvalPart = expect.objectContaining({
      type: "approval",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      tool_input: { command: "slack send" },
      integration: "slack",
      operation: "send",
      command: "slack send",
      status: "approved",
    });
    expect(activeCtx.contentParts).toEqual([approvalPart]);
    expect(lifecycleStore.persistDecisionContentParts).toHaveBeenCalledWith({
      generationId: "gen-1",
      contentParts: [approvalPart],
    });
    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-tool-1",
      status: "accepted",
      responsePayload: undefined,
      resolvedByUserId: "user-1",
    });
    expect(lifecycleStore.resumeAfterDecision).toHaveBeenCalledWith({
      generationId: "gen-1",
      conversationId: "conv-1",
      coworkerRunId: undefined,
      contentParts: [approvalPart],
      clearPendingApproval: true,
      clearPendingAuth: true,
    });
    expect(touchConversationLastUserVisibleAction).toHaveBeenCalledWith("conv-1");
    expect(onPluginApprovalResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        decision: "allow",
        event: expect.objectContaining({
          type: "interrupt_resolved",
          interruptId: "interrupt-tool-1",
          status: "accepted",
        }),
      }),
    );
  });

  it("enqueues detached approval resolution as a suspended interrupt resume", async () => {
    const lifecycleStore = createLifecycleStore();
    const enqueueResolvedInterruptResume = vi.fn(async () => undefined);
    createPluginWriteInterrupt({
      id: "interrupt-detached-approval",
      generationId: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      kind: "runtime_permission",
      provider: "runtime",
      providerRequestId: "permission-request-1",
      providerToolUseId: "tool-detached-approval",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        command: "external_directory",
        toolInput: { permission: "external_directory" },
      },
    });
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      status: "awaiting_approval",
      contentParts: null,
      remainingRunMs: 222_000,
      conversation: {
        id: "conv-detached-approval",
        userId: "user-1",
        autoApprove: false,
      },
    });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () => null,
      enqueueResolvedInterruptResume,
    });

    await expect(
      flow.submitApproval({
        generationId: "gen-detached-approval",
        toolUseId: "tool-detached-approval",
        decision: "approve",
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-detached-approval",
        status: "accepted",
        resolvedByUserId: "user-1",
      }),
    );
    expect(enqueueResolvedInterruptResume).toHaveBeenCalledWith({
      generationId: "gen-detached-approval",
      conversationId: "conv-detached-approval",
      interrupt: expect.objectContaining({
        id: "interrupt-detached-approval",
        status: "accepted",
      }),
      runType: "chat",
      coworkerRunId: undefined,
      remainingRunMs: 222_000,
    });
    expect(lifecycleStore.resumeAfterDecision).not.toHaveBeenCalled();
  });

  it("enqueues a durable runtime-question resume when persisted runtime metadata still looks active", async () => {
    const lifecycleStore = createLifecycleStore();
    const enqueueResolvedInterruptResume = vi.fn(async () => undefined);
    createPluginWriteInterrupt({
      id: "interrupt-hot-runtime-approval",
      generationId: "gen-hot-runtime-approval",
      conversationId: "conv-hot-runtime-approval",
      kind: "runtime_question",
      provider: "runtime",
      providerRequestId: "question-request-hot-runtime",
      providerToolUseId: "tool-hot-runtime-approval",
      display: {
        title: "Question",
        integration: "bap",
        operation: "question",
        command: "Choose one",
        toolInput: {
          questions: [{ header: "Pick", question: "Choose one", options: [] }],
        },
      },
    });
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-hot-runtime-approval",
      conversationId: "conv-hot-runtime-approval",
      status: "running",
      runtimeId: "runtime-hot-approval",
      sandboxId: "sandbox-hot-approval",
      contentParts: null,
      remainingRunMs: 180_000,
      conversation: {
        id: "conv-hot-runtime-approval",
        userId: "user-1",
        autoApprove: false,
      },
    });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () => null,
      enqueueResolvedInterruptResume,
    });

    await expect(
      flow.submitApproval({
        generationId: "gen-hot-runtime-approval",
        toolUseId: "tool-hot-runtime-approval",
        decision: "approve",
        userId: "user-1",
        questionAnswers: [["Work project"]],
      }),
    ).resolves.toBe(true);

    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-hot-runtime-approval",
      status: "accepted",
      responsePayload: { questionAnswers: [["Work project"]] },
      resolvedByUserId: "user-1",
    });
    expect(enqueueResolvedInterruptResume).toHaveBeenCalledWith({
      generationId: "gen-hot-runtime-approval",
      conversationId: "conv-hot-runtime-approval",
      interrupt: expect.objectContaining({
        id: "interrupt-hot-runtime-approval",
        status: "accepted",
        responsePayload: { questionAnswers: [["Work project"]] },
      }),
      runType: "chat",
      coworkerRunId: undefined,
      remainingRunMs: 180_000,
    });
    expect(lifecycleStore.resumeAfterDecision).not.toHaveBeenCalled();
  });

  it("handles approval guard paths for missing, unauthorized, and mismatched requests", async () => {
    const flow = new DecisionFlow({
      lifecycleStore: createLifecycleStore() as never,
      getActiveRuntimeContext: () => null,
    });

    await expect(
      flow.submitApproval({
        generationId: "missing",
        toolUseId: "tool-1",
        decision: "approve",
        userId: "user-1",
      }),
    ).resolves.toBe(false);

    createPluginWriteInterrupt();
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      conversationId: "conv-1",
      status: "awaiting_approval",
      contentParts: [],
      conversation: {
        id: "conv-1",
        userId: "user-1",
        autoApprove: false,
      },
    });
    await expect(
      flow.submitApproval({
        generationId: "gen-1",
        toolUseId: "tool-1",
        decision: "approve",
        userId: "other-user",
      }),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      conversationId: "conv-1",
      status: "awaiting_approval",
      contentParts: [],
      conversation: {
        id: "conv-1",
        userId: "user-1",
        autoApprove: false,
      },
    });
    await expect(
      flow.submitApproval({
        generationId: "gen-1",
        toolUseId: "tool-does-not-match",
        decision: "approve",
        userId: "user-1",
      }),
    ).resolves.toBe(false);
  });

  it("resumes a paused Generation by updating lifecycle state and enqueueing chat work", async () => {
    const lifecycleStore = createLifecycleStore();
    const enqueueGenerationRun = vi.fn(async () => undefined);
    const enqueueGenerationTimeout = vi.fn(async () => undefined);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-paused",
      conversationId: "conv-paused",
      status: "paused",
      executionPolicy: { autoApprove: false, allowSnapshotRestoreOnRun: false },
      conversation: {
        id: "conv-paused",
        userId: "user-1",
        autoApprove: false,
      },
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce(null);
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      enqueueGenerationRun,
      enqueueGenerationTimeout,
      getExecutionPolicy: (record: any) => record.executionPolicy,
    });

    await expect(flow.resumeGeneration("gen-paused", "user-1")).resolves.toBe(true);

    expect(lifecycleStore.resumeGenerationRequest).toHaveBeenCalledWith({
      generationId: "gen-paused",
      conversationId: "conv-paused",
      coworkerRunId: undefined,
      status: "running",
      executionPolicy: {
        autoApprove: false,
        allowSnapshotRestoreOnRun: true,
      },
    });
    expect(enqueueGenerationRun).toHaveBeenCalledWith("gen-paused", "chat");
    expect(enqueueGenerationTimeout).not.toHaveBeenCalled();
  });

  it("returns deny immediately when approval wait cannot create a pending request", async () => {
    const flow = new DecisionFlow({
      lifecycleStore: createLifecycleStore() as never,
    });

    await expect(
      flow.waitForApproval("missing", {
        toolInput: { command: "gh issue list" },
        integration: "github",
        operation: "read",
        command: "gh issue list",
      }),
    ).resolves.toBe("deny");
  });

  it("applies a hot runtime permission decision through the live runtime sender", async () => {
    const lifecycleStore = createLifecycleStore();
    interruptStore.set("interrupt-approval", {
      id: "interrupt-approval",
      generationId: "gen-approval",
      runtimeId: "runtime-1",
      conversationId: "conv-approval",
      turnSeq: 1,
      kind: "runtime_permission",
      status: "pending",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        command: "external_directory",
        toolInput: { permission: "external_directory" },
      },
      provider: "runtime",
      providerRequestId: "request-1",
      providerToolUseId: "tool-1",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: null,
      requestedByUserId: null,
      resolvedByUserId: null,
    });
    const ctx = {
      id: "gen-approval",
      conversationId: "conv-approval",
      contentParts: [],
      runtimeTools: new Map(),
      status: "awaiting_approval",
      currentInterruptId: "interrupt-approval",
    };
    const sendRuntimeDecision = vi.fn(async () => undefined);
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
    });

    await expect(
      flow.applyRuntimeApprovalDecision({
        ctx,
        interruptId: "interrupt-approval",
        decision: "allow",
        sendRuntimeDecision,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "interrupt-approval", status: "accepted" }));

    expect(sendRuntimeDecision).toHaveBeenCalledWith({
      kind: "permission",
      requestId: "request-1",
      reply: "always",
    });
    expect(ctx.contentParts).toEqual([
      expect.objectContaining({
        type: "approval",
        tool_use_id: "tool-1",
        status: "approved",
        integration: "opencode",
        operation: "permission",
      }),
    ]);
    expect(ctx.status).toBe("running");
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(lifecycleStore.resumeAfterDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-approval",
        conversationId: "conv-approval",
        clearPendingApproval: true,
      }),
    );
  });

  it("applies a resolved runtime permission during resume and clears the resume interrupt", async () => {
    const lifecycleStore = createLifecycleStore();
    interruptStore.set("interrupt-resume-approval", {
      id: "interrupt-resume-approval",
      generationId: "gen-resume-approval",
      runtimeId: "runtime-1",
      conversationId: "conv-resume-approval",
      turnSeq: 3,
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
      providerRequestId: "request-resume-approval",
      providerToolUseId: "tool-resume-approval",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
    });
    const ctx = {
      id: "gen-resume-approval",
      conversationId: "conv-resume-approval",
      contentParts: [],
      runtimeTools: new Map(),
      status: "awaiting_approval",
      currentInterruptId: "interrupt-resume-approval",
      resumeInterruptId: "interrupt-resume-approval",
    };
    const sendRuntimeDecision = vi.fn(async () => undefined);
    const broadcastResolvedEvent = vi.fn();
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
    });

    await expect(
      flow.applyResolvedInterruptToRuntime({
        ctx,
        interruptId: "interrupt-resume-approval",
        sendRuntimeDecision,
        broadcastResolvedEvent,
      }),
    ).resolves.toBeUndefined();

    expect(sendRuntimeDecision).toHaveBeenCalledWith({
      kind: "permission",
      requestId: "request-resume-approval",
      reply: "always",
    });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith("interrupt-resume-approval");
    expect(ctx.contentParts).toEqual([
      expect.objectContaining({
        type: "approval",
        tool_use_id: "tool-resume-approval",
        status: "approved",
        integration: "opencode",
        operation: "permission",
      }),
    ]);
    expect(ctx.resumeInterruptId).toBeNull();
    expect(ctx.currentInterruptId).toBeUndefined();
    expect(lifecycleStore.clearAppliedResumeInterrupt).toHaveBeenCalledWith(
      "gen-resume-approval",
    );
    expect(broadcastResolvedEvent).not.toHaveBeenCalled();
  });
});
