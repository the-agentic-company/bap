import { describe, expect, it } from "vitest";
import type { Message } from "./message-list";
import { mergePersistedConversationMessages } from "./chat-message-sync";

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: "msg-1",
    role: "user",
    content: "",
    ...overrides,
  };
}

describe("mergePersistedConversationMessages", () => {
  it("preserves optimistic messages while the latest user message is not yet persisted", () => {
    const persistedMessages = [createMessage({ id: "msg-1", content: "first message" })];
    const currentMessages = [
      ...persistedMessages,
      createMessage({ id: "temp-2", content: "second message" }),
    ];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual(currentMessages);
  });

  it("drops optimistic messages once the persisted snapshot catches up", () => {
    const currentMessages = [
      createMessage({ id: "msg-1", content: "first message" }),
      createMessage({ id: "temp-2", content: "second message" }),
    ];
    const persistedMessages = [
      createMessage({ id: "msg-1", content: "first message" }),
      createMessage({ id: "msg-2", content: "second message" }),
    ];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual(persistedMessages);
  });

  it("moves pending attachments onto the matching persisted user message", () => {
    const attachment = {
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const currentMessages = [
      createMessage({ id: "msg-1", content: "first message" }),
      createMessage({ id: "temp-2", content: "read this", attachments: [attachment] }),
    ];
    const persistedMessages = [
      createMessage({ id: "msg-1", content: "first message" }),
      createMessage({ id: "msg-2", content: "read this" }),
    ];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual([
      createMessage({ id: "msg-1", content: "first message" }),
      createMessage({ id: "msg-2", content: "read this", attachments: [attachment] }),
    ]);
  });

  it("keeps pending attachments after optimistic preservation turns off", () => {
    const attachment = {
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const currentMessages = [
      createMessage({ id: "temp-1", content: "read this", attachments: [attachment] }),
    ];
    const persistedMessages = [createMessage({ id: "msg-1", content: "read this" })];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: false,
      }),
    ).toEqual([createMessage({ id: "msg-1", content: "read this", attachments: [attachment] })]);
  });

  it("keeps carried attachments on later persisted snapshots that still lack attachment rows", () => {
    const attachment = {
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const currentMessages = [
      createMessage({ id: "msg-1", content: "read this", attachments: [attachment] }),
    ];
    const persistedMessages = [createMessage({ id: "msg-1", content: "read this" })];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual([createMessage({ id: "msg-1", content: "read this", attachments: [attachment] })]);
  });

  it("attaches an optimistic upload to the new same-content persisted message only", () => {
    const attachment = {
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const currentMessages = [
      createMessage({ id: "msg-1", content: "repeat" }),
      createMessage({ id: "temp-2", content: "repeat", attachments: [attachment] }),
    ];
    const persistedMessages = [
      createMessage({ id: "msg-1", content: "repeat" }),
      createMessage({ id: "msg-2", content: "repeat" }),
    ];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual([
      createMessage({ id: "msg-1", content: "repeat" }),
      createMessage({ id: "msg-2", content: "repeat", attachments: [attachment] }),
    ]);
  });

  it("uses persisted attachments once they are available", () => {
    const optimisticAttachment = {
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const persistedAttachment = {
      id: "attachment-1",
      name: "brief.txt",
      mimeType: "text/plain",
      fileAssetId: "asset-1",
      sizeBytes: 128,
    };
    const currentMessages = [
      createMessage({
        id: "temp-1",
        content: "read this",
        attachments: [optimisticAttachment],
      }),
    ];
    const persistedMessages = [
      createMessage({
        id: "msg-1",
        content: "read this",
        attachments: [persistedAttachment],
      }),
    ];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: true,
      }),
    ).toEqual(persistedMessages);
  });

  it("replaces local messages when optimistic preservation is disabled", () => {
    const persistedMessages = [createMessage({ id: "msg-1", content: "persisted" })];
    const currentMessages = [createMessage({ id: "temp-1", content: "optimistic" })];

    expect(
      mergePersistedConversationMessages({
        currentMessages,
        persistedMessages,
        preserveOptimisticMessages: false,
      }),
    ).toEqual(persistedMessages);
  });
});
