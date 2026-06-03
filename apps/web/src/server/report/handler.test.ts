import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, envMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  envMock: { SLACK_BOT_TOKEN: "xoxb-test" } as { SLACK_BOT_TOKEN: string | undefined },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/env", () => ({
  env: envMock,
}));

import { handleReport } from "./handler";

function jsonRequest(body: unknown) {
  return new Request("https://cmdclaw.ai/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const originalFetch = globalThis.fetch;

describe("handleReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.SLACK_BOT_TOKEN = "xoxb-test";
    getSessionMock.mockResolvedValue({ user: { email: "reporter@example.com" } });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await handleReport(jsonRequest({ message: "broken" }));

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  it("returns 500 when Slack reporting is not configured", async () => {
    envMock.SLACK_BOT_TOKEN = undefined;

    const response = await handleReport(jsonRequest({ message: "broken" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Slack reporting is not configured",
    });
  });

  it("returns 400 when the JSON body has no message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ ok: true, channels: [{ id: "C1", name: "bugs" }] }),
    ) as unknown as typeof fetch;

    const response = await handleReport(jsonRequest({ message: "   " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Message is required" });
  });

  it("returns 400 on an invalid JSON payload", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ ok: true, channels: [{ id: "C1", name: "bugs" }] }),
    ) as unknown as typeof fetch;

    const request = new Request("https://cmdclaw.ai/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const response = await handleReport(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });

  it("returns 500 when the bugs channel cannot be resolved", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ ok: true, channels: [{ id: "C9", name: "general" }] }),
    ) as unknown as typeof fetch;

    const response = await handleReport(jsonRequest({ message: "broken" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Slack channel not found: bugs",
    });
  });

  it("posts a text message to the resolved bugs channel and returns ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, channels: [{ id: "C1", name_normalized: "bugs" }] }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await handleReport(jsonRequest({ message: "something broke" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toBe("https://slack.com/api/chat.postMessage");
    const body = JSON.parse(postInit.body as string) as { channel: string; text: string };
    expect(body.channel).toBe("C1");
    expect(body.text).toContain("something broke");
    expect(body.text).toContain("reporter@example.com");
    expect(postInit.headers.Authorization).toBe("Bearer xoxb-test");
  });

  it("uploads a multipart attachment preserving the raw bytes and length", async () => {
    const fileContents = "log line\nsecond line";
    const fetchMock = vi
      .fn()
      // conversations.list
      .mockResolvedValueOnce(
        Response.json({ ok: true, channels: [{ id: "C1", name_normalized: "bugs" }] }),
      )
      // files.getUploadURLExternal
      .mockResolvedValueOnce(
        Response.json({ ok: true, upload_url: "https://slack.upload/x", file_id: "F1" }),
      )
      // upload bytes
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // files.completeUploadExternal
      .mockResolvedValueOnce(Response.json({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const formData = new FormData();
    formData.append("message", "with attachment");
    formData.append(
      "attachment",
      new File([fileContents], "trace.txt", { type: "text/plain" }),
    );
    const request = new Request("https://cmdclaw.ai/api/report", {
      method: "POST",
      body: formData,
    });

    const response = await handleReport(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    // getUploadURLExternal carries the exact byte length.
    const [, getUploadInit] = fetchMock.mock.calls[1];
    const getUploadForm = getUploadInit.body as FormData;
    expect(getUploadForm.get("filename")).toBe("trace.txt");
    expect(getUploadForm.get("length")).toBe(String(Buffer.byteLength(fileContents)));

    // The raw bytes are POSTed to the upload URL unchanged.
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2];
    expect(uploadUrl).toBe("https://slack.upload/x");
    expect(Buffer.from(uploadInit.body as Buffer).toString()).toBe(fileContents);

    const [completeUrl, completeInit] = fetchMock.mock.calls[3];
    expect(completeUrl).toBe("https://slack.com/api/files.completeUploadExternal");
    const completeBody = JSON.parse(completeInit.body as string) as {
      channel_id: string;
      files: Array<{ id: string; title: string }>;
      initial_comment: string;
    };
    expect(completeBody.channel_id).toBe("C1");
    expect(completeBody.files).toEqual([{ id: "F1", title: "trace.txt" }]);
    expect(completeBody.initial_comment).toContain("with attachment");
  });

  it("returns 502 when Slack rejects the message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, channels: [{ id: "C1", name_normalized: "bugs" }] }),
      )
      .mockResolvedValueOnce(Response.json({ ok: false, error: "channel_not_found" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await handleReport(jsonRequest({ message: "broken" }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "channel_not_found" });
  });
});
