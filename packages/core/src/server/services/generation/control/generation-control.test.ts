import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generationFindFirstMock,
  requestCancellationMock,
  clearPendingRequestMock,
  getPendingInterruptForGenerationMock,
} = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
  requestCancellationMock: vi.fn(),
  clearPendingRequestMock: vi.fn(),
  getPendingInterruptForGenerationMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      coworkerRun: { findFirst: vi.fn() },
      coworker: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("../../sandbox-slot-manager", () => ({
  getSandboxSlotManager: () => ({
    clearPendingRequest: clearPendingRequestMock,
  }),
}));

vi.mock("../../generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
  },
}));

import { GenerationControl, getExecutionPolicyFromRecord } from "./generation-control";

describe("getExecutionPolicyFromRecord", () => {
  it("preserves runtime no-progress debug policy fields", () => {
    const policy = getExecutionPolicyFromRecord(
      {
        executionPolicy: {
          autoApprove: false,
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
          debugForceRuntimeNoProgressAfterPrompt: true,
        },
      } as never,
      true,
    );

    expect(policy).toEqual(
      expect.objectContaining({
        autoApprove: false,
        allowSnapshotRestoreOnRun: false,
        debugRuntimeNoProgressTimeoutMs: 1_000,
        debugForceRuntimeNoProgressAfterPrompt: true,
      }),
    );
  });
});

describe("GenerationControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationFindFirstMock.mockResolvedValue(null);
    requestCancellationMock.mockResolvedValue(undefined);
    clearPendingRequestMock.mockResolvedValue(undefined);
    getPendingInterruptForGenerationMock.mockResolvedValue(null);
  });

  function createControl(activeGenerations = new Map<string, any>()) {
    return new GenerationControl({
      activeGenerations,
      lifecycleStore: {
        requestCancellation: requestCancellationMock,
      } as never,
      releaseSandboxSlotLease: vi.fn(async () => undefined),
    });
  }

  it("cancels a running Generation, clears pending slot state, and aborts active context", async () => {
    const abortController = new AbortController();
    const ctx = {
      id: "gen-1",
      abortController,
    };
    const activeGenerations = new Map<string, any>([["gen-1", ctx]]);
    const releaseSandboxSlotLease = vi.fn(async () => undefined);
    const control = new GenerationControl({
      activeGenerations,
      lifecycleStore: {
        requestCancellation: requestCancellationMock,
      } as never,
      releaseSandboxSlotLease,
    });
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      status: "running",
      conversation: {
        id: "conv-1",
        userId: "user-1",
      },
    });

    await expect(control.cancelGeneration("gen-1", "user-1")).resolves.toBe(true);

    expect(requestCancellationMock).toHaveBeenCalledWith({
      generationId: "gen-1",
      userId: "user-1",
    });
    expect(clearPendingRequestMock).toHaveBeenCalledWith("gen-1");
    expect(releaseSandboxSlotLease).toHaveBeenCalledWith(ctx);
    expect(abortController.signal.aborted).toBe(true);
  });

  it("returns persisted Generation status and pending approval projection", async () => {
    const control = createControl();
    generationFindFirstMock.mockResolvedValueOnce({
      status: "awaiting_approval",
      contentParts: [{ type: "text", text: "persisted" }],
      inputTokens: 6,
      outputTokens: 8,
    });
    getPendingInterruptForGenerationMock.mockResolvedValueOnce({
      kind: "plugin_write",
      providerToolUseId: "tool-1",
      display: {
        title: "Bash",
        integration: "github",
        operation: "write",
        command: "git status",
        toolInput: { command: "git status" },
      },
      requestedAt: new Date("2026-03-11T15:00:00.000Z"),
      expiresAt: new Date("2026-03-11T15:05:00.000Z"),
    });

    await expect(control.getGenerationStatus("gen-1")).resolves.toEqual({
      status: "awaiting_approval",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: { command: "git status" },
        requestedAt: "2026-03-11T15:00:00.000Z",
        expiresAt: "2026-03-11T15:05:00.000Z",
        integration: "github",
        operation: "write",
        command: "git status",
      },
      usage: { inputTokens: 6, outputTokens: 8 },
    });
  });

  it("returns persisted status without pending approval when no interrupt is pending", async () => {
    const control = createControl();
    generationFindFirstMock.mockResolvedValueOnce({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      inputTokens: 9,
      outputTokens: 11,
    });

    await expect(control.getGenerationStatus("gen-db")).resolves.toEqual({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: null,
      usage: { inputTokens: 9, outputTokens: 11 },
    });
  });
});
