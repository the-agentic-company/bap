import { describe, expect, it } from "vitest";
import { mapZeroConversationDetail, mapZeroConversationList } from "./chat-data";

describe("Zero chat data adapters", () => {
  it("maps recent conversations with message counts and existing ordering", () => {
    const conversations = mapZeroConversationList([
      {
        id: "chat-1",
        type: "chat",
        title: "Inbox",
        generationStatus: "idle",
        currentGenerationId: null,
        autoApprove: false,
        seenMessageCount: 1,
        isPinned: true,
        isShared: false,
        createdAt: 1781130000000,
        updatedAt: 1781130300000,
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "hello",
            createdAt: 1781130000000,
          },
          {
            id: "msg-2",
            role: "system",
            content: "hidden",
            createdAt: 1781130100000,
          },
          {
            id: "msg-3",
            role: "assistant",
            content: "hi",
            createdAt: 1781130200000,
          },
        ],
      },
    ]);

    expect(conversations).toEqual([
      expect.objectContaining({
        id: "chat-1",
        title: "Inbox",
        messageCount: 2,
        seenMessageCount: 1,
        isPinned: true,
      }),
    ]);
  });

  it("maps conversation detail messages in created order and omits file metadata", () => {
    const conversation = mapZeroConversationDetail({
      id: "chat-1",
      type: "chat",
      title: null,
      model: "openai/gpt-5",
      authSource: "shared",
      generationStatus: "idle",
      autoApprove: true,
      seenMessageCount: 0,
      isPinned: false,
      isShared: false,
      createdAt: 1781130000000,
      updatedAt: 1781130400000,
      messages: [
        {
          id: "msg-2",
          role: "assistant",
          content: "second",
          createdAt: 1781130200000,
        },
        {
          id: "msg-1",
          role: "user",
          content: "first",
          createdAt: 1781130100000,
        },
      ],
    });

    expect(conversation?.title).toBe("New conversation");
    expect(conversation?.messages.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    expect(conversation?.messages[0]).toEqual(
      expect.objectContaining({
        attachments: [],
        sandboxFiles: [],
      }),
    );
  });
});
