import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  conversationFindManyMock,
  messageFindFirstMock,
  generationFindFirstMock,
  cancelInterruptsForGenerationMock,
  getQueueMock,
  recordedUpdates,
  dbMock,
  queueMock,
} = vi.hoisted(() => {
  const conversationFindManyMock = vi.fn();
  const messageFindFirstMock = vi.fn();
  const generationFindFirstMock = vi.fn();
  const cancelInterruptsForGenerationMock = vi.fn(async () => undefined);
  const recordedUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updateMock = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        recordedUpdates.push({ table, values });
        return [];
      }),
    }),
  }));
  const dbMock = {
    query: {
      conversation: {
        findMany: conversationFindManyMock,
      },
      message: {
        findFirst: messageFindFirstMock,
      },
      generation: {
        findFirst: generationFindFirstMock,
      },
    },
    update: updateMock,
  };
  const queueMock = {
    upsertJobScheduler: vi.fn(async () => undefined),
  };
  const getQueueMock = vi.fn(() => queueMock);

  return {
    conversationFindManyMock,
    messageFindFirstMock,
    generationFindFirstMock,
    cancelInterruptsForGenerationMock,
    getQueueMock,
    recordedUpdates,
    dbMock,
    queueMock,
  };
});

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("./generation-interrupt-service", () => ({
  generationInterruptService: {
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
  },
}));

vi.mock("../queues/queue-client", () => ({
  CONVERSATION_LOADING_CLEANUP_JOB_NAME: "conversation:loading-cleanup",
  getQueue: getQueueMock,
}));

import {
  cleanupStaleConversationLoadingStates,
  CONVERSATION_LOADING_CLEANUP_SCHEDULER_ID,
  STALE_LOADING_CONVERSATION_STATUSES,
  syncConversationLoadingCleanupJob,
} from "./conversation-loading-cleanup";

describe("conversation-loading-cleanup", () => {
  const now = new Date("2026-03-23T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    recordedUpdates.length = 0;
    conversationFindManyMock.mockResolvedValue([]);
    messageFindFirstMock.mockResolvedValue(null);
    generationFindFirstMock.mockResolvedValue(null);
    cancelInterruptsForGenerationMock.mockResolvedValue(undefined);
    getQueueMock.mockReturnValue(queueMock);
    queueMock.upsertJobScheduler.mockResolvedValue(undefined);
  });

  it("marks stale running generations as error and clears loading state", async () => {
    conversationFindManyMock.mockResolvedValue([
      {
        id: "conv-1",
        currentGenerationId: "gen-1",
        updatedAt: new Date("2026-03-23T06:00:00.000Z"),
      },
    ]);
    messageFindFirstMock.mockResolvedValue({
      createdAt: new Date("2026-03-23T07:00:00.000Z"),
    });
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      status: "running",
    });

    const summary = await cleanupStaleConversationLoadingStates(now);

    expect(summary).toEqual({
      scanned: 1,
      stale: 1,
      finalizedRunningAsError: 1,
      correctedStatuses: 0,
    });
    expect(cancelInterruptsForGenerationMock).toHaveBeenCalledWith("gen-1");
    expect(recordedUpdates).toHaveLength(3);
    expect(recordedUpdates.map((entry) => entry.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "error",
          errorMessage:
            "Generation was marked as stale after no new messages were recorded for over 4 hours.",
          completedAt: now,
        }),
        expect.objectContaining({
          status: "error",
          finishedAt: now,
          errorMessage:
            "Generation was marked as stale after no new messages were recorded for over 4 hours.",
        }),
        expect.objectContaining({
          generationStatus: "error",
        }),
      ]),
    );
  });

  it("reconciles stale generating conversations to the completed generation status", async () => {
    conversationFindManyMock.mockResolvedValue([
      {
        id: "conv-2",
        currentGenerationId: "gen-2",
        updatedAt: new Date("2026-03-23T06:00:00.000Z"),
      },
    ]);
    messageFindFirstMock.mockResolvedValue({
      createdAt: new Date("2026-03-23T07:00:00.000Z"),
    });
    generationFindFirstMock.mockResolvedValue({
      id: "gen-2",
      status: "completed",
    });

    const summary = await cleanupStaleConversationLoadingStates(now);

    expect(summary).toEqual({
      scanned: 1,
      stale: 1,
      finalizedRunningAsError: 0,
      correctedStatuses: 1,
    });
    expect(cancelInterruptsForGenerationMock).not.toHaveBeenCalled();
    expect(recordedUpdates).toHaveLength(1);
    expect(recordedUpdates[0]?.values).toEqual({
      generationStatus: "complete",
    });
  });

  it("limits stale loading cleanup to generating conversations", () => {
    expect(STALE_LOADING_CONVERSATION_STATUSES).toEqual(["generating"]);
    expect(STALE_LOADING_CONVERSATION_STATUSES).not.toContain("awaiting_approval");
    expect(STALE_LOADING_CONVERSATION_STATUSES).not.toContain("awaiting_auth");
    expect(STALE_LOADING_CONVERSATION_STATUSES).not.toContain("paused");
  });

  it("resets stale generating conversations to idle when the linked generation is missing", async () => {
    conversationFindManyMock.mockResolvedValue([
      {
        id: "conv-3",
        currentGenerationId: "gen-missing",
        updatedAt: new Date("2026-03-23T06:00:00.000Z"),
      },
    ]);
    messageFindFirstMock.mockResolvedValue({
      createdAt: new Date("2026-03-23T07:00:00.000Z"),
    });
    generationFindFirstMock.mockResolvedValue(null);

    const summary = await cleanupStaleConversationLoadingStates(now);

    expect(summary).toEqual({
      scanned: 1,
      stale: 1,
      finalizedRunningAsError: 0,
      correctedStatuses: 1,
    });
    expect(recordedUpdates).toHaveLength(1);
    expect(recordedUpdates[0]?.values).toEqual({
      generationStatus: "idle",
    });
  });

  it("registers an hourly BullMQ scheduler for the cleanup job", async () => {
    await syncConversationLoadingCleanupJob();

    expect(getQueueMock).toHaveBeenCalledOnce();
    expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
      CONVERSATION_LOADING_CLEANUP_SCHEDULER_ID,
      expect.objectContaining({
        pattern: "0 * * * *",
        tz: expect.any(String),
      }),
      {
        name: "conversation:loading-cleanup",
        data: {},
      },
    );
  });
});
