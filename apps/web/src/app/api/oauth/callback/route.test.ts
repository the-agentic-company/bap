import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "@/test/msw/server";

type MockFn = (...args: unknown[]) => unknown;

const {
  getSessionMock,
  getOAuthConfigMock,
  fetchDynamicsInstancesMock,
  submitAuthResultMock,
  submitAuthResultByInterruptMock,
  consumeExecutorSourceOAuthPendingMock,
  exchangeMcpOAuthAuthorizationCodeMock,
  computeWorkspaceExecutorSourceRevisionHashMock,
  setWorkspaceExecutorSourceOAuthCredentialMock,
  integrationFindFirstMock,
  connectedIdentityFindManyMock,
  connectedIdentityFindFirstMock,
  workspaceExecutorSourceFindFirstMock,
  workspaceExecutorSourceCredentialFindFirstMock,
  updateWhereMock,
  deleteWhereMock,
  insertReturningMock,
  insertValuesMock,
  dbMock,
} = vi.hoisted(() => {
  const getSessionMock = vi.fn<MockFn>();
  const getOAuthConfigMock = vi.fn<MockFn>();
  const fetchDynamicsInstancesMock = vi.fn<MockFn>();
  const submitAuthResultMock = vi.fn<MockFn>();
  const submitAuthResultByInterruptMock = vi.fn<MockFn>();
  const consumeExecutorSourceOAuthPendingMock = vi.fn<MockFn>();
  const exchangeMcpOAuthAuthorizationCodeMock = vi.fn<MockFn>();
  const computeWorkspaceExecutorSourceRevisionHashMock = vi.fn<MockFn>(() => "native-hash");
  const setWorkspaceExecutorSourceOAuthCredentialMock = vi.fn<MockFn>();

  const integrationFindFirstMock = vi.fn<MockFn>();
  const connectedIdentityFindManyMock = vi.fn<MockFn>();
  const connectedIdentityFindFirstMock = vi.fn<MockFn>();
  const workspaceExecutorSourceFindFirstMock = vi.fn<MockFn>();
  const workspaceExecutorSourceCredentialFindFirstMock = vi.fn<MockFn>();

  const updateWhereMock = vi.fn<MockFn>();
  const updateSetMock = vi.fn<MockFn>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<MockFn>(() => ({ set: updateSetMock }));

  const deleteWhereMock = vi.fn<MockFn>();
  const deleteMock = vi.fn<MockFn>(() => ({ where: deleteWhereMock }));

  const insertReturningMock = vi.fn<MockFn>();
  const insertValuesMock = vi.fn<MockFn>(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn<MockFn>(() => ({ values: insertValuesMock }));

  const dbMock = {
    query: {
      integration: {
        findFirst: integrationFindFirstMock,
      },
      connectedIdentity: {
        findMany: connectedIdentityFindManyMock,
        findFirst: connectedIdentityFindFirstMock,
      },
      workspaceExecutorSource: {
        findFirst: workspaceExecutorSourceFindFirstMock,
      },
      workspaceExecutorSourceCredential: {
        findFirst: workspaceExecutorSourceCredentialFindFirstMock,
      },
    },
    update: updateMock,
    delete: deleteMock,
    insert: insertMock,
  };

  return {
    getSessionMock,
    getOAuthConfigMock,
    fetchDynamicsInstancesMock,
    submitAuthResultMock,
    submitAuthResultByInterruptMock,
    consumeExecutorSourceOAuthPendingMock,
    exchangeMcpOAuthAuthorizationCodeMock,
    computeWorkspaceExecutorSourceRevisionHashMock,
    setWorkspaceExecutorSourceOAuthCredentialMock,
    integrationFindFirstMock,
    connectedIdentityFindManyMock,
    connectedIdentityFindFirstMock,
    workspaceExecutorSourceFindFirstMock,
    workspaceExecutorSourceCredentialFindFirstMock,
    updateWhereMock,
    deleteWhereMock,
    insertReturningMock,
    insertValuesMock,
    dbMock,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("@cmdclaw/core/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@cmdclaw/core/server/executor/mcp-oauth", () => ({
  exchangeMcpOAuthAuthorizationCode: exchangeMcpOAuthAuthorizationCodeMock,
}));

vi.mock("@cmdclaw/core/server/executor/workspace-sources", () => ({
  computeWorkspaceExecutorSourceRevisionHash: computeWorkspaceExecutorSourceRevisionHashMock,
  setWorkspaceExecutorSourceOAuthCredential: setWorkspaceExecutorSourceOAuthCredentialMock,
}));

vi.mock("@/server/integrations/dynamics", () => ({
  fetchDynamicsInstances: fetchDynamicsInstancesMock,
}));

vi.mock("@/server/executor-source-oauth", () => ({
  consumeExecutorSourceOAuthPending: consumeExecutorSourceOAuthPendingMock,
}));

vi.mock("@cmdclaw/core/server/services/generation-manager", () => ({
  generationManager: {
    submitAuthResult: submitAuthResultMock,
    submitAuthResultByInterrupt: submitAuthResultByInterruptMock,
  },
}));

import { GET } from "./route";

function encodeState(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function getLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("GET /api/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    fetchDynamicsInstancesMock.mockResolvedValue([
      {
        id: "env-1",
        friendlyName: "Prod",
        instanceUrl: "https://acme.crm.dynamics.com",
        apiUrl: "https://acme.crm.dynamics.com/api/data/v9.2",
      },
    ]);
    submitAuthResultMock.mockResolvedValue(true);
    submitAuthResultByInterruptMock.mockResolvedValue(true);
    consumeExecutorSourceOAuthPendingMock.mockResolvedValue(undefined);
    exchangeMcpOAuthAuthorizationCodeMock.mockResolvedValue({
      accessToken: "oauth-access",
      refreshToken: "oauth-refresh",
      expiresAt: new Date("2025-01-01T00:00:00.000Z"),
      metadata: {
        tokenType: "Bearer",
        scope: "read write",
        redirectUri: "https://app.example.com/api/oauth/callback",
        resourceMetadataUrl: null,
        authorizationServerUrl: null,
        resourceMetadata: null,
        authorizationServerMetadata: null,
        clientInformation: null,
      },
    });
    setWorkspaceExecutorSourceOAuthCredentialMock.mockResolvedValue(undefined);
    integrationFindFirstMock.mockResolvedValue(null);
    connectedIdentityFindManyMock.mockResolvedValue([]);
    connectedIdentityFindFirstMock.mockResolvedValue(null);
    workspaceExecutorSourceFindFirstMock.mockResolvedValue(null);
    workspaceExecutorSourceCredentialFindFirstMock.mockResolvedValue(null);
    insertReturningMock
      .mockResolvedValueOnce([{ id: "connected-identity-1", label: "provider-user" }])
      .mockResolvedValue([{ id: "integration-1" }]);
    deleteWhereMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);

    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenUrl: "https://oauth.example.com/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["scope:one"],
      getUserInfo: vi.fn<MockFn>(async () => ({
        id: "provider-user",
        displayName: "Provider User",
        metadata: { team: "alpha" },
      })),
    });
  });

  it("redirects with missing_params when code/state are missing", async () => {
    const request = new NextRequest("https://app.example.com/api/oauth/callback");

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/toolbox?error=missing_params");
  });

  it("uses APP_URL for early redirects when request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";

    const request = new NextRequest("https://0.0.0.0:8080/api/oauth/callback");

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/toolbox?error=missing_params");
  });

  it("redirects to login when session is unauthorized", async () => {
    getSessionMock.mockResolvedValue(null);

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${encodeState({ userId: "user-1", type: "github", redirectUrl: "/integrations" })}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/login?error=unauthorized");
  });

  it("redirects with invalid_state when state cannot be parsed", async () => {
    const request = new NextRequest(
      "https://app.example.com/api/oauth/callback?code=abc&state=not-base64-json",
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/toolbox?error=invalid_state");
  });

  it("redirects with user_mismatch when callback state user does not match session", async () => {
    const state = encodeState({
      userId: "another-user",
      type: "github",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?error=user_mismatch");
  });

  it("redirects executor-source OAuth errors back to the source page", async () => {
    consumeExecutorSourceOAuthPendingMock.mockResolvedValue({
      userId: "user-1",
      sourceId: "src-1",
      redirectUrl: "https://app.example.com/toolbox/sources/src-1",
      session: {
        endpoint: "https://mcp.linear.app/mcp",
        redirectUrl: "https://app.example.com/api/oauth/callback",
        codeVerifier: "verifier",
        resourceMetadataUrl: null,
        authorizationServerUrl: null,
        resourceMetadata: null,
        authorizationServerMetadata: null,
        clientInformation: null,
      },
    });

    const request = new NextRequest(
      "https://app.example.com/api/oauth/callback?state=executor-state&error=access_denied",
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/toolbox/sources/src-1?oauth=error&oauth_error=access_denied",
    );
  });

  it("stores executor-source OAuth credentials and redirects back to the source page", async () => {
    consumeExecutorSourceOAuthPendingMock.mockResolvedValue({
      userId: "user-1",
      sourceId: "src-1",
      redirectUrl: "https://app.example.com/toolbox/sources/src-1",
      session: {
        endpoint: "https://mcp.linear.app/mcp",
        redirectUrl: "https://app.example.com/api/oauth/callback",
        codeVerifier: "verifier",
        resourceMetadataUrl: null,
        authorizationServerUrl: null,
        resourceMetadata: null,
        authorizationServerMetadata: null,
        clientInformation: null,
      },
    });
    workspaceExecutorSourceFindFirstMock.mockResolvedValue({
      id: "src-1",
      name: "Linear",
      namespace: "linear",
      endpoint: "https://mcp.linear.app/mcp",
      specUrl: null,
      transport: "streamable-http",
      headers: null,
      queryParams: null,
      defaultHeaders: null,
      kind: "mcp",
      authType: "oauth2",
      authHeaderName: null,
      authQueryParam: null,
      authPrefix: null,
      enabled: true,
    });
    workspaceExecutorSourceCredentialFindFirstMock.mockResolvedValue({
      displayName: "Linear",
      enabled: false,
    });

    const request = new NextRequest(
      "https://app.example.com/api/oauth/callback?code=oauth-code&state=executor-state",
    );

    const response = await GET(request);

    expect(exchangeMcpOAuthAuthorizationCodeMock).toHaveBeenCalledWith({
      session: expect.objectContaining({
        endpoint: "https://mcp.linear.app/mcp",
      }),
      code: "oauth-code",
    });
    expect(setWorkspaceExecutorSourceOAuthCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceExecutorSourceId: "src-1",
        userId: "user-1",
        accessToken: "oauth-access",
        refreshToken: "oauth-refresh",
        displayName: "Linear",
        enabled: false,
      }),
    );
    expect(computeWorkspaceExecutorSourceRevisionHashMock).toHaveBeenCalledWith(
      expect.objectContaining({ authType: "oauth2" }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    expect(getLocation(response)).toBe(
      "https://app.example.com/toolbox/sources/src-1?oauth=success",
    );
  });

  it("redirects with token_exchange_failed when token exchange fails", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () =>
          new HttpResponse("bad exchange", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/integrations?error=token_exchange_failed",
    );
  });

  it("parses Slack authed_user tokens", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/settings/integrations",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          authed_user: {
            access_token: "xoxp-user-token",
            refresh_token: "refresh",
          },
        }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/settings/integrations?success=true",
    );

    const tokenInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "accessToken" in call[0]);
    expect(tokenInsertCall?.[0]).toEqual(
      expect.objectContaining({
        accessToken: "xoxp-user-token",
        refreshToken: "refresh",
      }),
    );
  });

  it("uses Basic auth and omits client credentials in body for twitter token exchange", async () => {
    let authHeader: string | null = null;
    let bodyClientId: string | null = null;
    let bodyClientSecret: string | null = null;

    mswServer.use(
      http.post("https://oauth.example.com/token", async ({ request }) => {
        authHeader = request.headers.get("authorization");
        const body = await request.formData();
        bodyClientId = body.get("client_id")?.toString() ?? null;
        bodyClientSecret = body.get("client_secret")?.toString() ?? null;
        return HttpResponse.json({
          access_token: "twitter-access",
          refresh_token: "twitter-refresh",
        });
      }),
    );

    const state = encodeState({
      userId: "user-1",
      type: "twitter",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?success=true");
    expect(authHeader).toBe("Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=");
    expect(bodyClientId).toBeNull();
    expect(bodyClientSecret).toBeNull();
  });

  it("preserves existing redirect query params when appending success", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "google_sheets",
      redirectUrl: "/chat/conv-1?auth_complete=google_sheets&interrupt_id=interrupt-1",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "sheet-token",
          refresh_token: "sheet-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);
    const location = getLocation(response);

    expect(location).toContain("https://app.example.com/chat/conv-1?");
    expect(location).toContain("auth_complete=google_sheets");
    expect(location).toContain("interrupt_id=interrupt-1");
    expect(location).toContain("success=true");
    expect(submitAuthResultByInterruptMock).toHaveBeenCalledWith(
      "interrupt-1",
      "google_sheets",
      true,
      "user-1",
    );
  });

  it("normalizes internal redirect targets from OAuth state to APP_URL", async () => {
    process.env.APP_URL = "https://app.example.com";

    const state = encodeState({
      userId: "user-1",
      type: "outlook",
      redirectUrl: "https://0.0.0.0:8080/toolbox?auth_complete=outlook&interrupt_id=interrupt-1",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "outlook-token",
          refresh_token: "outlook-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const request = new NextRequest(
      `https://0.0.0.0:8080/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/toolbox?auth_complete=outlook&interrupt_id=interrupt-1&success=true",
    );
    expect(submitAuthResultByInterruptMock).toHaveBeenCalledWith(
      "interrupt-1",
      "outlook",
      true,
      "user-1",
    );
  });

  it("merges Salesforce instance_url into metadata", async () => {
    const getUserInfo = vi.fn<MockFn>(async () => ({
      id: "sf-user",
      displayName: "Salesforce User",
      metadata: { org: "acme" },
    }));

    getOAuthConfigMock.mockReturnValue({
      clientId: "sf-client",
      clientSecret: "sf-secret",
      tokenUrl: "https://login.salesforce.com/services/oauth2/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["api"],
      getUserInfo,
    });

    mswServer.use(
      http.post("https://login.salesforce.com/services/oauth2/token", () =>
        HttpResponse.json({
          access_token: "sf-access",
          refresh_token: "sf-refresh",
          instance_url: "https://acme.my.salesforce.com",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "salesforce",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?success=true");

    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        metadata: {
          org: "acme",
          instanceUrl: "https://acme.my.salesforce.com",
        },
      }),
    );
  });

  it("redirects dynamics callback to environment selection and stores pending metadata", async () => {
    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "dyn-access",
          refresh_token: "dyn-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "dynamics",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/toolbox?dynamics_select=true");
    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        metadata: expect.objectContaining({
          pendingInstanceSelection: true,
        }),
      }),
    );
    expect(submitAuthResultMock).not.toHaveBeenCalled();
  });

  it("uses APP_URL for dynamics selection redirect when request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "dyn-access",
          refresh_token: "dyn-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "dynamics",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://0.0.0.0:8080/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/toolbox?dynamics_select=true");
  });

  it("completes dynamics instance-scoped callback and enables integration", async () => {
    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "dyn-instance-access",
          refresh_token: "dyn-instance-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "dynamics",
      redirectUrl: "/integrations?auth_complete=dynamics&interrupt_id=interrupt-1",
      dynamicsInstanceUrl: "https://org123.api.crm4.dynamics.com",
      dynamicsInstanceName: "Contoso Prod",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/integrations?auth_complete=dynamics&interrupt_id=interrupt-1&success=true",
    );
    expect(fetchDynamicsInstancesMock).not.toHaveBeenCalled();
    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        scopes: expect.arrayContaining(["https://org123.api.crm4.dynamics.com/user_impersonation"]),
        metadata: expect.objectContaining({
          pendingInstanceSelection: false,
          instanceUrl: "https://org123.api.crm4.dynamics.com",
          instanceName: "Contoso Prod",
        }),
      }),
    );
    expect(submitAuthResultByInterruptMock).toHaveBeenCalledWith(
      "interrupt-1",
      "dynamics",
      true,
      "user-1",
    );
  });
});
