import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNIPILE_MISSING_CREDENTIALS_MESSAGE } from "@/lib/integration-errors";
import { mswServer } from "@/test/msw/server";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

function createProcedureStub() {
  const stub = {
    input: vi.fn<VitestProcedure>(),
    output: vi.fn<VitestProcedure>(),
    handler: vi.fn<VitestProcedure>((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  getOAuthConfigMock,
  generateLinkedInAuthUrlMock,
  deleteUnipileAccountMock,
  getUnipileAccountMock,
  encryptMock,
  decryptMock,
} = vi.hoisted(() => ({
  getOAuthConfigMock: vi.fn<VitestProcedure>(),
  generateLinkedInAuthUrlMock: vi.fn<VitestProcedure>(),
  deleteUnipileAccountMock: vi.fn<VitestProcedure>(),
  getUnipileAccountMock: vi.fn<VitestProcedure>(),
  encryptMock: vi.fn<VitestProcedure>((value: string) => `enc:${value}`),
  decryptMock: vi.fn<VitestProcedure>((value: string) => value.replace(/^enc:/, "")),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@bap/core/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@/server/integrations/unipile", () => ({
  generateLinkedInAuthUrl: generateLinkedInAuthUrlMock,
  deleteUnipileAccount: deleteUnipileAccountMock,
  getUnipileAccount: getUnipileAccountMock,
}));

vi.mock("@bap/core/server/lib/encryption", () => ({
  encrypt: encryptMock,
  decrypt: decryptMock,
}));

import { integrationRouter } from "./integration";

const integrationRouterAny = integrationRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

function encodeState(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function createContext() {
  const insertReturningMock = vi.fn<VitestProcedure>();
  const insertOnConflictDoUpdateMock = vi.fn<VitestProcedure>().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn<VitestProcedure>(() => ({
    returning: insertReturningMock,
    onConflictDoUpdate: insertOnConflictDoUpdateMock,
  }));
  const insertMock = vi.fn<VitestProcedure>(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn<VitestProcedure>().mockResolvedValue([]);
  const updateWhereMock = vi.fn<VitestProcedure>(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn<VitestProcedure>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<VitestProcedure>(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn<VitestProcedure>().mockResolvedValue([]);
  const deleteWhereMock = vi.fn<VitestProcedure>(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn<VitestProcedure>(() => ({ where: deleteWhereMock }));

  return {
    user: { id: "user-1", email: "user@example.com" },
    db: {
      query: {
        user: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            role: "admin",
            email: "user@example.com",
            name: "Test User",
          }),
        },
        integration: {
          findMany: vi.fn<VitestProcedure>(),
          findFirst: vi.fn<VitestProcedure>(),
        },
        connectedIdentity: {
          findMany: vi.fn<VitestProcedure>().mockResolvedValue([]),
          findFirst: vi.fn<VitestProcedure>(),
        },
        googleIntegrationAccessAllowlist: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue(null),
          findMany: vi.fn<VitestProcedure>(),
        },
        customIntegration: {
          findFirst: vi.fn<VitestProcedure>(),
          findMany: vi.fn<VitestProcedure>(),
        },
        customIntegrationCredential: {
          findFirst: vi.fn<VitestProcedure>(),
          findMany: vi.fn<VitestProcedure>(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      insertOnConflictDoUpdateMock,
      updateSetMock,
      updateReturningMock,
      deleteWhereMock,
      deleteReturningMock,
    },
  };
}

function applyIntegrationTestBeforeEach() {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  generateLinkedInAuthUrlMock.mockResolvedValue("https://linkedin.example.com/auth");
  deleteUnipileAccountMock.mockResolvedValue(undefined);
  getUnipileAccountMock.mockResolvedValue({
    name: "LinkedIn Profile",
    identifier: "linkedin-profile",
  });

  getOAuthConfigMock.mockReturnValue({
    clientId: "client-id",
    clientSecret: "client-secret",
    authUrl: "https://oauth.example.com/authorize",
    tokenUrl: "https://oauth.example.com/token",
    redirectUri: "https://app.example.com/api/oauth/callback",
    scopes: ["scope:read", "scope:write"],
    getUserInfo: vi.fn<VitestProcedure>(async () => ({
      id: "provider-user",
      displayName: "Provider User",
      metadata: { team: "alpha" },
    })),
  });
}

describe("integrationRouter", () => {
  beforeEach(() => {
    applyIntegrationTestBeforeEach();
  });

  it("lists integrations with public fields", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.integration.findMany.mockResolvedValue([
      {
        id: "integration-1",
        type: "github",
        displayName: "GitHub",
        enabled: true,
        setupRequired: false,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["repo"],
        createdAt: now,
        providerAccountId: "secret-provider-id",
      },
    ]);

    const result = await integrationRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "integration-1",
        type: "github",
        displayName: "GitHub",
        enabled: true,
        setupRequired: false,
        instanceName: null,
        instanceUrl: null,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["repo"],
        createdAt: now,
        accountLabelId: null,
        accountLabel: null,
      },
    ]);
  });

  it("includes Dynamics environment details in integration list", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.integration.findMany.mockResolvedValue([
      {
        id: "integration-dyn-1",
        type: "dynamics",
        displayName: "user@contoso.com",
        enabled: true,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["offline_access"],
        createdAt: now,
        metadata: {
          pendingInstanceSelection: false,
          instanceName: "Contoso Prod",
          instanceUrl: "https://org123.api.crm4.dynamics.com",
        },
      },
    ]);

    const result = await integrationRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "integration-dyn-1",
        type: "dynamics",
        displayName: "user@contoso.com",
        enabled: true,
        setupRequired: false,
        instanceName: "Contoso Prod",
        instanceUrl: "https://org123.api.crm4.dynamics.com",
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["offline_access"],
        createdAt: now,
        accountLabelId: null,
        accountLabel: null,
      },
    ]);
  });

  it("builds provider-specific auth URL params (slack user_scope, reddit duration, PKCE)", async () => {
    const context = createContext();

    const slack = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "slack",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const slackUrl = new URL(slack.authUrl);
    expect(slackUrl.searchParams.get("user_scope")).toBe("scope:read scope:write");
    expect(slackUrl.searchParams.get("scope")).toBeNull();

    const reddit = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "reddit",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const redditUrl = new URL(reddit.authUrl);
    expect(redditUrl.searchParams.get("duration")).toBe("permanent");

    const airtable = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "airtable",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const airtableUrl = new URL(airtable.authUrl);
    expect(airtableUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(airtableUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds linkedin auth URL via unipile", async () => {
    const context = createContext();

    const result = await integrationRouterAny.getAuthUrl({
      input: {
        type: "linkedin",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    });

    expect(result).toEqual({ authUrl: "https://linkedin.example.com/auth" });
    expect(generateLinkedInAuthUrlMock).toHaveBeenCalledWith(
      "user-1",
      "https://app.example.com/integrations",
    );
  });

  it("returns explicit error when Unipile credentials are missing for linkedin auth", async () => {
    const context = createContext();
    generateLinkedInAuthUrlMock.mockRejectedValueOnce(
      new Error(UNIPILE_MISSING_CREDENTIALS_MESSAGE),
    );

    await expect(
      integrationRouterAny.getAuthUrl({
        input: {
          type: "linkedin",
          redirectUrl: "https://app.example.com/integrations",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: UNIPILE_MISSING_CREDENTIALS_MESSAGE,
    });
  });

  it("adds google and notion-specific auth params", async () => {
    const context = createContext();

    const google = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "google_gmail",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const googleUrl = new URL(google.authUrl);
    expect(googleUrl.searchParams.get("access_type")).toBe("offline");
    expect(googleUrl.searchParams.get("prompt")).toBe("consent");

    const notion = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "notion",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const notionUrl = new URL(notion.authUrl);
    expect(notionUrl.searchParams.get("owner")).toBe("user");
  });

  it("prompts Microsoft users to pick an account when generating Outlook auth URLs", async () => {
    const context = createContext();

    const outlook = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "outlook",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const outlookUrl = new URL(outlook.authUrl);
    expect(outlookUrl.searchParams.get("prompt")).toBe("select_account");

    const outlookCalendar = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "outlook_calendar",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const outlookCalendarUrl = new URL(outlookCalendar.authUrl);
    expect(outlookCalendarUrl.searchParams.get("prompt")).toBe("select_account");
  });

  it("blocks google auth URL generation for non-allowlisted non-admin users", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValueOnce({
      role: "user",
      email: "blocked@example.com",
      name: "Blocked User",
    });
    context.db.query.googleIntegrationAccessAllowlist.findFirst.mockResolvedValueOnce(null);

    await expect(
      integrationRouterAny.getAuthUrl({
        input: {
          type: "google_gmail",
          redirectUrl: "https://app.example.com/integrations",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Google integrations require admin approval. Request access first.",
    });
  });

  it("allows google auth URL generation for allowlisted users", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValueOnce({
      role: "user",
      email: "allowed@example.com",
      name: "Allowed User",
    });
    context.db.query.googleIntegrationAccessAllowlist.findFirst.mockResolvedValueOnce({
      id: "allow-entry-1",
    });

    const result = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "google_gmail",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };

    expect(result.authUrl).toContain("oauth.example.com/authorize");
  });

  it("rejects callback with invalid state and user mismatch", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "abc", state: "invalid-state" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const state = encodeState({
      userId: "different-user",
      type: "github",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "abc", state },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses basic auth and user-agent headers for reddit callback", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-existing",
      connectedIdentityId: "connected-identity-1",
    });
    context.db.query.connectedIdentity.findFirst.mockResolvedValue({
      id: "connected-identity-1",
      label: "provider-user",
    });

    let headers: Headers | undefined;
    let body: URLSearchParams | undefined;
    mswServer.use(
      http.post("https://oauth.example.com/token", async ({ request }) => {
        headers = request.headers;
        body = new URLSearchParams(await request.text());
        return HttpResponse.json({ access_token: "reddit-access" });
      }),
    );

    const state = encodeState({
      userId: "user-1",
      type: "reddit",
      redirectUrl: "/integrations",
      codeVerifier: "pkce-verifier",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(headers?.get("authorization")).toMatch(/^Basic /);
    expect(headers?.get("user-agent")).toContain("bap-app");
    expect(body?.get("client_id")).toBeNull();
    expect(body?.get("client_secret")).toBeNull();
    expect(body?.get("code_verifier")).toBe("pkce-verifier");
    expect(result).toEqual({
      success: true,
      integrationId: "integration-existing",
      redirectUrl: "/integrations",
    });
  });

  it("throws when token exchange fails", async () => {
    const context = createContext();

    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () => new HttpResponse("bad oauth request", { status: 400 }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "oauth-code", state },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to exchange code for tokens",
    });
  });

  it("throws when slack callback does not include user token", async () => {
    const context = createContext();

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({ access_token: "bot-token" }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "oauth-code", state },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("handles slack callback using authed_user access token", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock
      .mockResolvedValueOnce([{ id: "connected-identity-1", label: "provider-user" }])
      .mockResolvedValueOnce([{ id: "integration-slack" }]);

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          authed_user: { access_token: "slack-user-token" },
          refresh_token: "slack-refresh",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-slack",
      redirectUrl: "/integrations",
    });
  });

  it("updates existing integration instead of inserting a new one", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-existing",
      connectedIdentityId: "connected-identity-1",
    });
    context.db.query.connectedIdentity.findFirst.mockResolvedValue({
      id: "connected-identity-1",
      label: "provider-user",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-existing",
      redirectUrl: "/integrations",
    });

    expect(context.db.update).toHaveBeenCalled();
    expect(context.mocks.insertReturningMock).not.toHaveBeenCalled();
  });

  it("inserts a new integration when one does not exist", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock
      .mockResolvedValueOnce([{ id: "connected-identity-1", label: "provider-user" }])
      .mockResolvedValueOnce([{ id: "integration-new" }]);

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-new",
      redirectUrl: "/integrations",
    });
  });

  it("toggles integration enabled state", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-1",
      type: "github",
      metadata: null,
    });
    context.mocks.updateReturningMock.mockResolvedValueOnce([{ id: "integration-1" }]);

    const result = await integrationRouterAny.toggle({
      input: { id: "integration-1", enabled: false },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      enabled: false,
    });
  });

  it("throws when toggling a missing integration", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.toggle({
        input: { id: "missing", enabled: true },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("disconnects linkedin integration and deletes unipile account", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-linkedin",
      type: "linkedin",
      providerAccountId: "unipile-123",
    });

    const result = await integrationRouterAny.disconnect({
      input: { id: "integration-linkedin" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(deleteUnipileAccountMock).toHaveBeenCalledWith("unipile-123");
    expect(context.mocks.deleteWhereMock).toHaveBeenCalled();
  });

  it("continues disconnect when unipile account deletion fails", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-linkedin",
      type: "linkedin",
      providerAccountId: "unipile-456",
    });
    deleteUnipileAccountMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await integrationRouterAny.disconnect({
      input: { id: "integration-linkedin" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when disconnecting a missing integration", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.disconnect({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("links linkedin account with upsert and fallback display name", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValueOnce([
      { id: "connected-identity-1", label: "identifier-only" },
    ]);
    getUnipileAccountMock.mockResolvedValueOnce({
      name: "",
      identifier: "identifier-only",
    });

    const result = await integrationRouterAny.linkLinkedIn({
      input: { accountId: "unipile-account" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "linkedin",
        providerAccountId: "unipile-account",
        displayName: "identifier-only",
      }),
    );
  });

  it("throws when linkedin account linking fails", async () => {
    const context = createContext();
    getUnipileAccountMock.mockRejectedValueOnce(new Error("not found"));

    await expect(
      integrationRouterAny.linkLinkedIn({
        input: { accountId: "bad-account" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to link LinkedIn account",
    });
  });
});
