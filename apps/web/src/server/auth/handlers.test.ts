import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authHandlerMock,
  getSessionMock,
  requestPasswordResetMock,
  hasCredentialPasswordByEmailMock,
  isApprovedLoginEmailMock,
  normalizeApprovedLoginEmailMock,
  resolveOrCreateAuthUserByEmailMock,
  consumePendingMock,
  storeProviderTokensMock,
  isOAuthProviderConfigMock,
} = vi.hoisted(() => ({
  authHandlerMock: vi.fn(),
  getSessionMock: vi.fn(),
  requestPasswordResetMock: vi.fn(),
  hasCredentialPasswordByEmailMock: vi.fn(),
  isApprovedLoginEmailMock: vi.fn(),
  normalizeApprovedLoginEmailMock: vi.fn((email: string) => email.trim().toLowerCase()),
  resolveOrCreateAuthUserByEmailMock: vi.fn(),
  consumePendingMock: vi.fn(),
  storeProviderTokensMock: vi.fn(),
  isOAuthProviderConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    handler: authHandlerMock,
    api: {
      getSession: getSessionMock,
      requestPasswordReset: requestPasswordResetMock,
    },
  },
}));

vi.mock("@/env", () => ({
  env: {
    APP_URL: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
  },
}));

vi.mock("@/lib/trusted-origins", () => ({
  getTrustedOrigins: vi.fn(() => ["https://cmdclaw.ai"]),
}));

vi.mock("@/server/lib/credential-accounts", () => ({
  hasCredentialPasswordByEmail: hasCredentialPasswordByEmailMock,
  resolveOrCreateAuthUserByEmail: resolveOrCreateAuthUserByEmailMock,
}));

vi.mock("@/server/lib/approved-login-emails", () => ({
  isApprovedLoginEmail: isApprovedLoginEmailMock,
  normalizeApprovedLoginEmail: normalizeApprovedLoginEmailMock,
}));

vi.mock("@/server/ai/pending-oauth", () => ({
  consumePending: consumePendingMock,
}));

vi.mock("@/server/orpc/routers/provider-auth", () => ({
  storeProviderTokens: storeProviderTokensMock,
}));

vi.mock("@cmdclaw/core/server/ai/subscription-providers", () => ({
  SUBSCRIPTION_PROVIDERS: {
    openai: {
      redirectUri: "https://cmdclaw.ai/api/auth/provider/openai/callback",
      clientId: "client-id",
      clientSecret: "client-secret",
      usePKCE: false,
      tokenUrl: "https://provider.example.com/token",
    },
  },
  isOAuthProviderConfig: isOAuthProviderConfigMock,
}));

import {
  handleBetterAuth,
  handleBetterAuthOptions,
  handleCheckEmail,
  handleNativeCallback,
  handlePasswordStart,
  handleProviderCallback,
} from "./handlers";

function getLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("handleBetterAuth (/api/auth/**)", () => {
  it("redirects invite-only social callback errors to the public fallback page", async () => {
    authHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "invite_only", message: "invite_only" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleBetterAuth(
      new Request("https://cmdclaw.ai/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("https://cmdclaw.ai/invite-only?source=social-google");
  });

  it("forwards the email from the invite-only error body when present", async () => {
    authHandlerMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "invite_only",
          message: "invite_only",
          email: "alice@example.com",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleBetterAuth(
      new Request("https://cmdclaw.ai/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cmdclaw.ai/invite-only?source=social-google&email=alice%40example.com",
    );
  });

  it("applies CORS headers for a trusted origin and preserves Set-Cookie", async () => {
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    upstream.headers.append("set-cookie", "session=abc; Path=/; HttpOnly");
    upstream.headers.append("set-cookie", "csrf=def; Path=/");
    authHandlerMock.mockResolvedValue(upstream);

    const response = await handleBetterAuth(
      new Request("https://cmdclaw.ai/api/auth/get-session", {
        headers: { origin: "https://cmdclaw.ai" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://cmdclaw.ai");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "csrf=def; Path=/",
    ]);
  });

  it("does not rewrite the origin for untrusted origins", async () => {
    authHandlerMock.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await handleBetterAuth(
      new Request("https://cmdclaw.ai/api/auth/get-session", {
        headers: { origin: "https://evil.example.com" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("handleBetterAuthOptions (CORS preflight)", () => {
  it("returns 204 with CORS headers for the request origin", () => {
    const response = handleBetterAuthOptions(
      new Request("https://cmdclaw.ai/api/auth/sign-in", {
        method: "OPTIONS",
        headers: { origin: "https://cmdclaw.ai" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://cmdclaw.ai");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
  });
});

describe("handleCheckEmail (/api/auth/check-email)", () => {
  beforeEach(() => {
    isApprovedLoginEmailMock.mockResolvedValue(true);
    hasCredentialPasswordByEmailMock.mockResolvedValue(true);
  });

  it("returns approved emails with their password status", async () => {
    const response = await handleCheckEmail(
      new Request("https://cmdclaw.ai/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pilot@cmdclaw.ai" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ approved: true, hasPassword: true });
    expect(hasCredentialPasswordByEmailMock).toHaveBeenCalledWith("pilot@cmdclaw.ai");
  });

  it("does not look up passwords for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await handleCheckEmail(
      new Request("https://cmdclaw.ai/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "waitlist@example.com" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ approved: false, hasPassword: false });
    expect(hasCredentialPasswordByEmailMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const response = await handleCheckEmail(
      new Request("https://cmdclaw.ai/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ approved: false });
  });
});

describe("handlePasswordStart (/api/auth/password/start)", () => {
  beforeEach(() => {
    isApprovedLoginEmailMock.mockResolvedValue(true);
    resolveOrCreateAuthUserByEmailMock.mockResolvedValue({ id: "user-1" });
    requestPasswordResetMock.mockResolvedValue({ data: { ok: true } });
  });

  it("sends a password reset for an approved user with a sanitized callback URL", async () => {
    const response = await handlePasswordStart(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pilot@cmdclaw.ai", callbackUrl: "/chat/123?tab=files" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(resolveOrCreateAuthUserByEmailMock).toHaveBeenCalledWith({ email: "pilot@cmdclaw.ai" });
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      body: {
        email: "pilot@cmdclaw.ai",
        redirectTo:
          "https://cmdclaw.ai/reset-password?callbackUrl=%2Fchat%2F123%3Ftab%3Dfiles&email=pilot%40cmdclaw.ai",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns invite_only without creating or sending for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await handlePasswordStart(
      new Request("https://cmdclaw.ai/api/auth/password/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "waitlist@example.com", callbackUrl: "/chat" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "invite_only" });
    expect(resolveOrCreateAuthUserByEmailMock).not.toHaveBeenCalled();
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });
});

describe("handleNativeCallback (/api/auth/native-callback)", () => {
  it("redirects to the native app with the session token", async () => {
    getSessionMock.mockResolvedValueOnce({ session: { token: "sess-token" } });

    const response = await handleNativeCallback(
      new Request("https://cmdclaw.ai/api/auth/native-callback?redirect=cmdclaw%3A%2F%2Fauth"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("cmdclaw://auth?token=sess-token");
  });

  it("redirects with a no_session error when there is no session token", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const response = await handleNativeCallback(
      new Request("https://cmdclaw.ai/api/auth/native-callback"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("cmdclaw://auth/callback?error=no_session");
  });
});

describe("handleProviderCallback (/api/auth/provider/:provider/callback)", () => {
  beforeEach(() => {
    isOAuthProviderConfigMock.mockReturnValue(true);
  });

  it("redirects to settings with the provider error when the provider denies access", async () => {
    process.env.APP_URL = "https://app.example.com";

    const response = await handleProviderCallback(
      new Request("https://0.0.0.0:8080/api/auth/provider/openai/callback?error=access_denied"),
      "openai",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://app.example.com/settings/subscriptions?provider_error=access_denied",
    );
  });

  it("rejects an unknown provider", async () => {
    const response = await handleProviderCallback(
      new Request("https://cmdclaw.ai/api/auth/provider/unknown/callback?code=c&state=s"),
      "unknown",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cmdclaw.ai/settings/subscriptions?provider_error=invalid_provider",
    );
  });

  it("rejects when the authenticated user does not match the pending request", async () => {
    consumePendingMock.mockResolvedValueOnce({ userId: "owner" });
    getSessionMock.mockResolvedValueOnce({ user: { id: "intruder" } });

    const response = await handleProviderCallback(
      new Request("https://cmdclaw.ai/api/auth/provider/openai/callback?code=c&state=s"),
      "openai",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cmdclaw.ai/settings/subscriptions?provider_error=auth_mismatch",
    );
    expect(storeProviderTokensMock).not.toHaveBeenCalled();
  });

  it("exchanges the code and stores tokens on success", async () => {
    consumePendingMock.mockResolvedValueOnce({ userId: "owner", codeVerifier: "verifier" });
    getSessionMock.mockResolvedValueOnce({ user: { id: "owner" } });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = await handleProviderCallback(
      new Request("https://cmdclaw.ai/api/auth/provider/openai/callback?code=c&state=s"),
      "openai",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://cmdclaw.ai/settings/subscriptions?provider_connected=openai",
    );
    expect(storeProviderTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner",
        provider: "openai",
        accessToken: "at",
        refreshToken: "rt",
      }),
    );
    fetchMock.mockRestore();
  });
});
