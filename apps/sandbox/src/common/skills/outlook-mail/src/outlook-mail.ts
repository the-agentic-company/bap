import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "util";
import { resolveConnectedAccountAccessToken } from "../../../lib/connected-account";
import { prepareEmailHtmlBody } from "../../_shared/email-body-format";

const CLI_ARGS = process.argv.slice(2);

let baseHeaders: Record<string, string> = {};

const { positionals, values } = parseArgs({
  args: CLI_ARGS,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    account: { type: "string" },
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "10" },
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    cc: { type: "string" },
    attachment: { type: "string", multiple: true },
    cursor: { type: "string" },
    all: { type: "boolean" },
  },
});

const [command, ...args] = positionals;

function parseLimit(defaultLimit = 10, maxLimit = 50): number {
  const parsed = Number.parseInt(values.limit ?? String(defaultLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --limit. Expected a positive integer.");
  }
  return Math.min(parsed, maxLimit);
}

function sanitizeSearchQuery(query: string): string {
  return query.replace(/"/g, '\\"');
}

function sanitizeFilterLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

type OutlookFileAttachment = {
  "@odata.type": "#microsoft.graph.fileAttachment";
  contentBytes: string;
  contentType: string;
  name: string;
};

type OutlookPerson = {
  id?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  jobTitle?: string;
  companyName?: string;
  department?: string;
  officeLocation?: string;
  userPrincipalName?: string;
  imAddress?: string;
  personType?: { class?: string; subclass?: string };
  scoredEmailAddresses?: Array<{
    address?: string;
    relevanceScore?: number;
    selectionLikelihood?: string;
  }>;
  phones?: Array<{
    number?: string;
    type?: string;
  }>;
};

type OutlookContact = {
  id?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: Array<{
    address?: string;
    name?: string;
  }>;
  mobilePhone?: string;
  businessPhones?: string[];
  homePhones?: string[];
  jobTitle?: string;
  companyName?: string;
  department?: string;
  officeLocation?: string;
};

function mapMessage(message: {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
}) {
  const from = message.from?.emailAddress;
  return {
    id: message.id,
    subject: message.subject ?? "",
    from: from?.address ?? from?.name ?? "",
    date: message.receivedDateTime ?? "",
    snippet: message.bodyPreview ?? "",
    isRead: message.isRead ?? false,
  };
}

function mapPersonContact(person: OutlookPerson) {
  const emails = (person.scoredEmailAddresses ?? [])
    .map((email) => email.address)
    .filter((email): email is string => Boolean(email));
  const phones = (person.phones ?? [])
    .filter((phone) => phone.number)
    .map((phone) => ({
      type: phone.type ?? "",
      number: phone.number ?? "",
    }));

  return {
    id: person.id,
    name:
      person.displayName ||
      [person.givenName, person.surname].filter(Boolean).join(" ") ||
      emails[0] ||
      "",
    emails,
    primaryEmail: emails[0] ?? person.userPrincipalName ?? "",
    phones,
    jobTitle: person.jobTitle ?? "",
    company: person.companyName ?? "",
    department: person.department ?? "",
    officeLocation: person.officeLocation ?? "",
    userPrincipalName: person.userPrincipalName ?? "",
    imAddress: person.imAddress ?? "",
    type: [person.personType?.class, person.personType?.subclass].filter(Boolean).join("."),
  };
}

function mapOutlookContact(contact: OutlookContact) {
  const emails = (contact.emailAddresses ?? [])
    .map((email) => email.address)
    .filter((email): email is string => Boolean(email));

  return {
    id: contact.id,
    name:
      contact.displayName ||
      [contact.givenName, contact.surname].filter(Boolean).join(" ") ||
      emails[0] ||
      "",
    emails,
    primaryEmail: emails[0] ?? "",
    mobilePhone: contact.mobilePhone ?? "",
    businessPhones: contact.businessPhones ?? [],
    homePhones: contact.homePhones ?? [],
    jobTitle: contact.jobTitle ?? "",
    company: contact.companyName ?? "",
    department: contact.department ?? "",
    officeLocation: contact.officeLocation ?? "",
  };
}

function encodeCursor(nextLink: string): string {
  return Buffer.from(nextLink, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid --cursor. Use the cursor returned by outlook-mail contacts list.");
  }

  if (!decoded.startsWith("https://graph.microsoft.com/v1.0/")) {
    throw new Error("Invalid --cursor. Use the cursor returned by outlook-mail contacts list.");
  }

  return decoded;
}

function quoteShellValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function inferAttachmentMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".csv":
      return "text/csv";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".gif":
      return "image/gif";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".json":
      return "application/json";
    case ".md":
    case ".txt":
      return "text/plain";
    case ".ods":
      return "application/vnd.oasis.opendocument.spreadsheet";
    case ".odt":
      return "application/vnd.oasis.opendocument.text";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".rtf":
      return "application/rtf";
    case ".webp":
      return "image/webp";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function sanitizeAttachmentName(filename: string): string {
  return filename.replaceAll(/["\r\n]/g, "_");
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

async function readAttachment(filePath: string): Promise<OutlookFileAttachment> {
  try {
    const content = await readFile(filePath);
    return {
      "@odata.type": "#microsoft.graph.fileAttachment",
      contentBytes: content.toString("base64"),
      contentType: inferAttachmentMimeType(filePath),
      name: sanitizeAttachmentName(basename(filePath)),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read attachment "${filePath}": ${detail}`, {
      cause: error,
    });
  }
}

async function graphRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("https://graph.microsoft.com/")
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init?.headers ? (init.headers as Record<string, string>) : {}),
    },
  });
}

async function listEmails() {
  if (values.query?.trim()) {
    throw new Error("outlook-mail list does not accept --query. Use outlook-mail search instead.");
  }

  const top = parseLimit();
  const params = new URLSearchParams({
    $top: String(top),
    $select: "id,subject,from,receivedDateTime,bodyPreview,isRead",
    $orderby: "receivedDateTime desc",
  });

  const res = await graphRequest(`/me/messages?${params.toString()}`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      bodyPreview?: string;
      receivedDateTime?: string;
      isRead?: boolean;
      from?: { emailAddress?: { address?: string; name?: string } };
    }>;
  };

  const items = (payload.value ?? []).map(mapMessage);
  if (items.length === 0) {
    console.log("No emails found.");
    return;
  }

  console.log(JSON.stringify(items, null, 2));
}

async function searchEmails() {
  const query = values.query?.trim();
  if (!query) {
    throw new Error("Required: outlook-mail search --query <search>");
  }

  const top = parseLimit();
  const params = new URLSearchParams({
    $top: String(top),
    $select: "id,subject,from,receivedDateTime,bodyPreview,isRead",
    $orderby: "receivedDateTime desc",
    $search: `"${sanitizeSearchQuery(query)}"`,
  });

  const res = await graphRequest(`/me/messages?${params.toString()}`, {
    method: "GET",
    headers: { ConsistencyLevel: "eventual" },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      bodyPreview?: string;
      receivedDateTime?: string;
      isRead?: boolean;
      from?: { emailAddress?: { address?: string; name?: string } };
    }>;
  };

  const items = (payload.value ?? []).map(mapMessage);
  if (items.length === 0) {
    console.log("No emails found.");
    return;
  }

  console.log(JSON.stringify(items, null, 2));
}

async function getEmail(messageId: string) {
  if (!messageId) {
    throw new Error("Required: outlook-mail get <messageId>");
  }

  const params = new URLSearchParams({
    $select:
      "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,isRead,internetMessageId",
  });

  const res = await graphRequest(`/me/messages/${encodeURIComponent(messageId)}?${params}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const email = (await res.json()) as {
    id?: string;
    subject?: string;
    receivedDateTime?: string;
    isRead?: boolean;
    bodyPreview?: string;
    body?: { content?: string };
    from?: { emailAddress?: { address?: string; name?: string } };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  };

  console.log(
    JSON.stringify(
      {
        id: email.id,
        subject: email.subject ?? "",
        from: email.from?.emailAddress?.address ?? email.from?.emailAddress?.name ?? "",
        to: (email.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
        cc: (email.ccRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
        date: email.receivedDateTime ?? "",
        isRead: email.isRead ?? false,
        snippet: email.bodyPreview ?? "",
        body: (email.body?.content ?? "").slice(0, 10000),
      },
      null,
      2,
    ),
  );
}

async function countUnread() {
  parseLimit();
  const params = new URLSearchParams({
    $top: "1",
    $count: "true",
    $select: "id",
  });

  if (values.query) {
    params.set(
      "$filter",
      `isRead eq false and contains(subject,'${sanitizeFilterLiteral(values.query)}')`,
    );
  } else {
    params.set("$filter", "isRead eq false");
  }

  const res = await graphRequest(`/me/messages?${params.toString()}`, {
    headers: { ConsistencyLevel: "eventual" },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    "@odata.count"?: number;
  };

  console.log(`Unread emails: ${payload["@odata.count"] ?? 0}`);
}

async function findContact() {
  const query = values.query?.trim();
  if (!query) {
    throw new Error("Required: outlook-mail contact --query <name-or-email>");
  }

  const top = parseLimit();
  const params = new URLSearchParams({
    $search: sanitizeSearchQuery(query),
    $top: String(top),
  });

  const res = await graphRequest(`/me/people?${params.toString()}`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    value?: OutlookPerson[];
  };

  const contacts = (payload.value ?? []).map(mapPersonContact);
  if (contacts.length === 0) {
    console.log("No contacts found.");
    return;
  }

  console.log(JSON.stringify(contacts, null, 2));
}

async function listContacts() {
  const subcommand = args[0];
  if (subcommand !== "list") {
    throw new Error("Required: outlook-mail contacts list");
  }

  const pageSize = parseLimit(100, 999);
  const contacts: ReturnType<typeof mapOutlookContact>[] = [];
  let nextLink: string | undefined;
  let requestUrl: string | undefined;

  if (values.cursor) {
    requestUrl = decodeCursor(values.cursor);
  } else {
    const params = new URLSearchParams({
      $top: String(pageSize),
      $select:
        "id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,homePhones,jobTitle,companyName,department,officeLocation",
    });
    requestUrl = `/me/contacts?${params.toString()}`;
  }

  do {
    const res = await graphRequest(requestUrl, { method: "GET" });
    if (!res.ok) {
      throw new Error(await res.text());
    }

    const payload = (await res.json()) as {
      value?: OutlookContact[];
      "@odata.nextLink"?: string;
    };

    contacts.push(...(payload.value ?? []).map(mapOutlookContact));
    nextLink = payload["@odata.nextLink"];
    requestUrl = nextLink;
  } while (values.all && requestUrl);

  const nextCursor = values.all || !nextLink ? undefined : encodeCursor(nextLink);
  console.log(
    JSON.stringify(
      {
        contacts,
        count: contacts.length,
        hasMore: Boolean(nextCursor),
        ...(nextCursor
          ? {
              nextCursor,
              nextCommand: `outlook-mail contacts list --cursor ${quoteShellValue(nextCursor)}`,
            }
          : {}),
      },
      null,
      2,
    ),
  );
}

async function sendEmail() {
  const message = await buildOutgoingMessage();
  const res = await graphRequest("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  console.log("Email sent.");
}

async function buildOutgoingMessage() {
  if (!values.to || !values.subject || !values.body) {
    throw new Error("Required: --to, --subject, --body");
  }

  const { html } = prepareEmailHtmlBody(values.body);
  const attachments = await Promise.all(getAttachmentPaths().map((path) => readAttachment(path)));

  return {
    subject: values.subject,
    body: {
      contentType: "HTML",
      content: html,
    },
    toRecipients: [
      {
        emailAddress: { address: values.to },
      },
    ],
    ...(values.cc
      ? {
          ccRecipients: [
            {
              emailAddress: { address: values.cc },
            },
          ],
        }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

async function draftEmail() {
  const message = await buildOutgoingMessage();
  const res = await graphRequest("/me/messages", {
    method: "POST",
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const { id } = (await res.json()) as { id?: string };
  console.log(id ? `Email draft created. Draft ID: ${id}` : "Email draft created.");
}

function showHelp() {
  console.log(`Outlook Mail CLI - Commands:
  list [-l limit]                    List emails
  search -q <query> [-l limit]       Search mailbox
  get <messageId>                    Get email content
  unread [-q query] [-l limit]       Count unread emails
  contact -q <query> [-l limit]      Find a person/contact by name or email
  contacts list [-l limit] [--cursor <cursor>] [--all]
                                     List Outlook contacts with cursor pagination
  send --to <email> --subject <subject> --body <body> [--cc <email>] [--attachment <path>]...
  draft --to <email> --subject <subject> --body <body> [--cc <email>] [--attachment <path>]...

Options:
  --account <label>                  Select an Account Label when multiple Connected Accounts exist
  -h, --help                         Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    const token = await resolveConnectedAccountAccessToken({
      integrationType: "outlook",
      accountLabel: values.account,
      fallbackEnvVar: "OUTLOOK_ACCESS_TOKEN",
    });
    baseHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    switch (command) {
      case "list":
        await listEmails();
        break;
      case "search":
        await searchEmails();
        break;
      case "get":
        await getEmail(args[0]);
        break;
      case "unread":
        await countUnread();
        break;
      case "contact":
        await findContact();
        break;
      case "contacts":
        await listContacts();
        break;
      case "send":
        await sendEmail();
        break;
      case "draft":
        await draftEmail();
        break;
      default:
        showHelp();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
