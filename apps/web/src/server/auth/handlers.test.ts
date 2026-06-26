import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  authHandlerMock,
  getSessionMock,
  requestPasswordResetMock,
  hasCredentialPasswordByEmailMock,
  isApprovedLoginEmailMock,
  normalizeApprovedLoginEmailMock,
  resolveOrCreateAuthUserByEmailMock,
  resolveMagicLinkPageStateMock,
  markMagicLinkRequestConsumedMock,
  consumePendingMock,
  storeProviderTokensMock,
  isOAuthProviderConfigMock,
} = vi.hoisted(() => {
  process.env.PORT = "3000";

  return {
    authHandlerMock: vi.fn<VitestProcedure>(),
    getSessionMock: vi.fn<VitestProcedure>(),
    requestPasswordResetMock: vi.fn<VitestProcedure>(),
    hasCredentialPasswordByEmailMock: vi.fn<VitestProcedure>(),
    isApprovedLoginEmailMock: vi.fn<VitestProcedure>(),
    normalizeApprovedLoginEmailMock: vi.fn<VitestProcedure>((email: string) =>
      email.trim().toLowerCase(),
    ),
    resolveOrCreateAuthUserByEmailMock: vi.fn<VitestProcedure>(),
    resolveMagicLinkPageStateMock: vi.fn<VitestProcedure>(),
    markMagicLinkRequestConsumedMock: vi.fn<VitestProcedure>(),
    consumePendingMock: vi.fn<VitestProcedure>(),
    storeProviderTokensMock: vi.fn<VitestProcedure>(),
    isOAuthProviderConfigMock: vi.fn<VitestProcedure>(),
  };
});

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
    VITE_APP_URL: undefined,
  },
}));

vi.mock("@/lib/trusted-origins", () => ({
  getTrustedOrigins: vi.fn<VitestProcedure>(() => ["https://heybap.com"]),
}));

vi.mock("@/server/lib/credential-accounts", () => ({
  hasCredentialPasswordByEmail: hasCredentialPasswordByEmailMock,
  resolveOrCreateAuthUserByEmail: resolveOrCreateAuthUserByEmailMock,
}));

vi.mock("@/server/lib/magic-link-request-state", () => ({
  resolveMagicLinkPageState: resolveMagicLinkPageStateMock,
  markMagicLinkRequestConsumed: markMagicLinkRequestConsumedMock,
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

vi.mock("@bap/core/server/ai/subscription-providers", () => ({
  SUBSCRIPTION_PROVIDERS: {
    openai: {
      redirectUri: "https://heybap.com/api/auth/provider/openai/callback",
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
  handleMagicLinkConfirm,
  handleMagicLinkResend,
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

function postMagicLinkResend(token = "abc123") {
  return handleMagicLinkResend(
    new Request(`https://heybap.com/sign-in/${token}/resend`, { method: "POST" }),
    token,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_URL;
  delete process.env.VITE_APP_URL;
  process.env.PORT = "3000";
});

afterEach(() => {
  delete process.env.PORT;
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
      new Request("https://heybap.com/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("https://heybap.com/invite-only?source=social-google");
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
      new Request("https://heybap.com/api/auth/callback/google?code=abc&state=def"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://heybap.com/invite-only?source=social-google&email=alice%40example.com",
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
      new Request("https://heybap.com/api/auth/get-session", {
        headers: { origin: "https://heybap.com" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://heybap.com");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "csrf=def; Path=/",
    ]);
  });

  it("does not rewrite the origin for untrusted origins", async () => {
    authHandlerMock.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await handleBetterAuth(
      new Request("https://heybap.com/api/auth/get-session", {
        headers: { origin: "https://evil.example.com" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("handleBetterAuthOptions (CORS preflight)", () => {
  it("returns 204 with CORS headers for the request origin", () => {
    const response = handleBetterAuthOptions(
      new Request("https://heybap.com/api/auth/sign-in", {
        method: "OPTIONS",
        headers: { origin: "https://heybap.com" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://heybap.com");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
  });
});

describe("handleMagicLinkConfirm (POST /sign-in/:token/confirm)", () => {
  beforeEach(() => {
    resolveMagicLinkPageStateMock.mockResolvedValue({
      status: "pending",
      email: "pilot@heybap.com",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/onboarding",
      errorCallbackUrl: "/login?error=magic-link",
    });
    markMagicLinkRequestConsumedMock.mockResolvedValue(undefined);
  });

  it("delegates pending tokens to Better Auth verification and marks them consumed", async () => {
    authHandlerMock.mockResolvedValue(Response.redirect("https://heybap.com/chat", 302));

    const response = await handleMagicLinkConfirm(
      new Request("https://heybap.com/sign-in/abc123/confirm", {
        method: "POST",
        headers: { cookie: "csrf=token" },
      }),
      "abc123",
    );

    expect(response.status).toBe(302);
    expect(getLocation(response)).toBe("https://heybap.com/chat");
    expect(authHandlerMock).toHaveBeenCalledTimes(1);
    const delegatedRequest = authHandlerMock.mock.calls[0]?.[0] as Request;
    const delegatedUrl = new URL(delegatedRequest.url);
    expect(delegatedUrl.pathname).toBe("/api/auth/magic-link/verify");
    expect(delegatedUrl.searchParams.get("token")).toBe("abc123");
    expect(delegatedUrl.searchParams.get("callbackURL")).toBe("https://heybap.com/chat");
    expect(delegatedUrl.searchParams.get("newUserCallbackURL")).toBe(
      "https://heybap.com/onboarding",
    );
    expect(delegatedUrl.searchParams.get("errorCallbackURL")).toBe(
      "https://heybap.com/login?error=magic-link",
    );
    expect(delegatedRequest.headers.get("cookie")).toBe("csrf=token");
    expect(markMagicLinkRequestConsumedMock).toHaveBeenCalledWith("abc123");
  });

  it("delegates complex MCP OAuth return paths as absolute URLs for Better Auth", async () => {
    const mcpAuthorizePath =
      "/api/mcp/oauth/authorize?response_type=code&client_id=bap-mcp-client&redirect_uri=http%3A%2F%2Flocalhost%3A34567%2Fcallback&scope=bap+gmail&resource=https%3A%2F%2Fmcp.heybap.com%2Fbap";
    resolveMagicLinkPageStateMock.mockResolvedValueOnce({
      status: "pending",
      email: "pilot@heybap.com",
      callbackUrl: mcpAuthorizePath,
      newUserCallbackUrl: mcpAuthorizePath,
      errorCallbackUrl: "/login?error=magic-link",
    });
    authHandlerMock.mockResolvedValue(Response.redirect("https://heybap.com/chat", 302));

    await handleMagicLinkConfirm(
      new Request("https://heybap.com/sign-in/abc123/confirm", { method: "POST" }),
      "abc123",
    );

    const delegatedRequest = authHandlerMock.mock.calls[0]?.[0] as Request;
    const delegatedUrl = new URL(delegatedRequest.url);
    expect(delegatedUrl.searchParams.get("callbackURL")).toBe(
      `https://heybap.com${mcpAuthorizePath}`,
    );
    expect(delegatedUrl.searchParams.get("newUserCallbackURL")).toBe(
      `https://heybap.com${mcpAuthorizePath}`,
    );
  });

  it("does not mark the page state consumed when Better Auth rejects the token", async () => {
    authHandlerMock.mockResolvedValue(
      Response.redirect("https://heybap.com/login?error=magic-link?error=INVALID_TOKEN", 302),
    );

    await handleMagicLinkConfirm(
      new Request("https://heybap.com/sign-in/abc123/confirm", { method: "POST" }),
      "abc123",
    );

    expect(markMagicLinkRequestConsumedMock).not.toHaveBeenCalled();
  });

  it("redirects non-pending tokens back to the sign-in page", async () => {
    resolveMagicLinkPageStateMock.mockResolvedValueOnce({
      status: "expired",
      email: "pilot@heybap.com",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });

    const response = await handleMagicLinkConfirm(
      new Request("https://heybap.com/sign-in/abc123/confirm", { method: "POST" }),
      "abc123",
    );

    expect(response.status).toBe(303);
    expect(getLocation(response)).toBe("https://heybap.com/sign-in/abc123?error=expired");
    expect(authHandlerMock).not.toHaveBeenCalled();
  });
});

describe("handleMagicLinkResend (POST /sign-in/:token/resend)", () => {
  beforeEach(() => {
    resolveMagicLinkPageStateMock.mockResolvedValue({
      status: "expired",
      email: "pilot@heybap.com",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/onboarding",
      errorCallbackUrl: "/login?error=magic-link",
    });
  });

  it("requests a replacement magic link and redirects back with a resent flag", async () => {
    authHandlerMock.mockResolvedValue(Response.json({ status: true }));

    const response = await postMagicLinkResend();

    expect(response.status).toBe(303);
    expect(getLocation(response)).toBe("https://heybap.com/sign-in/abc123?resent=1");
    const delegatedRequest = authHandlerMock.mock.calls[0]?.[0] as Request;
    expect(delegatedRequest.method).toBe("POST");
    expect(new URL(delegatedRequest.url).pathname).toBe("/api/auth/sign-in/magic-link");
    await expect(delegatedRequest.json()).resolves.toEqual({
      email: "pilot@heybap.com",
      callbackURL: "https://heybap.com/chat",
      newUserCallbackURL: "https://heybap.com/onboarding",
      errorCallbackURL: "https://heybap.com/login?error=magic-link",
    });
  });

  it("redirects invalid tokens back with an error", async () => {
    resolveMagicLinkPageStateMock.mockResolvedValueOnce({
      status: "invalid",
      email: null,
      callbackUrl: null,
      newUserCallbackUrl: null,
      errorCallbackUrl: null,
    });

    const response = await postMagicLinkResend();

    expect(response.status).toBe(303);
    expect(getLocation(response)).toBe("https://heybap.com/sign-in/abc123?error=invalid");
    expect(authHandlerMock).not.toHaveBeenCalled();
  });
});

describe("handleCheckEmail (/api/auth/check-email)", () => {
  beforeEach(() => {
    isApprovedLoginEmailMock.mockResolvedValue(true);
    hasCredentialPasswordByEmailMock.mockResolvedValue(true);
  });

  it("returns approved emails with their password status", async () => {
    const response = await handleCheckEmail(
      new Request("https://heybap.com/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pilot@heybap.com" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ approved: true, hasPassword: true });
    expect(hasCredentialPasswordByEmailMock).toHaveBeenCalledWith("pilot@heybap.com");
  });

  it("does not look up passwords for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await handleCheckEmail(
      new Request("https://heybap.com/api/auth/check-email", {
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
      new Request("https://heybap.com/api/auth/check-email", {
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
      new Request("https://heybap.com/api/auth/password/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pilot@heybap.com", callbackUrl: "/chat/123?tab=files" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(resolveOrCreateAuthUserByEmailMock).toHaveBeenCalledWith({ email: "pilot@heybap.com" });
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      body: {
        email: "pilot@heybap.com",
        redirectTo:
          "https://heybap.com/reset-password?callbackUrl=%2Fchat%2F123%3Ftab%3Dfiles&email=pilot%40heybap.com",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns invite_only without creating or sending for unapproved emails", async () => {
    isApprovedLoginEmailMock.mockResolvedValueOnce(false);

    const response = await handlePasswordStart(
      new Request("https://heybap.com/api/auth/password/start", {
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
      new Request("https://heybap.com/api/auth/native-callback?redirect=bap%3A%2F%2Fauth"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("bap://auth?token=sess-token");
  });

  it("redirects with a no_session error when there is no session token", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const response = await handleNativeCallback(
      new Request("https://heybap.com/api/auth/native-callback"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe("bap://auth/callback?error=no_session");
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
      new Request("https://heybap.com/api/auth/provider/unknown/callback?code=c&state=s"),
      "unknown",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://heybap.com/settings/subscriptions?provider_error=invalid_provider",
    );
  });

  it("rejects when the authenticated user does not match the pending request", async () => {
    consumePendingMock.mockResolvedValueOnce({ userId: "owner" });
    getSessionMock.mockResolvedValueOnce({ user: { id: "intruder" } });

    const response = await handleProviderCallback(
      new Request("https://heybap.com/api/auth/provider/openai/callback?code=c&state=s"),
      "openai",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://heybap.com/settings/subscriptions?provider_error=auth_mismatch",
    );
    expect(storeProviderTokensMock).not.toHaveBeenCalled();
  });

  it("exchanges the code and stores tokens on success", async () => {
    consumePendingMock.mockResolvedValueOnce({ userId: "owner", codeVerifier: "verifier" });
    getSessionMock.mockResolvedValueOnce({ user: { id: "owner" } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleProviderCallback(
      new Request("https://heybap.com/api/auth/provider/openai/callback?code=c&state=s"),
      "openai",
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://heybap.com/settings/subscriptions?provider_connected=openai",
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
