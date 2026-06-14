import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  conversationFindFirstMock,
  generationFindFirstMock,
  queuedMessageFindManyMock,
  queuedMessageFindFirstMock,
  dbDeleteMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateReturningMock,
  queueAddMock,
  getQueueMock,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const conversationFindFirstMock = vi.fn();
  const generationFindFirstMock = vi.fn();
  const queuedMessageFindManyMock = vi.fn();
  const queuedMessageFindFirstMock = vi.fn();

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const dbDeleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const dbInsertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const dbUpdateMock = vi.fn(() => ({ set: updateSetMock }));

  const queueAddMock = vi.fn();
  const queueMock = {
    add: queueAddMock,
  };
  const getQueueMock = vi.fn(() => queueMock);

  const dbMock = {
    delete: dbDeleteMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
    query: {
      conversation: {
        findFirst: conversationFindFirstMock,
      },
      generation: {
        findFirst: generationFindFirstMock,
      },
      conversationQueuedMessage: {
        findMany: queuedMessageFindManyMock,
        findFirst: queuedMessageFindFirstMock,
      },
    },
  };

  return {
    conversationFindFirstMock,
    generationFindFirstMock,
    queuedMessageFindManyMock,
    queuedMessageFindFirstMock,
    dbDeleteMock,
    dbInsertMock,
    insertValuesMock,
    insertReturningMock,
    dbUpdateMock,
    updateSetMock,
    updateReturningMock,
    queueAddMock,
    getQueueMock,
    queueMock,
    dbMock,
  };
});

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("../../../queues/queue-client", () => ({
  CONVERSATION_QUEUED_MESSAGE_PROCESS_JOB_NAME: "conversation:queued-message-process",
  buildQueueJobId: (parts: Array<string | number | null | undefined>) =>
    parts
      .map((part) => String(part ?? "").trim())
      .filter((part) => part.length > 0)
      .join("-")
      .replaceAll(":", "-")
      .replaceAll(/\s+/g, "-")
      .replaceAll(/-+/g, "-"),
  getQueue: getQueueMock,
}));

import { ConversationTurnQueue } from "./conversation-turn-queue";

function createQueue(startGeneration = vi.fn()) {
  return {
    queue: new ConversationTurnQueue({ startGeneration }),
    startGeneration,
  };
}

describe("ConversationTurnQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueMock.mockReturnValue(queueMock);
    queueAddMock.mockResolvedValue(undefined);
    conversationFindFirstMock.mockResolvedValue({ id: "conv-1" });
    generationFindFirstMock.mockResolvedValue(null);
    queuedMessageFindManyMock.mockResolvedValue([]);
    queuedMessageFindFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([{ id: "queue-1" }]);
    updateReturningMock.mockResolvedValue([]);
  });

  it("returns an empty queued-message list when the conversation no longer exists", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const { queue } = createQueue();
    const result = await queue.listConversationQueuedMessages("conv-missing", "user-1");

    expect(result).toEqual([]);
    expect(queuedMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("enqueues queued messages for coworker conversations", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-builder",
      userId: "user-1",
      type: "coworker",
    });
    insertReturningMock.mockResolvedValueOnce([{ id: "queue-coworker-1" }]);

    const { queue } = createQueue();
    const result = await queue.enqueueConversationMessage({
      conversationId: "conv-coworker-builder",
      userId: "user-1",
      content: "Steer the builder toward CRM follow-up.",
    });

    expect(result).toEqual({ queuedMessageId: "queue-coworker-1" });
    expect(dbDeleteMock).not.toHaveBeenCalled();
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({
      conversationId: "conv-coworker-builder",
      userId: "user-1",
      content: "Steer the builder toward CRM follow-up.",
      fileAttachments: undefined,
      selectedPlatformSkillSlugs: undefined,
      status: "queued",
    });
    expect(queueAddMock).toHaveBeenCalledWith(
      "conversation:queued-message-process",
      { conversationId: "conv-coworker-builder" },
      {
        jobId: "conversation-queued-message-process-conv-coworker-builder",
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  });

  it("lists queued messages for coworker conversations", async () => {
    const createdAt = new Date("2026-03-12T10:00:00.000Z");
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-run",
      userId: "user-1",
      type: "coworker",
    });
    queuedMessageFindManyMock.mockResolvedValueOnce([
      {
        id: "queue-coworker-1",
        content: "Steer the runner toward the latest customer reply.",
        fileAttachments: null,
        selectedPlatformSkillSlugs: ["gmail"],
        status: "queued",
        createdAt,
      },
    ]);

    const { queue } = createQueue();
    const result = await queue.listConversationQueuedMessages("conv-coworker-run", "user-1");

    expect(result).toEqual([
      {
        id: "queue-coworker-1",
        content: "Steer the runner toward the latest customer reply.",
        fileAttachments: undefined,
        selectedPlatformSkillSlugs: ["gmail"],
        status: "queued",
        createdAt,
      },
    ]);
  });

  it("updates queued messages without changing their queue position", async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: "queue-coworker-1" }]);

    const { queue } = createQueue();
    const result = await queue.updateConversationQueuedMessage({
      queuedMessageId: "queue-coworker-1",
      conversationId: "conv-coworker-run",
      userId: "user-1",
      content: "Steer the runner toward the latest customer reply.",
      selectedPlatformSkillSlugs: ["gmail"],
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      content: "Steer the runner toward the latest customer reply.",
      fileAttachments: null,
      selectedPlatformSkillSlugs: ["gmail"],
    });
  });

  it("processes queued messages for coworker conversations once idle", async () => {
    const startGeneration = vi.fn().mockResolvedValue({
      generationId: "gen-next",
      conversationId: "conv-coworker-run",
    });
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-coworker-run",
      type: "coworker",
    });
    generationFindFirstMock.mockResolvedValueOnce(null);
    queuedMessageFindFirstMock.mockResolvedValueOnce({
      id: "queue-coworker-1",
    });
    updateReturningMock.mockResolvedValueOnce([
      {
        id: "queue-coworker-1",
        userId: "user-1",
        content: "Steer the runner toward the urgent issue first.",
        fileAttachments: null,
        selectedPlatformSkillSlugs: ["fill-pdf"],
      },
    ]);

    const { queue } = createQueue(startGeneration);
    await queue.processConversationQueuedMessages("conv-coworker-run");

    expect(startGeneration).toHaveBeenCalledWith({
      conversationId: "conv-coworker-run",
      userId: "user-1",
      content: "Steer the runner toward the urgent issue first.",
      fileAttachments: undefined,
      selectedPlatformSkillSlugs: ["fill-pdf"],
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(1, {
      status: "processing",
      processingStartedAt: expect.any(Date),
      errorMessage: null,
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(2, {
      status: "sent",
      generationId: "gen-next",
      sentAt: expect.any(Date),
      processingStartedAt: null,
      errorMessage: null,
    });
  });
});
