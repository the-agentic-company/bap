import { parseArgs } from "util";
import { resolveConnectedAccountAccessToken } from "../../../lib/connected-account";
import { buildRawEmail } from "./build-gmail-email";
import { formatEmailDate } from "./format-email-date";

const CLI_ARGS = process.argv.slice(2);
const USER_TIMEZONE = process.env.CMDCLAW_USER_TIMEZONE?.trim();
let headers: Record<string, string> = {};

const { positionals, values } = parseArgs({
  args: CLI_ARGS,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    account: { type: "string" },
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "10" },
    scope: { type: "string" },
    "include-spam-trash": { type: "boolean", default: false },
    unread: { type: "boolean", default: false },
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    cc: { type: "string" },
    attachment: { type: "string", multiple: true },
  },
});

const [command, ...args] = positionals;

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailPart;
};
type MailScope = "inbox" | "all" | "strict-all";

function buildGmailThreadUrl(threadId?: string | null): string | null {
  if (!threadId) {
    return null;
  }
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function buildGmailDraftUrl(draftId?: string | null): string | null {
  if (!draftId) {
    return null;
  }
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`;
}

function extractBody(part: GmailPart): string {
  if (part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  if (part.parts) {
    for (const p of part.parts) {
      if (p.mimeType === "text/plain") {
        return extractBody(p);
      }
    }
    for (const p of part.parts) {
      const r = extractBody(p);
      if (r) {
        return r;
      }
    }
  }
  return "";
}

function parseLimit(): string {
  const parsed = Number.parseInt(values.limit ?? "10", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --limit. Expected a positive integer.");
  }
  return String(Math.min(parsed, 50));
}

function getScope(defaultScope: MailScope = "inbox"): MailScope {
  const scope = values.scope ?? defaultScope;
  if (scope === "inbox" || scope === "all" || scope === "strict-all") {
    return scope;
  }
  throw new Error(`Invalid --scope "${scope}". Expected one of: inbox, all, strict-all.`);
}

function buildMessageListParams(
  maxResults: string,
  query?: string,
  defaultScope: MailScope = "inbox",
) {
  const scope = getScope(defaultScope);
  const params = new URLSearchParams({ maxResults });
  if (query) {
    params.set("q", query);
  }
  if (scope === "inbox") {
    params.append("labelIds", "INBOX");
  }
  return { params, includeSpamTrash: values["include-spam-trash"] || scope === "strict-all" };
}

async function fetchMessageDetails(messages: Array<{ id: string }>) {
  const details = await Promise.all(
    messages.map(async (msg: { id: string }) => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers },
      );
      return res.ok ? res.json() : null;
    }),
  );

  return details.filter(Boolean).map((e) => {
    const msg = e as GmailMessage;
    const getHeader = (name: string) =>
      msg.payload?.headers?.find((h) => h.name === name)?.value || "";
    return {
      id: msg.id,
      subject: getHeader("Subject"),
      from: getHeader("From"),
      date: formatEmailDate(getHeader("Date"), USER_TIMEZONE),
      snippet: msg.snippet,
    };
  });
}

async function listEmails() {
  if (values.query?.trim()) {
    throw new Error("google-gmail list does not accept --query. Use google-gmail search instead.");
  }

  const config = buildMessageListParams(parseLimit());

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
    { headers },
  );
  if (!listRes.ok) {
    throw new Error(await listRes.text());
  }

  const { messages = [] } = (await listRes.json()) as { messages?: Array<{ id: string }> };
  if (messages.length === 0) {
    return console.log("No emails found.");
  }

  const emails = await fetchMessageDetails(messages);

  console.log(JSON.stringify(emails, null, 2));
}

async function searchEmails() {
  const query = values.query?.trim();
  if (!query) {
    throw new Error("Required: google-gmail search --query <search>");
  }

  const config = buildMessageListParams(parseLimit(), query, "all");

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
    { headers },
  );
  if (!listRes.ok) {
    throw new Error(await listRes.text());
  }

  const { messages = [] } = (await listRes.json()) as { messages?: Array<{ id: string }> };
  if (messages.length === 0) {
    return console.log("No emails found.");
  }

  const emails = await fetchMessageDetails(messages);

  console.log(JSON.stringify(emails, null, 2));
}

async function getEmail(messageId: string) {
  if (!messageId) {
    throw new Error("Required: google-gmail get <messageId>");
  }

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const email = (await res.json()) as GmailMessage;
  const getHeader = (name: string) =>
    email.payload?.headers?.find((h) => h.name === name)?.value || "";

  console.log(
    JSON.stringify(
      {
        id: email.id,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: formatEmailDate(getHeader("Date"), USER_TIMEZONE),
        body: extractBody(email.payload ?? {}).slice(0, 10000),
      },
      null,
      2,
    ),
  );
}

async function latestEmail() {
  const query = values.unread
    ? [values.query, "is:unread"].filter(Boolean).join(" ")
    : values.query;
  const config = buildMessageListParams("1", query);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const { messages = [] } = (await res.json()) as { messages?: Array<{ id: string }> };
  if (messages.length === 0) {
    return console.log("No emails found.");
  }

  const [email] = await fetchMessageDetails(messages);
  console.log(JSON.stringify(email, null, 2));
}

async function countUnread() {
  const query = [values.query, "is:unread"].filter(Boolean).join(" ");
  const config = buildMessageListParams("1", query);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${config.params}&includeSpamTrash=${String(config.includeSpamTrash)}`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const { resultSizeEstimate = 0 } = (await res.json()) as { resultSizeEstimate?: number };
  console.log(`Unread emails: ${resultSizeEstimate}`);
}

function getAttachmentPaths(): string[] {
  const attachmentValue = values.attachment;
  if (typeof attachmentValue === "string") {
    return [attachmentValue];
  }
  if (Array.isArray(attachmentValue)) {
    return attachmentValue.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

async function buildOutgoingEmail() {
  if (!values.to || !values.subject || !values.body) {
    throw new Error("Required: --to, --subject, --body");
  }

  return buildRawEmail({
    attachmentPaths: getAttachmentPaths(),
    body: values.body,
    cc: values.cc,
    subject: values.subject,
    to: values.to,
  });
}

async function sendEmail() {
  const raw = await buildOutgoingEmail();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
  const { id, threadId } = (await res.json()) as { id?: string; threadId?: string };
  const url = buildGmailThreadUrl(threadId);
  console.log(`Email sent. Message ID: ${id}`);
  if (url) {
    console.log(`URL: ${url}`);
  }
}

async function draftEmail() {
  const raw = await buildOutgoingEmail();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
  const { id, message } = (await res.json()) as { id?: string; message?: { id?: string } };
  const url = buildGmailDraftUrl(message?.id);
  console.log(`Email draft created. Draft ID: ${id}`);
  if (message?.id) {
    console.log(`Message ID: ${message.id}`);
  }
  if (url) {
    console.log(`URL: ${url}`);
  }
}

function showHelp() {
  console.log(`Google Gmail CLI - Commands:
  list [-l limit] [--scope inbox|all|strict-all] [--include-spam-trash]
                              List emails (default scope: inbox)
  search -q <query> [-l limit] [--scope inbox|all|strict-all] [--include-spam-trash]
                              Search mailbox (default scope: all)
  latest [-q query] [--unread] [--scope inbox|all|strict-all] [--include-spam-trash]
                              Get latest email (default scope: inbox)
  get <messageId>             Get email content
  unread [-q query] [--scope inbox|all|strict-all] [--include-spam-trash]
                              Count unread emails (default scope: inbox)
  send --to <email> --subject <subject> --body <body> [--cc <email>] [--attachment <path>]...
  draft --to <email> --subject <subject> --body <body> [--cc <email>] [--attachment <path>]...

Options:
  --account <label>           Select an Account Label when multiple Connected Accounts exist
  -h, --help                  Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    const token = await resolveConnectedAccountAccessToken({
      integrationType: "google_gmail",
      accountLabel: values.account,
      fallbackEnvVar: "GMAIL_ACCESS_TOKEN",
    });
    headers = { Authorization: `Bearer ${token}` };

    switch (command) {
      case "list":
        await listEmails();
        break;
      case "search":
        await searchEmails();
        break;
      case "latest":
        await latestEmail();
        break;
      case "get":
        await getEmail(args[0]);
        break;
      case "unread":
        await countUnread();
        break;
      case "send":
        await sendEmail();
        break;
      case "draft":
        await draftEmail();
        break;
      default:
        showHelp();
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
