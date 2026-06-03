import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueAddMock, getQueueMock, buildQueueJobIdMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn(),
  getQueueMock: vi.fn(),
  buildQueueJobIdMock: vi.fn((parts: string[]) => parts.join(":")),
}));

const SIGNING_SECRET = "test-signing-secret";

// Drive the real `verifySlackSignature` implementation by providing a secret.
vi.mock("@/env", () => ({
  env: {
    SLACK_SIGNING_SECRET: "test-signing-secret",
  },
}));

vi.mock("@cmdclaw/core/server/queues", () => ({
  SLACK_EVENT_JOB_NAME: "slack-event",
  buildQueueJobId: buildQueueJobIdMock,
  getQueue: getQueueMock,
}));

import { handleSlackEvents } from "./events";

function sign(body: string, timestamp: string): string {
  const base = `v0:${timestamp}:${body}`;
  return "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(base).digest("hex");
}

function makeRequest(body: string, headers: Record<string, string>) {
  return new Request("https://cmdclaw.ai/api/slack/events", {
    method: "POST",
    headers,
    body,
  });
}

function signedRequest(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return makeRequest(body, {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": sign(body, timestamp),
  });
}

describe("handleSlackEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueMock.mockReturnValue({ add: queueAddMock });
  });

  it("returns 401 when the signature is invalid", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const response = await handleSlackEvents(
      makeRequest(body, {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=deadbeef",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("verifies the exact raw body bytes (whitespace preserved)", async () => {
    // Body with non-canonical whitespace: re-serializing would change the bytes
    // and break HMAC verification. The handler must hash the raw body verbatim.
    const body = '{ "type" : "url_verification" ,  "challenge" : "challenge-token" }';
    const response = await handleSlackEvents(signedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: "challenge-token" });
  });

  it("enqueues a job for event_callback payloads", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "Ev123",
      event: { type: "app_mention" },
    });
    const response = await handleSlackEvents(signedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = queueAddMock.mock.calls[0];
    expect(jobName).toBe("slack-event");
    expect(data).toEqual({ payload: expect.objectContaining({ event_id: "Ev123" }), eventId: "Ev123" });
    expect(opts.jobId).toBe("slack-event:Ev123");
  });

  it("returns 400 when event_callback is missing event_id", async () => {
    const body = JSON.stringify({ type: "event_callback" });
    const response = await handleSlackEvents(signedRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing event_id" });
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("returns 503 when enqueue fails", async () => {
    queueAddMock.mockRejectedValueOnce(new Error("redis down"));
    const body = JSON.stringify({ type: "event_callback", event_id: "Ev123" });
    const response = await handleSlackEvents(signedRequest(body));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Failed to enqueue event" });
  });
});
