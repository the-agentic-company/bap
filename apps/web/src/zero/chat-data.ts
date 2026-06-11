import type { ReadonlyJSONValue } from "@rocicorp/zero";

type ZeroMessageLike = {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly contentParts?: readonly ReadonlyJSONValue[] | null;
  readonly timing?: Record<string, ReadonlyJSONValue> | null;
  readonly parentMessageId?: string | null;
  readonly opencodeMessageId?: string | null;
  readonly createdAt: number | string | Date;
};

type ZeroConversationLike = {
  readonly id: string;
  readonly type: "chat" | "coworker" | string;
  readonly title?: string | null;
  readonly model?: string | null;
  readonly authSource?: "user" | "shared" | null;
  readonly generationStatus: string;
  readonly currentGenerationId?: string | null;
  readonly autoApprove: boolean;
  readonly seenMessageCount: number;
  readonly isPinned: boolean;
  readonly isShared: boolean;
  readonly createdAt: number | string | Date;
  readonly updatedAt: number | string | Date;
  readonly messages?: readonly ZeroMessageLike[];
};

function asDate(value: number | string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function toMutableJson(value: ReadonlyJSONValue | undefined | null): unknown {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function mapMessage(message: ZeroMessageLike) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    contentParts: toMutableJson(message.contentParts) as never[] | null | undefined,
    timing: toMutableJson(message.timing) as Record<string, unknown> | null | undefined,
    parentMessageId: message.parentMessageId ?? null,
    opencodeMessageId: message.opencodeMessageId ?? null,
    createdAt: asDate(message.createdAt),
    attachments: [],
    sandboxFiles: [],
  };
}

export function mapZeroConversationListItem(conversation: ZeroConversationLike) {
  const messages = conversation.messages?.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title ?? "New conversation",
    generationStatus: conversation.generationStatus,
    currentGenerationId: conversation.currentGenerationId ?? null,
    isPinned: conversation.isPinned,
    isShared: conversation.isShared,
    createdAt: asDate(conversation.createdAt),
    updatedAt: asDate(conversation.updatedAt),
    messageCount: messages?.length ?? 0,
    seenMessageCount: conversation.seenMessageCount,
  };
}

export function mapZeroConversationDetail(conversation: ZeroConversationLike | undefined) {
  if (!conversation) {
    return undefined;
  }

  const messages = (conversation.messages ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .toSorted((left, right) => asDate(left.createdAt).getTime() - asDate(right.createdAt).getTime())
    .map(mapMessage);

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title ?? "New conversation",
    isPinned: conversation.isPinned,
    isShared: conversation.isShared,
    shareToken: null,
    model: conversation.model ?? null,
    authSource: conversation.authSource ?? null,
    autoApprove: conversation.autoApprove,
    messages,
    createdAt: asDate(conversation.createdAt),
    updatedAt: asDate(conversation.updatedAt),
  };
}

export function mapZeroConversationList(conversations: readonly ZeroConversationLike[]) {
  return conversations.map(mapZeroConversationListItem);
}
