import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInterruptMock, interruptStore } = vi.hoisted(() => {
  const store = new Map<string, any>();
  return {
    getInterruptMock: vi.fn(async (interruptId: string) => store.get(interruptId) ?? null),
    interruptStore: store,
  };
});

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getInterrupt: getInterruptMock,
  },
}));

import { GenerationResumeRunner } from "./generation-resume-runner";

describe("GenerationResumeRunner suspended interrupt resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptStore.clear();
  });

  function createInterrupt(overrides: Record<string, unknown> = {}) {
    const interrupt = {
      id: "interrupt-resume",
      generationId: "gen-resume",
      runtimeId: "runtime-1",
      conversationId: "conv-resume",
      turnSeq: 4,
      kind: "runtime_permission",
      status: "accepted",
      display: {
        title: "OpenCode permission",
        integration: "opencode",
        operation: "permission",
        toolInput: { permission: "external_directory" },
      },
      provider: "runtime",
      providerRequestId: "permission-request-resume",
      providerToolUseId: "tool-resume-permission",
      responsePayload: undefined,
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: null,
      resolvedAt: new Date("2026-03-11T15:01:00.000Z"),
      requestedByUserId: null,
      resolvedByUserId: "user-1",
      ...overrides,
    };
    interruptStore.set(interrupt.id, interrupt);
    return interrupt;
  }

  function createContext(overrides: Record<string, unknown> = {}) {
    return {
      id: "gen-resume",
      conversationId: "conv-resume",
      resumeInterruptId: "interrupt-resume",
      currentInterruptId: "interrupt-resume",
      remainingRunMs: 444_000,
      deadlineAt: new Date(0),
      suspendedAt: new Date("2026-03-11T15:00:00.000Z"),
      status: "awaiting_approval",
      contentParts: [],
      ...overrides,
    };
  }

  function createDeps(overrides: Record<string, unknown> = {}) {
    const lifecycleStore = {
      markSuspendedInterruptResumeRunning: vi.fn(async () => undefined),
    };
    const decisionFlow = {
      applyParkedPluginWrite: vi.fn(async () => ({
        toolUseId: "call-tool-1",
        toolName: "bash",
        result: "ok\n",
        continuationText:
          "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
      })),
      buildResumedAuthContinuationPrompt: vi.fn(() => [
        {
          type: "text",
          text: "Continue the interrupted assistant turn. Authentication for notion is now complete.",
        },
      ]),
      buildResumedRuntimeQuestionContinuationPrompt: vi.fn(() => [
        {
          type: "text",
          text: "Continue the interrupted assistant turn. The pending question has been answered. The resolved answer was: Beta.",
        },
      ]),
    };
    const contextState = {
      resumeDeadlineFromRemainingBudget: vi.fn((ctx: any) => {
        ctx.deadlineAt = new Date("2026-03-11T15:08:24.000Z");
      }),
      setCompletionReason: vi.fn((ctx: any, reason: string) => {
        ctx.completionReason = reason;
      }),
    };
    return {
      lifecycleStore,
      decisionFlow,
      contextState,
      runRuntimeGeneration: vi.fn(async () => undefined),
      runRecoveryReattach: vi.fn(async () => undefined),
      finishGeneration: vi.fn(async () => undefined),
      saveProgress: vi.fn(async () => undefined),
      broadcast: vi.fn(),
      ...overrides,
    };
  }

  it("runs the normal runtime path when there is no suspended interrupt id", async () => {
    const deps = createDeps();
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext({ resumeInterruptId: null });

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(deps.runRuntimeGeneration).toHaveBeenCalledWith(ctx);
    expect(deps.contextState.resumeDeadlineFromRemainingBudget).not.toHaveBeenCalled();
    expect(deps.runRecoveryReattach).not.toHaveBeenCalled();
  });

  it("reattaches runtime interrupts while preserving the resume interrupt for runtime replay", async () => {
    createInterrupt();
    const deps = createDeps();
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext();

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(deps.contextState.resumeDeadlineFromRemainingBudget).toHaveBeenCalledWith(ctx);
    expect(ctx.status).toBe("running");
    expect(ctx.suspendedAt).toBeNull();
    expect(ctx.resumeInterruptId).toBe("interrupt-resume");
    expect(deps.lifecycleStore.markSuspendedInterruptResumeRunning).toHaveBeenCalledWith({
      generationId: "gen-resume",
      deadlineAt: new Date("2026-03-11T15:08:24.000Z"),
      resumeInterruptId: "interrupt-resume",
    });
    expect(deps.runRecoveryReattach).toHaveBeenCalledWith(ctx, {
      allowSnapshotRestore: true,
      requireLiveSession: false,
      resumeInterruptId: "interrupt-resume",
      modeLabel: "resume_interrupt",
      onRuntimeAttached: undefined,
    });
  });

  it("builds an auth continuation prompt for plugin-auth resumes and clears the stored resume id before reattach", async () => {
    const interrupt = createInterrupt({
      kind: "auth",
      provider: "plugin",
      providerRequestId: null,
      providerToolUseId: "auth-resume-notion",
      display: {
        title: "Connection Required",
        authSpec: { integrations: ["notion"] },
      },
      responsePayload: {
        connectedIntegrations: ["notion"],
        integration: "notion",
      },
    });
    const deps = createDeps({
      runRecoveryReattach: vi.fn(async (_ctx: unknown, options: any) => {
        await expect(options.onRuntimeAttached()).resolves.toEqual([
          {
            type: "text",
            text: "Continue the interrupted assistant turn. Authentication for notion is now complete.",
          },
        ]);
      }),
    });
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext({ status: "awaiting_auth" });

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(ctx.resumeInterruptId).toBeNull();
    expect(deps.lifecycleStore.markSuspendedInterruptResumeRunning).toHaveBeenCalledWith({
      generationId: "gen-resume",
      deadlineAt: new Date("2026-03-11T15:08:24.000Z"),
      resumeInterruptId: null,
    });
    expect(deps.runRecoveryReattach).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowSnapshotRestore: true,
        requireLiveSession: false,
        resumeInterruptId: "interrupt-resume",
        modeLabel: "resume_interrupt",
        onRuntimeAttached: expect.any(Function),
      }),
    );
    expect(deps.decisionFlow.buildResumedAuthContinuationPrompt).toHaveBeenCalledWith(interrupt);
  });

  it("builds a runtime-question continuation prompt when a runtime question resume reattaches", async () => {
    const interrupt = createInterrupt({
      kind: "runtime_question",
      providerRequestId: "question-request-resume",
      providerToolUseId: "tool-question-resume",
      display: {
        title: "question",
        integration: "bap",
        operation: "question",
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
      },
      responsePayload: {
        questionAnswers: [["Beta"]],
      },
    });
    const deps = createDeps({
      runRecoveryReattach: vi.fn(async (_ctx: unknown, options: any) => {
        await expect(options.onRuntimeAttached()).resolves.toEqual([
          {
            type: "text",
            text: "Continue the interrupted assistant turn. The pending question has been answered. The resolved answer was: Beta.",
          },
        ]);
      }),
    });
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext();

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(ctx.resumeInterruptId).toBe("interrupt-resume");
    expect(deps.runRecoveryReattach).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowSnapshotRestore: true,
        requireLiveSession: false,
        resumeInterruptId: "interrupt-resume",
        modeLabel: "resume_interrupt",
        onRuntimeAttached: expect.any(Function),
      }),
    );
    expect(deps.decisionFlow.buildResumedRuntimeQuestionContinuationPrompt).toHaveBeenCalledWith(
      interrupt,
    );
  });

  it("restores a parked plugin write, injects the approved result, and prompts the runtime to continue", async () => {
    const runtimeTool = {
      sessionId: "session-1",
      messageId: "message-assistant-1",
      partId: "part-tool-1",
      callId: "call-tool-1",
      toolName: "bash",
      input: {
        command: "slack send -c C123 -t hi --as bot",
        workdir: "/app",
      },
    };
    const interrupt = createInterrupt({
      kind: "plugin_write",
      provider: "plugin",
      providerRequestId: "plugin-write:runtime-1:4:runtime:call-tool-1",
      providerToolUseId: "plugin-tool-1",
      display: {
        title: "Bash",
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi --as bot",
        toolInput: {
          command: "slack send -c C123 -t hi --as bot",
          workdir: "/app",
        },
        runtimeTool,
      },
    });
    const deps = createDeps({
      runRecoveryReattach: vi.fn(async (_ctx: unknown, options: any) => {
        await expect(options.onRuntimeAttached("runtime-client")).resolves.toEqual([
          {
            type: "text",
            text: "Continue the interrupted assistant turn from the restored tool result. Do not rerun the already approved command.",
          },
        ]);
      }),
    });
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext({
      contentParts: [
        {
          type: "tool_use",
          id: "call-tool-1",
          name: "bash",
          input: {
            command: "slack send -c C123 -t hi --as bot",
            workdir: "/app",
          },
          integration: "slack",
          operation: "send",
        },
      ],
      sandbox: { id: "sandbox-1" },
    });

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(deps.runRecoveryReattach).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowSnapshotRestore: true,
        requireLiveSession: false,
        modeLabel: "resume_plugin_write",
        onRuntimeAttached: expect.any(Function),
      }),
    );
    expect(deps.decisionFlow.applyParkedPluginWrite).toHaveBeenCalledWith({
      runtimeClient: "runtime-client",
      interrupt,
      sandbox: ctx.sandbox,
      runtimeTool,
    });
    expect(deps.broadcast).toHaveBeenCalledWith(ctx, {
      type: "tool_result",
      toolName: "bash",
      result: "ok\n",
      toolUseId: "call-tool-1",
    });
    expect(ctx.contentParts).toContainEqual({
      type: "tool_result",
      tool_use_id: "call-tool-1",
      content: "ok\n",
    });
    expect(deps.saveProgress).toHaveBeenCalledWith(ctx);
  });

  it("finalizes parked plugin-write resume as an error when runtime tool identity was not saved", async () => {
    createInterrupt({
      kind: "plugin_write",
      provider: "plugin",
      providerRequestId: "plugin-write:runtime-1:4:runtime:call-tool-1",
      providerToolUseId: "plugin-tool-1",
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
    const deps = createDeps();
    const runner = new GenerationResumeRunner(deps as never);
    const ctx = createContext();

    await runner.runSuspendedInterruptResume(ctx as never);

    expect(deps.contextState.setCompletionReason).toHaveBeenCalledWith(
      ctx,
      "broken_runtime_state",
    );
    expect(ctx.errorMessage).toBe(
      "The approved integration write could not be resumed because its runtime tool identity was not saved.",
    );
    expect(deps.finishGeneration).toHaveBeenCalledWith(ctx, "error");
    expect(deps.runRecoveryReattach).not.toHaveBeenCalled();
  });
});
