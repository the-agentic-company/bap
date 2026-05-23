import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasCredentialPasswordByEmailMock,
  isApprovedLoginEmailMock,
  normalizeApprovedLoginEmailMock,
} = vi.hoisted(() => ({
  hasCredentialPasswordByEmailMock: vi.fn(),
  isApprovedLoginEmailMock: vi.fn(),
  normalizeApprovedLoginEmailMock: vi.fn((email: string) => email.trim().toLowerCase()),
}));

vi.mock("@/server/lib/credential-accounts", () => ({
  hasCredentialPasswordByEmail: hasCredentialPasswordByEmailMock,
}));

vi.mock("@/server/lib/approved-login-emails", () => ({
  isApprovedLoginEmail: isApprovedLoginEmailMock,
  normalizeApprovedLoginEmail: normalizeApprovedLoginEmailMock,
}));

import { POST } from "./route";

describe("POST /api/auth/check-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isApprovedLoginEmailMock.mockResolvedValue(true);
    hasCredentialPasswordByEmailMock.mockResolvedValue(true);
  });

  it("returns approved emails with their password status", async () => {
    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/check-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@cmdclaw.ai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      approved: true,
      hasPassword: true,
    });
    expect(hasCredentialPasswordByEmailMock).toHaveBeenCalledWith("pilot@cmdclaw.ai");
  });

  it("does not look up passwords for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await POST(
      new Request("https://cmdclaw.ai/api/auth/check-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "waitlist@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      approved: false,
      hasPassword: false,
    });
    expect(hasCredentialPasswordByEmailMock).not.toHaveBeenCalled();
  });
});
