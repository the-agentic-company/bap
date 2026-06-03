import { db } from "@cmdclaw/db/client";
import { conversationRuntime, coworker, coworkerRun } from "@cmdclaw/db/schema";
import { renderMessageToSlackPayload, type SlackBlock } from "@cmdclaw/message-format";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "@/env";

type RelayPayload = {
  channel?: string;
  text?: string;
  threadTs?: string;
  conversationId?: string;
};

function getRelaySecret(): string | undefined {
  return env.SLACK_BOT_RELAY_SECRET ?? env.CMDCLAW_SERVER_SECRET;
}

function isAuthorized(request: Request): boolean {
  const secret = getRelaySecret();
  if (!secret) {
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

function getAllowedChannels(): Set<string> {
  const raw = env.SLACK_BOT_RELAY_ALLOWED_CHANNELS;
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value: string) => value.trim())
      .filter(Boolean),
  );
}

async function postMessage(
  channel: string,
  text: string,
  threadTs?: string,
  blocks?: SlackBlock[],
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });

  const rawBody = await response.text();
  let parsedBody: Record<string, unknown> | null = null;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      parsedBody = null;
    }
  }

  return {
    httpStatus: response.status,
    slackReqId: response.headers.get("x-slack-req-id") ?? undefined,
    retryAfter: response.headers.get("retry-after") ?? undefined,
    body: parsedBody,
    rawBodyPreview: rawBody.slice(0, 500),
  };
}

function mapSlackFailureStatus(httpStatus: number, slackError: string | undefined): number {
  if (httpStatus === 429) {
    return 429;
  }
  if (httpStatus >= 500) {
    return 502;
  }

  switch (slackError) {
    case "missing_scope":
    case "no_permission":
    case "restricted_action":
      return 403;
    case "not_in_channel":
      return 403;
    case "invalid_auth":
    case "account_inactive":
    case "token_revoked":
    case "not_authed":
      return 502;
    case "channel_not_found":
    case "is_archived":
    case "thread_not_found":
    case "msg_too_long":
    case "no_text":
      return 400;
    default:
      return 400;
  }
}

/** POST /api/internal/slack/post-as-bot */
export async function handleSlackPostAsBot(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!env.SLACK_BOT_TOKEN) {
    return Response.json({ ok: false, error: "Slack bot token not configured" }, { status: 500 });
  }

  let payload: RelayPayload;
  try {
    payload = (await request.json()) as RelayPayload;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const channel = payload.channel?.trim();
  const text = payload.text?.trim();
  const threadTs = payload.threadTs?.trim();
  const conversationId = payload.conversationId?.trim();

  if (!channel || !text) {
    return Response.json({ ok: false, error: "channel and text are required" }, { status: 400 });
  }

  const allowedChannels = getAllowedChannels();
  if (allowedChannels.size > 0 && !allowedChannels.has(channel)) {
    return Response.json(
      { ok: false, error: `Channel ${channel} is not allowed for relay` },
      { status: 403 },
    );
  }

  if (conversationId) {
    const runtime = await db.query.conversationRuntime.findFirst({
      where: eq(conversationRuntime.conversationId, conversationId),
      columns: {
        activeGenerationId: true,
      },
    });
    const currentGenerationId = runtime?.activeGenerationId ?? undefined;
    if (!currentGenerationId) {
      return Response.json(
        { ok: false, error: "No active generation for conversation" },
        { status: 403 },
      );
    }

    const activeGeneration = await db.query.generation.findFirst({
      where: (fields) =>
        and(
          eq(fields.id, currentGenerationId),
          inArray(fields.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        ),
      columns: { id: true },
    });
    if (!activeGeneration) {
      return Response.json(
        { ok: false, error: "No active generation for conversation" },
        { status: 403 },
      );
    }

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, currentGenerationId),
      columns: { coworkerId: true },
    });
    const wf = linkedRun
      ? await db.query.coworker.findFirst({
          where: eq(coworker.id, linkedRun.coworkerId),
          columns: { allowedIntegrations: true },
        })
      : undefined;
    const allowedIntegrations = wf?.allowedIntegrations ?? null;

    if (allowedIntegrations && !allowedIntegrations.includes("slack")) {
      return Response.json(
        {
          ok: false,
          error: "Slack integration is not allowed for this conversation",
        },
        { status: 403 },
      );
    }
  }

  let slackResult: Awaited<ReturnType<typeof postMessage>> | undefined;
  try {
    const slackPayload = renderMessageToSlackPayload(text);
    slackResult = await postMessage(channel, slackPayload.text, threadTs, slackPayload.blocks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        ok: false,
        error: "Failed to contact Slack API",
        details: {
          relayError: message,
        },
      },
      { status: 502 },
    );
  }

  const slackOk = slackResult.body?.ok === true;
  if (!slackOk) {
    const slackError =
      typeof slackResult.body?.error === "string" ? (slackResult.body.error as string) : undefined;
    const status = mapSlackFailureStatus(slackResult.httpStatus, slackError);

    return Response.json(
      {
        ok: false,
        error: slackError ?? `Slack API returned HTTP ${slackResult.httpStatus}`,
        details: {
          slackHttpStatus: slackResult.httpStatus,
          slackReqId: slackResult.slackReqId,
          retryAfter: slackResult.retryAfter,
          slackBody: slackResult.body,
          slackRawBodyPreview: slackResult.rawBodyPreview || undefined,
        },
      },
      { status },
    );
  }

  return Response.json({
    ok: true,
    channel: typeof slackResult.body?.channel === "string" ? slackResult.body.channel : undefined,
    ts: typeof slackResult.body?.ts === "string" ? slackResult.body.ts : undefined,
  });
}
