import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("integrationRouter custom integrations", () => {
  beforeEach(() => {
    applyIntegrationTestBeforeEach();
  });

  it("creates custom integration and stores encrypted credentials", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "custom-1", slug: "custom-api" }]);

    const result = await integrationRouterAny.createCustomIntegration({
      input: {
        slug: "custom-api",
        name: "Custom API",
        description: "Custom integration",
        iconUrl: "https://example.com/icon.svg",
        baseUrl: "https://api.example.com",
        authType: "oauth2",
        oauthConfig: {
          authUrl: "https://api.example.com/oauth/authorize",
          tokenUrl: "https://api.example.com/oauth/token",
          scopes: ["read", "write"],
          pkce: true,
          authStyle: "params",
          extraAuthParams: { audience: "users" },
        },
        apiKeyConfig: null,
        cliCode: "console.log('hello')",
        cliInstructions: "Run the command",
        permissions: { readOps: ["users.read"], writeOps: ["users.write"] },
        clientId: "client-id",
        clientSecret: "client-secret",
        apiKey: "api-key",
      },
      context,
    });

    expect(result).toEqual({ id: "custom-1", slug: "custom-api" });
    expect(encryptMock).toHaveBeenCalledWith("client-id");
    expect(encryptMock).toHaveBeenCalledWith("client-secret");
    expect(encryptMock).toHaveBeenCalledWith("api-key");
    expect(context.mocks.insertValuesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customIntegrationId: "custom-1",
        clientId: "enc:client-id",
        clientSecret: "enc:client-secret",
        apiKey: "enc:api-key",
      }),
    );
  });

  it("creates custom integration without creating credentials when none are provided", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([
      { id: "custom-2", slug: "custom-no-creds" },
    ]);

    const result = await integrationRouterAny.createCustomIntegration({
      input: {
        slug: "custom-no-creds",
        name: "No Credential API",
        description: "No creds required",
        iconUrl: null,
        baseUrl: "https://api.example.com",
        authType: "api_key",
        oauthConfig: null,
        apiKeyConfig: { method: "header", headerName: "x-api-key" },
        cliCode: "",
        cliInstructions: "",
        permissions: { readOps: [], writeOps: [] },
        clientId: null,
        clientSecret: null,
        apiKey: null,
      },
      context,
    });

    expect(result).toEqual({ id: "custom-2", slug: "custom-no-creds" });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate custom integration slug", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "existing",
    });

    await expect(
      integrationRouterAny.createCustomIntegration({
        input: {
          slug: "custom-api",
          name: "Custom API",
          description: "Custom integration",
          iconUrl: null,
          baseUrl: "https://api.example.com",
          authType: "oauth2",
          oauthConfig: null,
          apiKeyConfig: null,
          cliCode: "",
          cliInstructions: "",
          permissions: { readOps: [], writeOps: [] },
          clientId: null,
          clientSecret: null,
          apiKey: null,
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists custom integrations with connection status", async () => {
    const context = createContext();
    context.db.query.customIntegration.findMany.mockResolvedValue([
      {
        id: "custom-1",
        slug: "first",
        name: "First",
        description: "First integration",
        iconUrl: null,
        baseUrl: "https://one.example.com",
        authType: "oauth2",
        isBuiltIn: false,
        communityStatus: null,
        communityPrUrl: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "custom-2",
        slug: "second",
        name: "Second",
        description: "Second integration",
        iconUrl: null,
        baseUrl: "https://two.example.com",
        authType: "api_key",
        isBuiltIn: true,
        communityStatus: "merged",
        communityPrUrl: "https://github.com/org/repo/pull/1",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
    context.db.query.customIntegrationCredential.findMany.mockResolvedValue([
      {
        id: "cred-1",
        customIntegrationId: "custom-1",
        enabled: true,
        displayName: "Connected First",
      },
    ]);

    const result = await integrationRouterAny.listCustomIntegrations({
      context,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "custom-1",
        connected: true,
        enabled: true,
        displayName: "Connected First",
      }),
      expect.objectContaining({
        id: "custom-2",
        connected: false,
        enabled: false,
        displayName: null,
      }),
    ]);
  });

  it("gets custom integration details with credential flags", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      name: "My Custom",
      description: "desc",
      authType: "oauth2",
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: "enc:id",
      clientSecret: "enc:secret",
      apiKey: "enc:key",
      enabled: true,
      displayName: "My Account",
    });

    const result = await integrationRouterAny.getCustomIntegration({
      input: { slug: "my-custom" },
      context,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "custom-1",
        connected: true,
        enabled: true,
        displayName: "My Account",
        hasClientId: true,
        hasClientSecret: true,
        hasApiKey: true,
      }),
    );
  });

  it("throws when custom integration is not found", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.getCustomIntegration({
        input: { slug: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("handles custom integration credential and connectivity flow", async () => {
    const context = createContext();

    await integrationRouterAny.setCustomCredentials({
      input: {
        customIntegrationId: "custom-1",
        clientId: "my-client-id",
        clientSecret: "my-client-secret",
        apiKey: "my-api-key",
        displayName: "My Custom API",
      },
      context,
    });

    expect(encryptMock).toHaveBeenCalledWith("my-client-id");
    expect(encryptMock).toHaveBeenCalledWith("my-client-secret");
    expect(encryptMock).toHaveBeenCalledWith("my-api-key");

    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read", "write"],
        pkce: true,
        authStyle: "params",
      },
    });
    context.db.query.customIntegrationCredential.findFirst
      .mockResolvedValueOnce({
        id: "cred-1",
        customIntegrationId: "custom-1",
        clientId: "enc:my-client-id",
      })
      .mockResolvedValueOnce({
        id: "cred-1",
        customIntegrationId: "custom-1",
        clientId: "enc:my-client-id",
        clientSecret: "enc:my-client-secret",
      });

    const authUrlResult = (await integrationRouterAny.getCustomAuthUrl({
      input: {
        slug: "my-custom",
        redirectUrl: "https://app.example.com/integrations/custom",
      },
      context,
    })) as { authUrl: string };

    const customAuthUrl = new URL(authUrlResult.authUrl);
    expect(customAuthUrl.searchParams.get("client_id")).toBe("my-client-id");
    expect(customAuthUrl.searchParams.get("code_challenge")).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn<VitestProcedure>(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "custom-access-token",
              refresh_token: "custom-refresh-token",
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const customState = encodeState({
      userId: "user-1",
      type: "custom_my-custom",
      redirectUrl: "/integrations/custom",
      codeVerifier: "verifier-123",
    });

    const callbackResult = await integrationRouterAny.handleCustomCallback({
      input: { code: "custom-code", state: customState },
      context,
    });

    expect(callbackResult).toEqual({
      success: true,
      redirectUrl: "/integrations/custom",
    });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "custom-access-token",
        refreshToken: "custom-refresh-token",
        enabled: true,
      }),
    );
  });

  it("disconnects custom integration credentials", async () => {
    const context = createContext();

    const result = await integrationRouterAny.disconnectCustomIntegration({
      input: { customIntegrationId: "custom-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.deleteWhereMock).toHaveBeenCalled();
  });

  it("toggles custom integration credentials", async () => {
    const context = createContext();
    context.mocks.updateReturningMock.mockResolvedValueOnce([{ id: "cred-1" }]);

    const result = await integrationRouterAny.toggleCustomIntegration({
      input: { customIntegrationId: "custom-1", enabled: false },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when toggling missing custom credentials", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.toggleCustomIntegration({
        input: { customIntegrationId: "missing", enabled: true },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes a custom integration owned by the user", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValueOnce([{ id: "custom-1" }]);

    const result = await integrationRouterAny.deleteCustomIntegration({
      input: { id: "custom-1" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when deleting a missing custom integration", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.deleteCustomIntegration({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects invalid OAuth custom integrations for auth URL", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "api_key",
      oauthConfig: null,
    });

    await expect(
      integrationRouterAny.getCustomAuthUrl({
        input: {
          slug: "my-custom",
          redirectUrl: "https://app.example.com/custom",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects custom auth URL when credentials are missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        pkce: false,
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: null,
    });

    await expect(
      integrationRouterAny.getCustomAuthUrl({
        input: {
          slug: "my-custom",
          redirectUrl: "https://app.example.com/custom",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("adds extra auth params for custom OAuth URL", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        pkce: false,
        extraAuthParams: {
          audience: "users",
          approval_prompt: "force",
        },
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
    });

    const result = (await integrationRouterAny.getCustomAuthUrl({
      input: {
        slug: "my-custom",
        redirectUrl: "https://app.example.com/custom",
      },
      context,
    })) as { authUrl: string };

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get("audience")).toBe("users");
    expect(authUrl.searchParams.get("approval_prompt")).toBe("force");
    expect(authUrl.searchParams.get("code_challenge")).toBeNull();
  });

  it("validates state and identity in custom callback", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: { code: "code", state: "bad-state" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "someone-else",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws when custom callback integration is missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_missing",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws when custom callback credentials are missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: "enc:client-id",
      clientSecret: null,
    });

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uses header auth style for custom callback token exchange", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        authStyle: "header",
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
      clientSecret: "enc:client-secret",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mswServer.use(
      http.post(/.*/, () => HttpResponse.json({ access_token: "token" }), { once: true }),
    );

    const result = await integrationRouterAny.handleCustomCallback({
      input: {
        code: "code",
        state: encodeState({
          userId: "user-1",
          type: "custom_my-custom",
          redirectUrl: "/custom",
        }),
      },
      context,
    });

    const requestInit = (fetchSpy.mock.calls as unknown[][])[0]?.[1] as RequestInit | undefined;
    const headers = requestInit?.headers as Record<string, string> | undefined;
    const body = requestInit?.body as URLSearchParams | undefined;

    expect(headers?.Authorization).toMatch(/^Basic /);
    expect(body?.get("client_id")).toBeNull();
    expect(body?.get("client_secret")).toBeNull();
    expect(result).toEqual({ success: true, redirectUrl: "/custom" });
    fetchSpy.mockRestore();
  });

  it("throws when custom callback token exchange fails", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        authStyle: "params",
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
      clientSecret: "enc:client-secret",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("token exchange failed", { status: 401 }),
    );

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to exchange code for tokens",
    });
  });
});
