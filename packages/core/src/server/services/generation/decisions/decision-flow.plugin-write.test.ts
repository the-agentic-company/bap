import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createInterruptMock,
  findInterruptByProviderRequestIdMock,
  generationFindFirstMock,
  getInterruptMock,
  getRuntimeMock,
  interruptStore,
  markInterruptAppliedMock,
  processGenerationTimeoutMock,
  projectInterruptEventMock,
  refreshInterruptExpiryMock,
  updateInterruptDisplayMock,
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
    findInterruptByProviderRequestIdMock: vi.fn(async (params: any) => {
      return (
        [...store.values()].find(
          (interrupt) =>
            interrupt.generationId === params.generationId &&
            interrupt.providerRequestId === params.providerRequestId,
        ) ?? null
      );
    }),
    generationFindFirstMock: vi.fn(),
    getInterruptMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    getRuntimeMock: vi.fn(),
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
    processGenerationTimeoutMock: vi.fn(async () => undefined),
    projectInterruptEventMock: projectInterruptEvent,
    refreshInterruptExpiryMock: vi.fn(async (interruptId: string, expiresAt: Date) => {
      const current = store.get(interruptId);
      if (!current || current.status !== "pending") {
        return null;
      }
      const updated = { ...current, expiresAt };
      store.set(interruptId, updated);
      return updated;
    }),
    updateInterruptDisplayMock: vi.fn(async (interruptId: string, display: any) => {
      const current = store.get(interruptId);
      if (!current) {
        return null;
      }
      const updated = { ...current, display };
      store.set(interruptId, updated);
      return updated;
    }),
  };
});

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      coworkerRun: { findFirst: vi.fn() },
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
    findInterruptByProviderRequestId: findInterruptByProviderRequestIdMock,
    getInterrupt: getInterruptMock,
    markInterruptApplied: markInterruptAppliedMock,
    projectInterruptEvent: projectInterruptEventMock,
    refreshInterruptExpiry: refreshInterruptExpiryMock,
    updateInterruptDisplay: updateInterruptDisplayMock,
  },
}));

import { GenerationSuspendedError } from "../core/turn-suspension";
import { DecisionFlow, InterruptParking } from "./decision-flow";

describe("DecisionFlow plugin-write decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptStore.clear();
    generationFindFirstMock.mockResolvedValue(null);
    getRuntimeMock.mockResolvedValue(null);
    processGenerationTimeoutMock.mockResolvedValue(undefined);
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

  function createFlow(overrides: Partial<ConstructorParameters<typeof DecisionFlow>[0]> = {}) {
    return new DecisionFlow({
      lifecycleStore: createLifecycleStore() as never,
      processGenerationTimeout: processGenerationTimeoutMock,
      ...overrides,
    });
  }

  function createGenerationRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "gen-plugin",
      conversationId: "conv-plugin",
      runtimeId: "runtime-plugin",
      contentParts: [],
      conversation: {
        id: "conv-plugin",
        userId: "user-1",
        autoApprove: false,
      },
      ...overrides,
    };
  }

  function createPluginInterrupt(overrides: Record<string, unknown> = {}) {
    const interrupt = {
      id: "interrupt-plugin-write",
      generationId: "gen-plugin",
      runtimeId: "runtime-plugin",
      conversationId: "conv-plugin",
      turnSeq: 3,
      kind: "plugin_write",
      status: "pending",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
        toolInput: { command: "slack send -c C123 -t hi", workdir: "/app" },
      },
      provider: "plugin",
      providerRequestId: "provider-plugin-write",
      providerToolUseId: "plugin-tool-1",
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

  it("auto-approves plugin writes when the Generation execution policy enables it", async () => {
    generationFindFirstMock.mockResolvedValueOnce(
      createGenerationRecord({
        conversation: {
          id: "conv-plugin",
          userId: "user-1",
          autoApprove: true,
        },
      }),
    );
    const onPendingInterrupt = vi.fn(async () => undefined);
    const flow = createFlow({
      onPendingInterrupt,
      getExecutionPolicy: () => ({ autoApprove: true }),
    });

    await expect(
      flow.requestPluginApproval("gen-plugin", {
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toEqual({ decision: "allow" });

    expect(createInterruptMock).not.toHaveBeenCalled();
    expect(onPendingInterrupt).not.toHaveBeenCalled();
  });

  it("creates a pending plugin-write interrupt and emits the pending event", async () => {
    const runtimeTool = {
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      callId: "call-1",
      toolName: "bash",
      input: { command: "slack send -c C123 -t hi" },
    };
    const onPendingInterrupt = vi.fn(async () => undefined);
    generationFindFirstMock.mockResolvedValueOnce(createGenerationRecord());
    getRuntimeMock.mockResolvedValueOnce({
      id: "runtime-plugin",
      activeTurnSeq: 3,
    });
    const flow = createFlow({
      getActiveRuntimeContext: () =>
        ({
          id: "gen-plugin",
          conversationId: "conv-plugin",
          contentParts: [
            {
              type: "tool_use",
              id: "call-1",
              name: "bash",
              input: { command: "slack send -c C123 -t hi" },
              integration: "slack",
              operation: "send",
            },
          ],
          runtimeTools: new Map([["call-1", runtimeTool]]),
        }) as never,
      onPendingInterrupt,
    });

    const result = await flow.requestPluginApproval("gen-plugin", {
      providerRequestId: "plugin-write:runtime-plugin:3:runtime:call-1",
      toolInput: { command: "slack send -c C123 -t hi" },
      integration: "slack",
      operation: "send",
      command: "slack send -c C123 -t hi",
    });

    expect(result).toEqual({
      decision: "pending",
      toolUseId: expect.stringMatching(/^plugin-\d+-[a-z0-9]+$/),
      interruptId: expect.stringMatching(/^interrupt-plugin-\d+-[a-z0-9]+$/),
      expiresAt: expect.any(String),
    });
    expect(createInterruptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-plugin",
        runtimeId: "runtime-plugin",
        conversationId: "conv-plugin",
        turnSeq: 3,
        kind: "plugin_write",
        provider: "plugin",
        providerRequestId: "plugin-write:runtime-plugin:3:runtime:call-1",
        display: expect.objectContaining({
          title: "Bash",
          integration: "slack",
          operation: "send",
          command: "slack send -c C123 -t hi",
          runtimeTool,
        }),
      }),
    );
    expect(onPendingInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-plugin",
        conversationId: "conv-plugin",
        kind: "approval",
        event: expect.objectContaining({
          type: "interrupt_pending",
          kind: "plugin_write",
          status: "pending",
        }),
      }),
    );
  });

  it("reuses plugin-write decisions by provider request id", async () => {
    generationFindFirstMock.mockResolvedValue(createGenerationRecord());
    getRuntimeMock.mockResolvedValue({ id: "runtime-plugin", activeTurnSeq: 3 });
    const pending = createPluginInterrupt({
      id: "interrupt-pending-reuse",
      providerRequestId: "provider-request-1",
      providerToolUseId: "tool-pending-reuse",
      expiresAt: new Date("2026-03-11T15:05:00.000Z"),
    });
    const flow = createFlow();

    await expect(
      flow.requestPluginApproval("gen-plugin", {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toEqual({
      decision: "pending",
      toolUseId: "tool-pending-reuse",
      interruptId: "interrupt-pending-reuse",
      expiresAt: "2026-03-11T15:05:00.000Z",
    });

    interruptStore.set(pending.id, {
      ...pending,
      status: "accepted",
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
    });
    await expect(
      flow.requestPluginApproval("gen-plugin", {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toEqual({ decision: "allow" });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith("interrupt-pending-reuse");

    interruptStore.set(pending.id, { ...pending, status: "rejected" });
    await expect(
      flow.requestPluginApproval("gen-plugin", {
        providerRequestId: "provider-request-1",
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toEqual({ decision: "deny" });
  });

  it("persists resolved plugin-write approval content and marks accepted interrupts applied", async () => {
    const lifecycleStore = createLifecycleStore();
    const onPluginApprovalResolved = vi.fn(async () => undefined);
    const activeCtx = {
      id: "gen-plugin",
      conversationId: "conv-plugin",
      contentParts: [],
      runtimeTools: new Map(),
    };
    createPluginInterrupt({
      status: "accepted",
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      resolvedByUserId: "user-1",
    });
    generationFindFirstMock.mockResolvedValueOnce(createGenerationRecord());
    const flow = createFlow({
      lifecycleStore: lifecycleStore as never,
      getActiveRuntimeContext: () => activeCtx as never,
      onPluginApprovalResolved,
    });

    await expect(
      flow.getPluginApprovalStatus("gen-plugin", "interrupt-plugin-write"),
    ).resolves.toBe("allow");

    expect(activeCtx.contentParts).toEqual([
      expect.objectContaining({
        type: "approval",
        tool_use_id: "plugin-tool-1",
        integration: "slack",
        operation: "send",
        status: "approved",
      }),
    ]);
    expect(lifecycleStore.persistDecisionContentParts).toHaveBeenCalledWith({
      generationId: "gen-plugin",
      contentParts: activeCtx.contentParts,
    });
    expect(onPluginApprovalResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-plugin",
        decision: "allow",
        event: expect.objectContaining({
          type: "interrupt_resolved",
          status: "accepted",
        }),
      }),
    );
    expect(markInterruptAppliedMock).toHaveBeenCalledWith("interrupt-plugin-write");
  });

  it("expires stale pending plugin-write approvals through the timeout processor", async () => {
    createPluginInterrupt({
      expiresAt: new Date("2026-03-11T15:00:00.000Z"),
    });
    generationFindFirstMock.mockResolvedValueOnce(createGenerationRecord());
    const flow = createFlow();

    await expect(
      flow.getPluginApprovalStatus("gen-plugin", "interrupt-plugin-write"),
    ).resolves.toBe("deny");

    expect(processGenerationTimeoutMock).toHaveBeenCalledWith("gen-plugin", "approval");
  });

  it("executes an approved parked plugin write and updates the restored runtime tool part", async () => {
    const updateRuntimeToolPart = vi.fn(async () => undefined);
    const flow = createFlow({ updateRuntimeToolPart });
    const interrupt = createPluginInterrupt({
      status: "accepted",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi --as bot",
        toolInput: {
          command: "slack send -c C123 -t hi --as bot",
          workdir: "/app",
        },
      },
    });
    const sandbox = {
      execute: vi.fn(async () => ({
        exitCode: 0,
        stdout: '[{"ok":true,"ts":"1775739000.000100"}]\n',
        stderr: "",
      })),
    };
    const runtimeTool = {
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      callId: "call-tool-1",
      toolName: "bash",
      input: { command: "slack send -c C123 -t hi --as bot", workdir: "/app" },
    };
    const runtimeClient = {};

    await expect(
      flow.applyParkedPluginWrite({
        interrupt,
        sandbox: sandbox as never,
        runtimeClient,
        runtimeTool,
      }),
    ).resolves.toEqual({
      toolUseId: "call-tool-1",
      toolName: "bash",
      result: '[{"ok":true,"ts":"1775739000.000100"}]\n',
      continuationText:
        "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
    });

    expect(sandbox.execute).toHaveBeenCalledWith(
      expect.stringContaining("slack send -c C123 -t hi --as bot"),
      { timeout: 120_000 },
    );
    expect(updateRuntimeToolPart).toHaveBeenCalledWith(runtimeClient, runtimeTool, {
      status: "completed",
      input: {
        command: "slack send -c C123 -t hi --as bot",
        workdir: "/app",
      },
      output: '[{"ok":true,"ts":"1775739000.000100"}]\n',
    });
    expect(markInterruptAppliedMock).toHaveBeenCalledWith("interrupt-plugin-write");
  });

  it("parks a still-pending plugin-write interrupt after refreshing its expiry and enriching runtime tool identity", async () => {
    const runtimeTool = {
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      callId: "call-tool-1",
      toolName: "bash",
      input: { command: "slack send -c C123 -t hi" },
    };
    const interrupt = createPluginInterrupt({
      providerRequestId: "plugin-write:runtime-plugin:3:runtime:call-tool-1",
    });
    const ctx = {
      id: "gen-plugin",
      conversationId: "conv-plugin",
      runtimeId: "runtime-plugin",
      sandboxId: "sandbox-plugin",
      status: "awaiting_approval",
      currentInterruptId: interrupt.id,
      contentParts: [
        {
          type: "tool_use",
          id: "call-tool-1",
          name: "bash",
          input: { command: "slack send -c C123 -t hi" },
          integration: "slack",
          operation: "send",
        },
      ],
      runtimeTools: new Map([["call-tool-1", runtimeTool]]),
    };
    const broadcast = vi.fn();
    const suspendGenerationForInterrupt = vi.fn(async () => {
      throw new GenerationSuspendedError(interrupt.id, "approval");
    });
    const parking = new InterruptParking({
      activeGenerations: new Map([[ctx.id, ctx as never]]),
      getApprovalHotWaitMs: () => 1_000,
      broadcast,
      suspendGenerationForInterrupt,
      getPluginApprovalStatus: vi.fn(async () => "pending"),
    });

    await expect(
      parking.parkGenerationForInterrupt(ctx as never, interrupt as never),
    ).rejects.toThrow("Generation suspended for approval interrupt");

    expect(updateInterruptDisplayMock).toHaveBeenCalledWith(
      "interrupt-plugin-write",
      expect.objectContaining({
        runtimeTool,
      }),
    );
    expect(refreshInterruptExpiryMock).toHaveBeenCalledWith(
      "interrupt-plugin-write",
      expect.any(Date),
    );
    expect(broadcast).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        type: "status_change",
        status: "approval_parked",
        metadata: expect.objectContaining({
          runtimeId: "runtime-plugin",
          releasedSandboxId: "sandbox-plugin",
          parkedInterruptId: "interrupt-plugin-write",
        }),
      }),
    );
    expect(suspendGenerationForInterrupt).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        id: "interrupt-plugin-write",
        display: expect.objectContaining({ runtimeTool }),
      }),
    );
  });
});
