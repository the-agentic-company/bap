import { limitOf, type OperationContext } from "./context";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Chats and messages operations. Each prints a JSON envelope to stdout and relies on
 * the {@link OperationContext} for transport and identity resolution.
 */

export async function listChats(ctx: OperationContext): Promise<void> {
  const { client, directory, values } = ctx;
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/chats?${params}`);
  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const chats = await Promise.all(
    items.map(async (c) => {
      const participant = await directory.getUserSummary(c.attendee_provider_id);
      const latestMessage = await directory.getLatestMessage(String(c.id));
      const latestMessageSender = await directory.getUserSummary(latestMessage?.sender_id);
      const latestText =
        typeof latestMessage?.text === "string" ? latestMessage.text.slice(0, 100) : null;

      return {
        id: c.id,
        participant,
        lastMessage: latestText,
        lastMessageSenderUsername: latestMessageSender?.username ?? null,
        lastMessageSenderName: latestMessageSender?.name ?? null,
        unreadCount: c.unread_count,
        updatedAt: c.updated_at ?? c.timestamp ?? null,
      };
    }),
  );

  console.log(JSON.stringify({ items: chats, cursor: data.cursor }, null, 2));
}

export async function getChat(ctx: OperationContext, chatId: string): Promise<void> {
  const { client, directory } = ctx;
  const data = await client.request<JsonRecord>(
    `/chats/${chatId}?account_id=${client.accountId}`,
  );
  const participant = await directory.getUserSummary(data.attendee_provider_id);
  const latestMessage = await directory.getLatestMessage(chatId);
  const latestMessageSender = await directory.getUserSummary(latestMessage?.sender_id);

  console.log(
    JSON.stringify(
      {
        id: data.id,
        participant,
        lastMessage: typeof latestMessage?.text === "string" ? latestMessage.text : null,
        lastMessageSenderUsername: latestMessageSender?.username ?? null,
        lastMessageSenderName: latestMessageSender?.name ?? null,
        unreadCount: data.unread_count,
        createdAt: data.created_at,
        updatedAt: data.updated_at ?? data.timestamp ?? null,
      },
      null,
      2,
    ),
  );
}

export async function listMessages(ctx: OperationContext, chatId: string): Promise<void> {
  const { client, directory, values } = ctx;
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/chats/${chatId}/messages?${params}`);
  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const messages = await Promise.all(
    items.map(async (m) => {
      const sender = await directory.getUserSummary(m.sender_id ?? m.sender?.provider_id);
      return {
        id: m.id,
        text: m.text,
        senderName: sender?.name ?? null,
        senderUsername: sender?.username ?? null,
        timestamp: m.timestamp,
        isFromMe: Boolean(m.is_from_me ?? m.is_sender),
      };
    }),
  );

  console.log(JSON.stringify({ items: messages, cursor: data.cursor }, null, 2));
}

export async function sendMessage(
  ctx: OperationContext,
  chatId: string,
  text: string,
): Promise<void> {
  const { client } = ctx;
  const data = await client.request(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ account_id: client.accountId, text }),
  });
  console.log(JSON.stringify({ success: true, messageId: data.message_id }, null, 2));
}

export async function startChat(
  ctx: OperationContext,
  attendeeId: string,
  message: string,
): Promise<void> {
  const { client } = ctx;
  const data = await client.request("/chats", {
    method: "POST",
    body: JSON.stringify({
      account_id: client.accountId,
      attendees_ids: [attendeeId],
      text: message,
    }),
  });
  console.log(JSON.stringify({ success: true, chatId: data.chat_id }, null, 2));
}
