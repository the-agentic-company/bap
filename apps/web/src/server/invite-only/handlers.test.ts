import { beforeEach, describe, expect, it, vi } from "vitest";

const { isApprovedLoginEmailMock, postInviteOnlyAccessRequestSlackNotificationMock } = vi.hoisted(
  () => ({
    isApprovedLoginEmailMock: vi.fn(),
    postInviteOnlyAccessRequestSlackNotificationMock: vi.fn(),
  }),
);

vi.mock("@/server/lib/approved-login-emails", () => ({
  isApprovedLoginEmail: isApprovedLoginEmailMock,
}));

vi.mock("@cmdclaw/core/server/services/telemetry-slack", () => ({
  postInviteOnlyAccessRequestSlackNotification: postInviteOnlyAccessRequestSlackNotificationMock,
}));

import { handleInviteOnlyRequestAccess } from "./handlers";

describe("POST /api/invite-only/request-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isApprovedLoginEmailMock.mockResolvedValue(false);
    postInviteOnlyAccessRequestSlackNotificationMock.mockResolvedValue(true);
  });

  it("posts a Slack notification for a valid request", async () => {
    const response = await handleInviteOnlyRequestAccess(
      new Request("https://cmdclaw.ai/api/invite-only/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          referer: "https://cmdclaw.ai/invite-only?source=magic-link",
        },
        body: JSON.stringify({
          email: "waitlist@example.com",
          source: "magic-link",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, alreadyApproved: false });
    expect(postInviteOnlyAccessRequestSlackNotificationMock).toHaveBeenCalledWith({
      email: "waitlist@example.com",
      source: "magic-link",
      occurredAt: expect.any(Date),
      referrer: "https://cmdclaw.ai/invite-only?source=magic-link",
    });
  });

  it("returns alreadyApproved without posting to Slack", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(true);

    const response = await handleInviteOnlyRequestAccess(
      new Request("https://cmdclaw.ai/api/invite-only/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "approved@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, alreadyApproved: true });
    expect(postInviteOnlyAccessRequestSlackNotificationMock).not.toHaveBeenCalled();
  });

  it("defaults source and referrer when omitted", async () => {
    const response = await handleInviteOnlyRequestAccess(
      new Request("https://cmdclaw.ai/api/invite-only/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "Waitlist@Example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(postInviteOnlyAccessRequestSlackNotificationMock).toHaveBeenCalledWith({
      email: "waitlist@example.com",
      source: "invite-only-page",
      occurredAt: expect.any(Date),
      referrer: null,
    });
  });

  it("returns 500 when notifications are not configured", async () => {
    postInviteOnlyAccessRequestSlackNotificationMock.mockResolvedValueOnce(false);

    const response = await handleInviteOnlyRequestAccess(
      new Request("https://cmdclaw.ai/api/invite-only/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "waitlist@example.com",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Request access notifications are not configured",
    });
  });

  it("rejects invalid email payloads", async () => {
    const response = await handleInviteOnlyRequestAccess(
      new Request("https://cmdclaw.ai/api/invite-only/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "not-an-email",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
