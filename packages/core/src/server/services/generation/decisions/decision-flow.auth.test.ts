import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  coworkerRunFindFirstMock,
  createInterruptMock,
  findPendingAuthInterruptByIntegrationMock,
  generationFindFirstMock,
  getInterruptMock,
  getRuntimeMock,
  interruptStore,
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
    coworkerRunFindFirstMock: vi.fn(),
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
    findPendingAuthInterruptByIntegrationMock: vi.fn(async (params: any) => {
      return (
        [...store.values()].find(
          (interrupt) =>
            interrupt.generationId === params.generationId &&
            interrupt.kind === "auth" &&
            interrupt.status === "pending" &&
            interrupt.display.authSpec?.integrations.includes(params.integration),
        ) ?? null
      );
    }),
    generationFindFirstMock: vi.fn(),
    getInterruptMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    getRuntimeMock: vi.fn(),
    interruptStore: store,
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
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
    },
  },
}));

vi.mock("../../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    getRuntime: getRuntimeMock,
  },
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    createInterrupt: createInterruptMock,
    findPendingAuthInterruptByIntegration: findPendingAuthInterruptByIntegrationMock,
    getInterrupt: getInterruptMock,
    projectInterruptEvent: projectInterruptEventMock,
    resolveInterrupt: resolveInterruptMock,
  },
}));

import { DecisionFlow } from "./decision-flow";

describe("DecisionFlow auth decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptStore.clear();
    generationFindFirstMock.mockResolvedValue(null);
    coworkerRunFindFirstMock.mockResolvedValue(null);
    getRuntimeMock.mockResolvedValue(null);
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

  function createAuthInterrupt(overrides: Record<string, unknown> = {}) {
    const interrupt = {
      id: "interrupt-auth-slack",
      generationId: "gen-auth",
      runtimeId: "runtime-1",
      conversationId: "conv-auth",
      turnSeq: 1,
      kind: "auth",
      status: "pending",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["slack"] },
      },
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "auth-slack",
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

  it("accepts an auth result and resumes active persisted Generation state", async () => {
    const lifecycleStore = createLifecycleStore();
    const onAuthResolved = vi.fn(async () => undefined);
    const touchConversationLastUserVisibleAction = vi.fn(async () => undefined);
    createAuthInterrupt();
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-auth",
      conversationId: "conv-auth",
      runtimeId: "runtime-1",
      status: "awaiting_auth",
      conversation: {
        id: "conv-auth",
        userId: "user-1",
        autoApprove: false,
      },
    });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () =>
        ({
          id: "gen-auth",
          conversationId: "conv-auth",
          contentParts: [],
          runtimeTools: new Map(),
        }) as never,
      onAuthResolved,
      touchConversationLastUserVisibleAction,
    });

    await expect(
      flow.submitAuthResult({
        generationId: "gen-auth",
        integration: "slack",
        success: true,
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(resolveInterruptMock).toHaveBeenCalledWith({
      interruptId: "interrupt-auth-slack",
      status: "accepted",
      responsePayload: {
        connectedIntegrations: ["slack"],
        integration: "slack",
      },
      resolvedByUserId: "user-1",
    });
    expect(lifecycleStore.resumeAfterDecision).toHaveBeenCalledWith({
      generationId: "gen-auth",
      conversationId: "conv-auth",
      coworkerRunId: undefined,
      clearPendingAuth: true,
    });
    expect(touchConversationLastUserVisibleAction).toHaveBeenCalledWith("conv-auth");
    expect(onAuthResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-auth",
        interrupt: expect.objectContaining({
          id: "interrupt-auth-slack",
          status: "accepted",
        }),
        event: expect.objectContaining({
          type: "interrupt_resolved",
          kind: "auth",
          status: "accepted",
        }),
      }),
    );
  });

  it("enqueues detached auth resolution as a suspended interrupt resume", async () => {
    const lifecycleStore = createLifecycleStore();
    const enqueueResolvedInterruptResume = vi.fn(async () => undefined);
    createAuthInterrupt({
      id: "interrupt-detached-auth",
      generationId: "gen-detached-auth",
      conversationId: "conv-detached-auth",
      providerToolUseId: "auth-detached-notion",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["notion"] },
      },
    });
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-detached-auth",
      conversationId: "conv-detached-auth",
      status: "awaiting_auth",
      contentParts: null,
      remainingRunMs: 333_000,
      conversation: {
        id: "conv-detached-auth",
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
      flow.submitAuthResult({
        generationId: "gen-detached-auth",
        integration: "notion",
        success: true,
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(resolveInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-detached-auth",
        status: "accepted",
        responsePayload: {
          connectedIntegrations: ["notion"],
          integration: "notion",
        },
        resolvedByUserId: "user-1",
      }),
    );
    expect(enqueueResolvedInterruptResume).toHaveBeenCalledWith({
      generationId: "gen-detached-auth",
      conversationId: "conv-detached-auth",
      interrupt: expect.objectContaining({
        id: "interrupt-detached-auth",
        status: "accepted",
      }),
      runType: "chat",
      coworkerRunId: undefined,
      remainingRunMs: 333_000,
    });
    expect(lifecycleStore.resumeAfterDecision).not.toHaveBeenCalled();
  });

  it("handles auth guard paths and cancellation without running the Generation inline", async () => {
    const lifecycleStore = createLifecycleStore();
    const enqueueConversationQueuedMessageProcess = vi.fn(async () => undefined);
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      enqueueConversationQueuedMessageProcess,
    });

    await expect(
      flow.submitAuthResult({
        generationId: "missing",
        integration: "slack",
        success: true,
        userId: "user-1",
      }),
    ).resolves.toBe(false);

    createAuthInterrupt();
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-auth",
      conversationId: "conv-auth",
      conversation: {
        id: "conv-auth",
        userId: "user-1",
      },
    });
    await expect(
      flow.submitAuthResult({
        generationId: "gen-auth",
        integration: "slack",
        success: true,
        userId: "other-user",
      }),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-auth",
      conversationId: "conv-auth",
      conversation: {
        id: "conv-auth",
        userId: "user-1",
      },
    });
    await expect(
      flow.submitAuthResult({
        generationId: "gen-auth",
        integration: "github",
        success: true,
        userId: "user-1",
      }),
    ).resolves.toBe(false);

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-auth",
      conversationId: "conv-auth",
      conversation: {
        id: "conv-auth",
        userId: "user-1",
      },
    });
    await expect(
      flow.submitAuthResult({
        generationId: "gen-auth",
        integration: "slack",
        success: false,
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    expect(resolveInterruptMock).toHaveBeenLastCalledWith({
      interruptId: "interrupt-auth-slack",
      status: "cancelled",
      responsePayload: { integration: "slack" },
      resolvedByUserId: "user-1",
    });
    expect(lifecycleStore.cancelAfterAuthFailure).toHaveBeenCalledWith({
      generationId: "gen-auth",
      conversationId: "conv-auth",
      coworkerRunId: undefined,
    });
    expect(enqueueConversationQueuedMessageProcess).toHaveBeenCalledWith("conv-auth");
  });

  it("requests auth by creating a pending interrupt and marking the linked Coworker run", async () => {
    const lifecycleStore = createLifecycleStore();
    const onPendingInterrupt = vi.fn(async () => undefined);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-auth-request",
      conversationId: "conv-auth-request",
      runtimeId: "runtime-auth-request",
      conversation: {
        id: "conv-auth-request",
        userId: "user-1",
        autoApprove: false,
      },
    });
    getRuntimeMock.mockResolvedValueOnce({
      id: "runtime-auth-request",
      activeTurnSeq: 4,
    });
    coworkerRunFindFirstMock.mockResolvedValueOnce({ id: "coworker-run-1" });
    const flow = new DecisionFlow({
      lifecycleStore: lifecycleStore as never,
      onPendingInterrupt,
    });

    await expect(
      flow.requestAuthInterrupt("gen-auth-request", {
        integration: "notion",
        reason: "Connect Notion",
      }),
    ).resolves.toEqual({
      interruptId: expect.stringMatching(/^interrupt-auth-\d+-notion$/),
      status: "pending",
      expiresAt: expect.any(String),
    });

    expect(createInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-auth-request",
        runtimeId: "runtime-auth-request",
        conversationId: "conv-auth-request",
        turnSeq: 4,
        kind: "auth",
        display: {
          title: "Connection Required",
          authSpec: {
            integrations: ["notion"],
            reason: "Connect Notion",
          },
        },
        provider: "plugin",
        providerToolUseId: expect.stringMatching(/^auth-\d+-notion$/),
      }),
    );
    expect(lifecycleStore.markCoworkerRunAwaitingAuth).toHaveBeenCalledWith("coworker-run-1");
    expect(onPendingInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-auth-request",
        conversationId: "conv-auth-request",
        kind: "auth",
        event: expect.objectContaining({
          type: "interrupt_pending",
          kind: "auth",
          status: "pending",
        }),
      }),
    );
  });

  it("returns an unsuccessful auth wait immediately when the Generation is missing", async () => {
    const flow = new DecisionFlow({
      lifecycleStore: createLifecycleStore() as never,
    });

    await expect(
      flow.waitForAuth("missing", {
        integration: "slack",
      }),
    ).resolves.toEqual({ success: false });
  });
});
