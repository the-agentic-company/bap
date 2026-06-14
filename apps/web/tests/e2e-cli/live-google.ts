import { expectedUserEmail } from "./live-config";
import { callCliLiveTestingApi } from "./testing-api";

type GmailMessageRef = {
  id?: string;
};

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailListResponse = {
  messages?: GmailMessageRef[];
};

type GmailMessageResponse = {
  id?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
  };
};

type GoogleCalendarEventDateTime = {
  dateTime?: string;
  date?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  start?: GoogleCalendarEventDateTime;
};

type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
};

type GoogleDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  trashed?: boolean;
};

type GoogleDriveFilesResponse = {
  files?: GoogleDriveFile[];
};

async function gmailApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function parseGmailInternalDate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

function readHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) {
    return "";
  }
  const match = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value?.trim() ?? "";
}

export async function getGmailAccessTokenForExpectedUser(args?: {
  accountLabel?: string;
}): Promise<string> {
  const { token: gmailToken } = await callCliLiveTestingApi<{ token: string | null }>({
    action: "integration-token:get",
    email: expectedUserEmail,
    integrationType: "google_gmail",
    ...(args?.accountLabel ? { accountLabel: args.accountLabel } : {}),
  });

  if (!gmailToken) {
    const accountLabelHint = args?.accountLabel ? ` with account label ${args.accountLabel}` : "";
    throw new Error(
      `Gmail is not connected for ${expectedUserEmail}${accountLabelHint}. Connect Gmail in app integrations before running this test.`,
    );
  }

  return gmailToken;
}

async function googleCalendarApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://www.googleapis.com/calendar/v3/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Calendar API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function googleDriveApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://www.googleapis.com/drive/v3/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Drive API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeCalendarStart(start: GoogleCalendarEventDateTime | undefined): string {
  if (!start) {
    return "";
  }
  return (start.dateTime ?? start.date ?? "").trim();
}

export async function getGoogleCalendarAccessTokenForExpectedUser(): Promise<string> {
  const { token: googleCalendarToken } = await callCliLiveTestingApi<{ token: string | null }>({
    action: "integration-token:get",
    email: expectedUserEmail,
    integrationType: "google_calendar",
  });

  if (!googleCalendarToken) {
    throw new Error(
      `Google Calendar is not connected for ${expectedUserEmail}. Connect Google Calendar in app integrations before running this test.`,
    );
  }

  return googleCalendarToken;
}

export async function readUpcomingGoogleCalendarEvent(args: {
  token: string;
  calendarId?: string;
}): Promise<{ id: string; summary: string; start: string }> {
  const encodedCalendarId = encodeURIComponent(args.calendarId ?? "primary");
  const events = await googleCalendarApi<GoogleCalendarEventsResponse>(
    args.token,
    `calendars/${encodedCalendarId}/events`,
    {
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
    },
  );

  const readableEvent = (events.items ?? []).find((event) => {
    const id = event.id?.trim() ?? "";
    const summary = event.summary?.replace(/\s+/g, " ").trim() ?? "";
    const start = normalizeCalendarStart(event.start);
    return Boolean(id && summary && start);
  });

  if (!readableEvent?.id) {
    throw new Error("Could not find a readable upcoming event in Google Calendar.");
  }

  return {
    id: readableEvent.id,
    summary: readableEvent.summary!.replace(/\s+/g, " ").trim(),
    start: normalizeCalendarStart(readableEvent.start),
  };
}

export async function getGoogleDriveAccessTokenForExpectedUser(): Promise<string> {
  const { token: googleDriveToken } = await callCliLiveTestingApi<{ token: string | null }>({
    action: "integration-token:get",
    email: expectedUserEmail,
    integrationType: "google_drive",
  });

  if (!googleDriveToken) {
    throw new Error(
      `Google Drive is not connected for ${expectedUserEmail}. Connect Google Drive in app integrations before running this test.`,
    );
  }

  return googleDriveToken;
}

export async function readLatestGoogleDriveFile(args: {
  token: string;
}): Promise<{ id: string; name: string }> {
  const files = await googleDriveApi<GoogleDriveFilesResponse>(args.token, "files", {
    pageSize: 10,
    orderBy: "modifiedTime desc",
    q: "trashed=false",
    fields: "files(id,name,mimeType,modifiedTime,trashed)",
  });

  const readableFile = (files.files ?? []).find((file) => {
    const id = file.id?.trim() ?? "";
    const name = file.name?.replace(/\s+/g, " ").trim() ?? "";
    return Boolean(id && name && !file.trashed);
  });

  if (!readableFile?.id) {
    throw new Error("Could not find a readable file in Google Drive.");
  }

  return {
    id: readableFile.id,
    name: readableFile.name!.replace(/\s+/g, " ").trim(),
  };
}

export async function readLatestInboxMessage(args: {
  token: string;
}): Promise<{ id: string; subject: string; internalDateMs: number }> {
  const list = await gmailApi<GmailListResponse>(args.token, "messages", {
    maxResults: 10,
    labelIds: "INBOX",
    q: "in:inbox",
  });

  const messages = (list.messages ?? []).filter((message): message is { id: string } =>
    Boolean(message.id),
  );
  const detailsList = await Promise.all(
    messages.map(async (message) => ({
      id: message.id,
      details: await gmailApi<GmailMessageResponse>(args.token, `messages/${message.id}`, {
        format: "metadata",
        metadataHeaders: "Subject",
      }),
    })),
  );

  for (const entry of detailsList) {
    const subject = readHeader(entry.details.payload?.headers, "Subject");
    if (!subject) {
      continue;
    }
    return {
      id: entry.id,
      subject: subject.replace(/\s+/g, " ").trim(),
      internalDateMs: parseGmailInternalDate(entry.details.internalDate),
    };
  }

  throw new Error("Could not find a readable latest message in Gmail inbox.");
}
