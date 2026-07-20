import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  coworkerFindFirstMock,
  coworkerRunFindFirstMock,
  getPendingInterruptMock,
  getRuntimeForConversationMock,
  messageFindFirstMock,
  resolveBuilderContextMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  coworkerRunFindFirstMock: vi.fn(),
  getPendingInterruptMock: vi.fn(),
  getRuntimeForConversationMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  resolveBuilderContextMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      coworker: { findFirst: coworkerFindFirstMock },
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
      message: { findFirst: messageFindFirstMock },
    },
  },
}));

vi.mock("../conversation-runtime-service", () => ({
  conversationRuntimeService: {
    getRuntime: vi.fn(),
    getRuntimeForConversation: getRuntimeForConversationMock,
  },
}));

vi.mock("../coworker-builder-service", () => ({
  resolveCoworkerBuilderContextByConversation: resolveBuilderContextMock,
}));

vi.mock("../generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptMock,
  },
}));

import { TurnRunnerContextLoader } from "./turn-runner";
import { getExecutionPolicyFromRecord } from "./control/generation-control";

describe("TurnRunnerContextLoader Coworker provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageFindFirstMock.mockResolvedValue({ content: "follow-up" });
    resolveBuilderContextMock.mockResolvedValue(null);
    getPendingInterruptMock.mockResolvedValue(null);
    getRuntimeForConversationMock.mockResolvedValue(null);
    coworkerFindFirstMock.mockResolvedValue({
      allowedIntegrations: ["google_drive"],
      allowedCustomIntegrations: ["custom-crm"],
      allowedWorkspaceMcpServerIds: ["mcp-1"],
      allowedSkillSlugs: ["document-writer", "custom:research"],
      prompt: "Coworker instructions",
      autoApprove: true,
    });
  });

  it("inherits Coworker policy from the originating run conversation without owning that run", async () => {
    coworkerRunFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "run-origin",
      coworkerId: "coworker-1",
      triggerPayload: {},
      spawnDepth: 2,
    });
    const loader = new TurnRunnerContextLoader({
      getExecutionPolicyFromRecord,
    });

    const result = await loader.loadQueuedGenerationContext({
      id: "generation-follow-up",
      conversationId: "conversation-run",
      conversation: {
        userId: "user-1",
        workspaceId: "workspace-1",
        type: "coworker",
        model: "openai/gpt-5.5",
        authSource: "user",
        autoApprove: false,
      },
      runtimeId: null,
      traceId: "trace-1",
      status: "running",
      spawnDepth: 0,
      executionPolicy: {},
      startedAt: new Date("2026-07-20T10:00:00.000Z"),
      deadlineAt: new Date("2026-07-20T10:15:00.000Z"),
      remainingRunMs: 900_000,
      suspendedAt: null,
      resumeInterruptId: null,
      lastRuntimeProgressAt: new Date("2026-07-20T10:00:00.000Z"),
      recoveryAttempts: 0,
      completionReason: null,
      debugInfo: null,
      contentParts: [],
      inputTokens: 0,
      outputTokens: 0,
    } as never);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }
    expect(result.context.coworkerId).toBe("coworker-1");
    expect(result.context.coworkerRunId).toBeUndefined();
    expect(result.context.spawnDepth).toBe(0);
    expect(result.context.allowedIntegrations).toEqual(["google_drive"]);
    expect(result.context.allowedCustomIntegrations).toEqual(["custom-crm"]);
    expect(result.context.allowedWorkspaceMcpServerIds).toEqual(["mcp-1"]);
    expect(result.context.allowedSkillSlugs).toEqual(["document-writer", "custom:research"]);
    expect(result.context.selectedPlatformSkillSlugs).toEqual(["document-writer"]);
    expect(result.context.autoApprove).toBe(true);
    expect(coworkerRunFindFirstMock).toHaveBeenCalledTimes(2);
    expect(coworkerFindFirstMock).toHaveBeenCalledTimes(1);
  });
});
