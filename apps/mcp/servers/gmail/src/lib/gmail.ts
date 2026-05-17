import { buildRawEmail } from "./build-gmail-email";
import { formatEmailDate } from "./format-email-date";

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id?: string;
  snippet?: string;
  payload?: GmailPart;
};

type MailScope = "inbox" | "all" | "strict-all";

type GmailListParams = {
  limit?: number;
  scope?: MailScope;
  includeSpamTrash?: boolean;
};

type GmailSearchParams = GmailListParams & {
  query: string;
};

type GmailLatestParams = {
  query?: string;
  unread?: boolean;
  scope?: MailScope;
  includeSpamTrash?: boolean;
};

type GmailUnreadParams = {
  query?: string;
  scope?: MailScope;
  includeSpamTrash?: boolean;
};

type GmailSendParams = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  attachmentPaths?: string[];
};

type GmailClient = ReturnType<typeof createGmailClient>;

function extractBody(part: GmailPart): string {
  if (part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  if (part.parts) {
    for (const currentPart of part.parts) {
      if (currentPart.mimeType === "text/plain") {
        return extractBody(currentPart);
      }
    }
    for (const currentPart of part.parts) {
      const body = extractBody(currentPart);
      if (body) {
        return body;
      }
    }
  }
  return "";
}

function parseLimit(limit = 10): string {
  const parsed = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid limit. Expected a positive integer.");
  }
  return String(Math.min(parsed, 50));
}

function getScope(scope: MailScope | undefined, defaultScope: MailScope): MailScope {
  const resolvedScope = scope ?? defaultScope;
  if (resolvedScope === "inbox" || resolvedScope === "all" || resolvedScope === "strict-all") {
    return resolvedScope;
  }
  throw new Error(
    `Invalid scope "${resolvedScope}". Expected one of: inbox, all, strict-all.`,
  );
}

function buildMessageListParams(input: {
  limit: number;
  query?: string;
  scope?: MailScope;
  defaultScope: MailScope;
  includeSpamTrash?: boolean;
}) {
  const scope = getScope(input.scope, input.defaultScope);
  const params = new URLSearchParams({ maxResults: parseLimit(input.limit) });
  if (input.query) {
    params.set("q", input.query);
  }
  if (scope === "inbox") {
    params.append("labelIds", "INBOX");
  }
  return {
    params,
    includeSpamTrash: input.includeSpamTrash || scope === "strict-all",
  };
}

export function createGmailClient(accessToken: string, timezone?: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  async function fetchMessageDetails(messages: Array<{ id: string }>) {
    const details = await Promise.all(
      messages.map(async (message) => {
        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers },
        );
        return response.ok ? response.json() : null;
      }),
    );

    return details.filter(Boolean).map((entry) => {
      const message = entry as GmailMessage;
      const getHeader = (name: string) =>
        message.payload?.headers?.find((header) => header.name === name)?.value || "";

      return {
        id: message.id ?? "",
        subject: getHeader("Subject"),
        from: getHeader("From"),
        date: formatEmailDate(getHeader("Date"), timezone),
        snippet: message.snippet ?? "",
      };
    });
  }

  async function listMessages(params: GmailListParams) {
    const config = buildMessageListParams({
      limit: params.limit ?? 10,
      scope: params.scope,
      includeSpamTrash: params.includeSpamTrash,
      defaultScope: "inbox",
    });
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const { messages = [] } = (await response.json()) as { messages?: Array<{ id: string }> };
    return {
      messages: messages.length > 0 ? await fetchMessageDetails(messages) : [],
    };
  }

  async function searchMessages(params: GmailSearchParams) {
    const query = params.query.trim();
    if (!query) {
      throw new Error("Query is required.");
    }

    const config = buildMessageListParams({
      limit: params.limit ?? 10,
      query,
      scope: params.scope,
      includeSpamTrash: params.includeSpamTrash,
      defaultScope: "all",
    });
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const { messages = [] } = (await response.json()) as { messages?: Array<{ id: string }> };
    return {
      messages: messages.length > 0 ? await fetchMessageDetails(messages) : [],
    };
  }

  async function latestMessage(params: GmailLatestParams) {
    const query = params.unread
      ? [params.query?.trim(), "is:unread"].filter(Boolean).join(" ")
      : params.query?.trim();
    const config = buildMessageListParams({
      limit: 1,
      query,
      scope: params.scope,
      includeSpamTrash: params.includeSpamTrash,
      defaultScope: "inbox",
    });
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const { messages = [] } = (await response.json()) as { messages?: Array<{ id: string }> };
    const [message] = messages.length > 0 ? await fetchMessageDetails(messages) : [];
    return { message: message ?? null };
  }

  async function getMessage(messageId: string) {
    if (!messageId) {
      throw new Error("messageId is required.");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const message = (await response.json()) as GmailMessage;
    const getHeader = (name: string) =>
      message.payload?.headers?.find((header) => header.name === name)?.value || "";

    return {
      message: {
        id: message.id ?? "",
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: formatEmailDate(getHeader("Date"), timezone),
        body: extractBody(message.payload ?? {}).slice(0, 10_000),
      },
    };
  }

  async function countUnread(params: GmailUnreadParams) {
    const query = [params.query?.trim(), "is:unread"].filter(Boolean).join(" ");
    const config = buildMessageListParams({
      limit: 1,
      query,
      scope: params.scope,
      includeSpamTrash: params.includeSpamTrash,
      defaultScope: "inbox",
    });
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const { resultSizeEstimate = 0 } = (await response.json()) as {
      resultSizeEstimate?: number;
    };
    return { count: resultSizeEstimate };
  }

  async function buildOutgoingEmail(params: GmailSendParams) {
    if (!params.to || !params.subject || !params.body) {
      throw new Error("to, subject, and body are required.");
    }

    return buildRawEmail({
      attachmentPaths: params.attachmentPaths?.filter(Boolean) ?? [],
      body: params.body,
      cc: params.cc,
      subject: params.subject,
      to: params.to,
    });
  }

  async function sendMessage(params: GmailSendParams) {
    const raw = await buildOutgoingEmail(params);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as { id?: string };
    return {
      id: payload.id ?? null,
      status: "sent" as const,
    };
  }

  async function createDraft(params: GmailSendParams) {
    const raw = await buildOutgoingEmail(params);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as { id?: string };
    return {
      id: payload.id ?? null,
      status: "drafted" as const,
    };
  }

  return {
    listMessages,
    searchMessages,
    latestMessage,
    getMessage,
    countUnread,
    sendMessage,
    createDraft,
  };
}
