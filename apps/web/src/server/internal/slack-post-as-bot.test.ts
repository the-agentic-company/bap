import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    CMDCLAW_SERVER_SECRET: "test-secret",
    SLACK_BOT_RELAY_SECRET: undefined as string | undefined,
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_BOT_RELAY_ALLOWED_CHANNELS: undefined as string | undefined,
  },
}));

vi.mock("@/env", () => ({ env: envMock }));

vi.mock("@cmdclaw/db/client", () => ({
  db: { query: {} },
}));

vi.mock("@cmdclaw/message-format", () => ({
  renderMessageToSlackPayload: (text: string) => ({ text, blocks: undefined }),
}));

import { handleSlackPostAsBot } from "./slack-post-as-bot";

function makeRequest(body: unknown, auth = "Bearer test-secret"): Request {
  return new Request("https://app.example.com/api/internal/slack/post-as-bot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: auth,
    },
    body: JSON.stringify(body),
  });
}

describe("handleSlackPostAsBot", () => {
  beforeEach(() => {
    envMock.SLACK_BOT_RELAY_SECRET = undefined;
    envMock.SLACK_BOT_TOKEN = "xoxb-test";
    envMock.SLACK_BOT_RELAY_ALLOWED_CHANNELS = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const response = await handleSlackPostAsBot(
      makeRequest({ channel: "C1", text: "hi" }, "Bearer wrong"),
    );
    expect(response.status).toBe(401);
  });

  it("requires channel and text", async () => {
    const response = await handleSlackPostAsBot(makeRequest({ channel: "C1" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "channel and text are required",
    });
  });

  it("posts to Slack and returns channel/ts on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: "C1", ts: "123.45" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleSlackPostAsBot(makeRequest({ channel: "C1", text: "hello" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      channel: "C1",
      ts: "123.45",
    });
  });

  it("maps Slack channel_not_found to a 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleSlackPostAsBot(makeRequest({ channel: "C1", text: "hello" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "channel_not_found" });
  });

  it("maps Slack missing_scope to a 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "missing_scope" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleSlackPostAsBot(makeRequest({ channel: "C1", text: "hello" }));
    expect(response.status).toBe(403);
  });

  it("rejects channels outside the allow-list", async () => {
    envMock.SLACK_BOT_RELAY_ALLOWED_CHANNELS = "C-allowed";

    const response = await handleSlackPostAsBot(makeRequest({ channel: "C-other", text: "hello" }));
    expect(response.status).toBe(403);
  });
});
