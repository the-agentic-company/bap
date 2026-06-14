import {
  echoPrefix,
  expectedUserEmail,
  normalizeWhitespace,
  slackPollIntervalMs,
  sourceChannelName,
  targetChannelName,
} from "./live-config";
import { callCliLiveTestingApi } from "./testing-api";

type SlackMessage = {
  ts?: string;
  text?: string;
  subtype?: string;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  message?: SlackMessage;
  channels?: Array<{ id?: string; name?: string }>;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

function normalizeChannelName(value: string): string {
  return value.replace(/^#/, "").trim().toLowerCase();
}

function parseSlackTs(value: string): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, string | number | boolean>,
): Promise<SlackApiResponse> {
  const isGet = method === "conversations.list" || method === "conversations.history";
  const query = new URLSearchParams(
    Object.entries(body).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = isGet
    ? `https://slack.com/api/${method}?${query}`
    : `https://slack.com/api/${method}`;

  const response = await fetch(url, {
    method: isGet ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isGet ? {} : { "Content-Type": "application/json" }),
    },
    ...(isGet ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(`Slack API ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack API ${method} error: ${String(payload.error ?? "unknown")} payload=${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

export async function resolveChannelId(token: string, channelName: string): Promise<string> {
  const target = normalizeChannelName(channelName);

  const findWithCursor = async (cursor?: string): Promise<string | null> => {
    const payload = await slackApi(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const channel = (payload.channels ?? []).find((candidate) => {
      const name = candidate.name;
      if (!name) {
        return false;
      }
      return normalizeChannelName(name) === target;
    });

    if (channel?.id) {
      return channel.id;
    }

    const nextCursor = payload.response_metadata?.next_cursor?.trim() ?? "";
    if (!nextCursor) {
      return null;
    }

    return findWithCursor(nextCursor);
  };

  const channelId = await findWithCursor();
  if (channelId) {
    return channelId;
  }

  throw new Error(`Slack channel not found: #${target}`);
}

export async function readLatestMessage(
  token: string,
  channelId: string,
): Promise<{ ts: string; text: string }> {
  const message = await readLatestMessageOrNull(token, channelId);
  if (!message) {
    throw new Error("Could not find a readable latest message in Slack channel history.");
  }
  return message;
}

export async function readLatestMessageOrNull(
  token: string,
  channelId: string,
): Promise<{ ts: string; text: string } | null> {
  const payload = await slackApi(token, "conversations.history", {
    channel: channelId,
    limit: 30,
  });

  const message = (payload.messages ?? []).find((candidate) => {
    if (!candidate.ts || !candidate.text) {
      return false;
    }
    if (candidate.subtype && candidate.subtype !== "thread_broadcast") {
      return false;
    }
    return normalizeWhitespace(candidate.text).length > 0;
  });

  if (!message?.ts || !message.text) {
    return null;
  }

  return { ts: message.ts, text: normalizeWhitespace(message.text) };
}

export async function postSlackMessage(
  token: string,
  channelId: string,
  text: string,
): Promise<{ ts: string; text: string }> {
  const payload = await slackApi(token, "chat.postMessage", {
    channel: channelId,
    text,
  });

  const ts = payload.ts?.trim() ?? "";
  if (!ts) {
    throw new Error("Slack API chat.postMessage succeeded without a message timestamp.");
  }

  return {
    ts,
    text: normalizeWhitespace(payload.message?.text ?? text),
  };
}

export async function findEchoMessageAfterTs(args: {
  token: string;
  channelId: string;
  afterTs: number;
  marker: string;
}): Promise<string | null> {
  const payload = await slackApi(args.token, "conversations.history", {
    channel: args.channelId,
    limit: 100,
  });

  const match = (payload.messages ?? []).find((candidate) => {
    const text = normalizeWhitespace(candidate.text ?? "");
    const ts = parseSlackTs(candidate.ts ?? "0");
    if (!text || ts <= args.afterTs) {
      return false;
    }
    return text.includes(args.marker) && text.includes(echoPrefix);
  });

  return match?.text ? normalizeWhitespace(match.text) : null;
}

export async function pollSlackEchoMessage(args: {
  token: string;
  channelId: string;
  afterTs: number;
  marker: string;
  deadlineMs: number;
}): Promise<string> {
  const found = await findEchoMessageAfterTs(args);
  if (found) {
    return found;
  }
  if (Date.now() >= args.deadlineMs) {
    return "";
  }
  await new Promise((resolveSleep) => setTimeout(resolveSleep, slackPollIntervalMs));
  return pollSlackEchoMessage(args);
}

export function buildSlackPrompt(args: { marker: string; sourceText?: string }): string {
  const readInstruction = args.sourceText
    ? [
        `Use Slack tools to read recent messages in #${sourceChannelName}.`,
        `Find the message whose text is exactly: ${args.sourceText}`,
        "If newer messages exist, ignore them and use that exact Slack message text.",
      ].join("\n")
    : `Use Slack tools to read the latest message in #${sourceChannelName}.`;

  return [
    `You are authenticated as ${expectedUserEmail}.`,
    readInstruction,
    `Then send a new message in #${targetChannelName} with exactly this format:`,
    `[${args.marker}] ${echoPrefix} <previous message>`,
    "Copy the previous message text from Slack exactly as written.",
    "Do not post in any other channel.",
    "Return only the final posted message text.",
  ].join("\n");
}

export async function getSlackAccessTokenForExpectedUser(): Promise<string> {
  const { token: slackToken } = await callCliLiveTestingApi<{ token: string | null }>({
    action: "integration-token:get",
    email: expectedUserEmail,
    integrationType: "slack",
  });

  if (!slackToken) {
    throw new Error(
      `Slack is not connected for ${expectedUserEmail}. Connect Slack in app integrations before running this test.`,
    );
  }

  return slackToken;
}

export function parseSlackTimestamp(value: string): number {
  return parseSlackTs(value);
}
