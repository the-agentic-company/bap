import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock, queueAddMock, getQueueMock, buildQueueJobIdMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  queueAddMock: vi.fn(),
  getQueueMock: vi.fn(),
  buildQueueJobIdMock: vi.fn((parts: string[]) => parts.join(":")),
}));

vi.mock("@/env", () => ({
  env: {
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
  },
}));

vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: verifyMock };
  },
}));

vi.mock("@cmdclaw/core/server/queues", () => ({
  EMAIL_FORWARDED_COWORKER_JOB_NAME: "email-forwarded-coworker",
  buildQueueJobId: buildQueueJobIdMock,
  getQueue: getQueueMock,
}));

import { handleResendWebhook } from "./resend-webhook";

const RAW_BODY = '{"type":"email.received","data":{"email_id":"email-123"}}';

function makeRequest(body: string, headers: Record<string, string>) {
  return new Request("https://cmdclaw.ai/api/integrations/resend/webhook", {
    method: "POST",
    headers,
    body,
  });
}

const signatureHeaders = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,signature",
};

describe("handleResendWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueMock.mockReturnValue({ add: queueAddMock });
  });

  it("passes the exact raw body to signature verification", async () => {
    verifyMock.mockReturnValue({ type: "email.received", data: { email_id: "email-123" } });

    const response = await handleResendWebhook(makeRequest(RAW_BODY, signatureHeaders));

    expect(response.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    const verifyArg = verifyMock.mock.calls[0][0];
    // Raw body must be forwarded verbatim, not re-serialized.
    expect(verifyArg.payload).toBe(RAW_BODY);
    expect(verifyArg.headers).toEqual({
      id: "msg_1",
      timestamp: "1700000000",
      signature: "v1,signature",
    });
    expect(verifyArg.webhookSecret).toBe("whsec_test");
  });

  it("enqueues a forwarded-email job for email.received events", async () => {
    verifyMock.mockReturnValue({ type: "email.received", data: { email_id: "email-123" } });

    const response = await handleResendWebhook(makeRequest(RAW_BODY, signatureHeaders));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = queueAddMock.mock.calls[0];
    expect(jobName).toBe("email-forwarded-coworker");
    expect(data).toEqual({ webhookId: "msg_1", event: expect.objectContaining({ type: "email.received" }) });
    expect(opts.jobId).toBe("email-forwarded-coworker:msg_1");
  });

  it("returns 400 when signature headers are missing", async () => {
    const response = await handleResendWebhook(makeRequest(RAW_BODY, {}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing webhook signature headers" });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("returns 401 when signature verification throws", async () => {
    verifyMock.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const response = await handleResendWebhook(makeRequest(RAW_BODY, signatureHeaders));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it("ignores non email.received events without enqueueing", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: {} });

    const response = await handleResendWebhook(makeRequest(RAW_BODY, signatureHeaders));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});
