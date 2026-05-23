import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUserByEmailMock,
  createUserMock,
  requestPasswordResetMock,
  isApprovedLoginEmailMock,
  normalizeApprovedLoginEmailMock,
} = vi.hoisted(() => ({
  findUserByEmailMock: vi.fn(),
  createUserMock: vi.fn(),
  requestPasswordResetMock: vi.fn(),
  isApprovedLoginEmailMock: vi.fn(),
  normalizeApprovedLoginEmailMock: vi.fn((email: string) => email.trim().toLowerCase()),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        findUserByEmail: findUserByEmailMock,
        createUser: createUserMock,
      },
    }),
    api: {
      requestPasswordReset: requestPasswordResetMock,
    },
  },
}));

vi.mock("@/server/lib/approved-login-emails", () => ({
  isApprovedLoginEmail: isApprovedLoginEmailMock,
  normalizeApprovedLoginEmail: normalizeApprovedLoginEmailMock,
}));

import { POST } from "./route";

describe("POST /api/auth/password/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isApprovedLoginEmailMock.mockResolvedValue(true);
    findUserByEmailMock.mockResolvedValue({
      id: "user-1",
      email: "pilot@cmdclaw.ai",
      name: "Pilot",
    });
    createUserMock.mockResolvedValue({
      id: "user-1",
      email: "pilot@cmdclaw.ai",
      name: "Pilot",
    });
    requestPasswordResetMock.mockResolvedValue({ data: { ok: true } });
  });

  it("sends a password reset for an approved existing user", async () => {
    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@cmdclaw.ai",
          callbackUrl: "/chat",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(findUserByEmailMock).toHaveBeenCalledWith("pilot@cmdclaw.ai");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      body: {
        email: "pilot@cmdclaw.ai",
        redirectTo:
          "https://cmdclaw.ai/reset-password?callbackUrl=%2Fchat&email=pilot%40cmdclaw.ai",
      },
      headers: expect.any(Headers),
    });
  });

  it("creates a missing approved user before sending a password reset", async () => {
    findUserByEmailMock.mockResolvedValueOnce(null);
    createUserMock.mockResolvedValueOnce({
      id: "user-2",
      email: "new-user@cmdclaw.ai",
      name: "New User",
    });

    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "new-user@cmdclaw.ai",
          callbackUrl: "/chat",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createUserMock).toHaveBeenCalledWith({
      email: "new-user@cmdclaw.ai",
      emailVerified: false,
      name: "New User",
      role: "user",
    });
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      body: {
        email: "new-user@cmdclaw.ai",
        redirectTo:
          "https://cmdclaw.ai/reset-password?callbackUrl=%2Fchat&email=new-user%40cmdclaw.ai",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns invite_only without creating or sending for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "waitlist@example.com",
          callbackUrl: "/chat",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "invite_only" });
    expect(findUserByEmailMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it("preserves a sanitized callbackUrl in the reset flow", async () => {
    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@cmdclaw.ai",
          callbackUrl: "/chat/123?tab=files",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      body: {
        email: "pilot@cmdclaw.ai",
        redirectTo:
          "https://cmdclaw.ai/reset-password?callbackUrl=%2Fchat%2F123%3Ftab%3Dfiles&email=pilot%40cmdclaw.ai",
      },
      headers: expect.any(Headers),
    });
  });
});
