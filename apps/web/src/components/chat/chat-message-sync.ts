import type { AttachmentData, Message } from "./message-list";

function isOptimisticMessage(message: Message): boolean {
  return message.id.startsWith("temp-");
}

function getAttachmentSignature(attachments: AttachmentData[] | undefined): string {
  if (!attachments || attachments.length === 0) {
    return "";
  }
  return attachments.map((attachment) => `${attachment.name}:${attachment.mimeType}`).join("|");
}

function hasAttachments(message: Message): boolean {
  return (message.attachments?.length ?? 0) > 0;
}

function hasPersistedEquivalentMessage(message: Message, persistedMessages: Message[]): boolean {
  const attachmentSignature = getAttachmentSignature(message.attachments);
  return persistedMessages.some(
    (persisted) =>
      persisted.role === message.role &&
      persisted.content === message.content &&
      getAttachmentSignature(persisted.attachments) === attachmentSignature,
  );
}

type PendingUserAttachmentSource = {
  message: Message;
  isOptimistic: boolean;
};

function getCurrentPersistedMessageIds(currentMessages: Message[]): Set<string> {
  return new Set(
    currentMessages.filter((message) => !isOptimisticMessage(message)).map((message) => message.id),
  );
}

function applyPendingUserAttachments(
  persistedMessages: Message[],
  currentMessages: Message[],
): Message[] {
  const pendingUserAttachmentSources: PendingUserAttachmentSource[] = currentMessages
    .filter((message) => message.role === "user" && hasAttachments(message))
    .map((message) => ({
      message,
      isOptimistic: isOptimisticMessage(message),
    }));

  if (pendingUserAttachmentSources.length === 0) {
    return persistedMessages;
  }

  const currentPersistedMessageIds = getCurrentPersistedMessageIds(currentMessages);
  const attachmentOverridesByPersistedId = new Map<string, AttachmentData[]>();

  for (const source of pendingUserAttachmentSources) {
    if (!source.isOptimistic) {
      const matchingPersistedMessage = persistedMessages.find(
        (persisted) =>
          persisted.id === source.message.id &&
          persisted.role === "user" &&
          !hasAttachments(persisted),
      );
      if (matchingPersistedMessage && source.message.attachments) {
        attachmentOverridesByPersistedId.set(
          matchingPersistedMessage.id,
          source.message.attachments,
        );
      }
      continue;
    }

    const matchingPersistedMessage = persistedMessages.find(
      (persisted) =>
        persisted.role === "user" &&
        persisted.content === source.message.content &&
        !hasAttachments(persisted) &&
        !currentPersistedMessageIds.has(persisted.id) &&
        !attachmentOverridesByPersistedId.has(persisted.id),
    );

    if (matchingPersistedMessage && source.message.attachments) {
      attachmentOverridesByPersistedId.set(matchingPersistedMessage.id, source.message.attachments);
    }
  }

  if (attachmentOverridesByPersistedId.size === 0) {
    return persistedMessages;
  }

  return persistedMessages.map((persisted) => {
    const attachments = attachmentOverridesByPersistedId.get(persisted.id);
    return attachments ? { ...persisted, attachments } : persisted;
  });
}

export function mergePersistedConversationMessages(params: {
  currentMessages: Message[];
  persistedMessages: Message[];
  preserveOptimisticMessages: boolean;
}): Message[] {
  const persistedMessages = applyPendingUserAttachments(
    params.persistedMessages,
    params.currentMessages,
  );

  if (!params.preserveOptimisticMessages) {
    return persistedMessages;
  }

  const unsyncedOptimisticMessages = params.currentMessages.filter(
    (message) =>
      isOptimisticMessage(message) && !hasPersistedEquivalentMessage(message, persistedMessages),
  );

  if (unsyncedOptimisticMessages.length === 0) {
    return persistedMessages;
  }

  return [...persistedMessages, ...unsyncedOptimisticMessages];
}
