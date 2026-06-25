import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  clientFindFirstMock,
  refreshTokenFindFirstMock,
  grantFindFirstMock,
  insertMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updatePayloads,
  signHostedMcpAccessTokenMock,
} = vi.hoisted(() => {
  const clientFindFirstMock = vi.fn<VitestProcedure>();
  const refreshTokenFindFirstMock = vi.fn<VitestProcedure>();
  const grantFindFirstMock = vi.fn<VitestProcedure>();
  const insertMock = vi.fn<VitestProcedure>();
  const updateWhereMock = vi.fn<VitestProcedure>();
  const updatePayloads: Array<Record<string, unknown>> = [];
  const updateSetMock = vi.fn<VitestProcedure>((payload: Record<string, unknown>) => {
    updatePayloads.push(payload);
    return { where: updateWhereMock };
  });
  const updateMock = vi.fn<VitestProcedure>(() => ({ set: updateSetMock }));
  const signHostedMcpAccessTokenMock = vi.fn<VitestProcedure>();

  return {
    clientFindFirstMock,
    refreshTokenFindFirstMock,
    grantFindFirstMock,
    insertMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    updatePayloads,
    signHostedMcpAccessTokenMock,
  };
});

vi.mock("@/env", () => ({
  env: {
    APP_SERVER_SECRET: "test-server-secret",
  },
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      hostedMcpOauthRefreshToken: {
        findFirst: refreshTokenFindFirstMock,
      },
      hostedMcpOauthClient: {
        findFirst: clientFindFirstMock,
      },
      hostedMcpOauthGrant: {
        findFirst: grantFindFirstMock,
      },
    },
    insert: insertMock,
    update: updateMock,
  },
}));

vi.mock("@bap/core/server/billing/service", () => ({
  getWorkspaceMembershipForUser: vi.fn<VitestProcedure>(),
  listWorkspacesForUser: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/galien/service", () => ({
  canUserUseGalienInWorkspace: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/modulr/service", () => ({
  canUserUseModulrInWorkspace: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/hosted-mcp-oauth", () => ({
  HOSTED_MCP_AUDIENCES: ["gmail", "bap", "galien", "modulr"],
  normalizeHostedMcpScopes: (value: string[] | string | null | undefined) =>
    Array.isArray(value) ? value : (value ?? "").split(/\s+/).filter(Boolean),
  resolveHostedMcpIssuerUrl: (url: URL) => url,
  signHostedMcpAccessToken: signHostedMcpAccessTokenMock,
}));

import {
  exchangeHostedMcpRefreshToken,
  parseHostedMcpAuthorizationRequest,
  renderHostedMcpConsentHtml,
} from "./hosted-mcp-oauth";

describe("hosted MCP OAuth refresh tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePayloads.length = 0;
    signHostedMcpAccessTokenMock.mockResolvedValue("access-token");
    refreshTokenFindFirstMock.mockResolvedValue({
      id: "refresh-row-1",
      grantId: "grant-1",
      clientId: "client-1",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
    });
    grantFindFirstMock.mockResolvedValue({
      id: "grant-1",
      clientId: "client-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      allowedWorkspaceIds: ["workspace-1", "workspace-2"],
      allowAllWorkspaces: false,
      audience: "galien",
      resource: "https://mcp.example.com/galien/mcp",
      scopes: ["galien"],
      revokedAt: null,
    });
    clientFindFirstMock.mockResolvedValue({
      clientId: "client-1",
      redirectUris: ["http://localhost:34567/callback/abc"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      clientName: null,
      clientUri: null,
      logoUri: null,
      contacts: null,
      policyUri: null,
      tosUri: null,
      scope: null,
    });
  });

  it("reuses the presented refresh token and extends its expiry", async () => {
    const tokens = await exchangeHostedMcpRefreshToken({
      request: new Request("https://mcp.example.com/galien/token"),
      clientId: "client-1",
      refreshToken: "stable-refresh-token",
      resource: "https://mcp.example.com/galien/mcp",
    });

    expect(tokens).toEqual({
      access_token: "access-token",
      token_type: "bearer",
      expires_in: 3600,
      scope: "galien",
      refresh_token: "stable-refresh-token",
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(updatePayloads[0]).not.toHaveProperty("revokedAt");
    expect(updateWhereMock).toHaveBeenCalled();
  });

  it("signs access tokens with the granted MCP resource issuer", async () => {
    grantFindFirstMock.mockResolvedValue({
      id: "grant-1",
      clientId: "client-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      allowedWorkspaceIds: ["workspace-1"],
      allowAllWorkspaces: false,
      audience: "bap",
      resource: "http://127.0.0.1:3010/bap",
      scopes: ["bap"],
      revokedAt: null,
    });

    await exchangeHostedMcpRefreshToken({
      request: new Request("http://localhost:3000/api/mcp/oauth/token"),
      clientId: "client-1",
      refreshToken: "stable-refresh-token",
      resource: "http://127.0.0.1:3010/bap",
    });

    expect(signHostedMcpAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedWorkspaceIds: ["workspace-1"],
        allowAllWorkspaces: false,
        audience: "bap",
        issuer: "http://127.0.0.1:3010/bap",
      }),
    );
  });
});

describe("hosted MCP OAuth authorization requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientFindFirstMock.mockResolvedValue({
      clientId: "client-1",
      redirectUris: ["http://localhost:34567/callback/abc"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      clientName: null,
      clientUri: null,
      logoUri: null,
      contacts: null,
      policyUri: null,
      tosUri: null,
      scope: null,
    });
  });

  it("accepts the Bap MCP resource used by Codex login", async () => {
    const parsed = await parseHostedMcpAuthorizationRequest(
      new URLSearchParams({
        response_type: "code",
        client_id: "client-1",
        state: "state-1",
        code_challenge: "challenge-1",
        code_challenge_method: "S256",
        redirect_uri: "http://localhost:34567/callback/abc",
        scope: "bap",
        resource: "http://127.0.0.1:3010/bap",
      }),
    );

    expect(parsed).toMatchObject({
      audience: "bap",
      resource: "http://127.0.0.1:3010/bap",
      resourceName: "Bap MCP",
      scopes: ["bap"],
    });
  });

  it("hides selected workspace checkboxes when all workspaces are authorized", () => {
    const html = renderHostedMcpConsentHtml({
      clientId: "client-1",
      clientName: "Codex",
      redirectUri: "http://localhost:34567/callback",
      audience: "bap",
      resource: "http://127.0.0.1:3010/bap",
      resourceName: "Bap MCP",
      scopes: ["bap"],
      state: "state-1",
      codeChallenge: "challenge-1",
      currentWorkspaceId: "ws-2",
      workspaces: [
        { id: "ws-1", name: "Workspace One", active: false },
        { id: "ws-2", name: "Workspace Two", active: true },
      ],
      selectedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: true,
    });

    expect(html).toContain('id="workspace-selection-panel" class="workspace-selection-panel" hidden');
    expect(html).not.toContain('name="workspace_ids" value="ws-1" checked');
    expect(html).not.toContain('name="workspace_ids" value="ws-2" checked');
  });

  it("shows and prechecks the selected workspace panel in selected mode", () => {
    const html = renderHostedMcpConsentHtml({
      clientId: "client-1",
      clientName: "Codex",
      redirectUri: "http://localhost:34567/callback",
      audience: "bap",
      resource: "http://127.0.0.1:3010/bap",
      resourceName: "Bap MCP",
      scopes: ["bap"],
      state: "state-1",
      codeChallenge: "challenge-1",
      currentWorkspaceId: "ws-2",
      workspaces: [
        { id: "ws-1", name: "Workspace One", active: false },
        { id: "ws-2", name: "Workspace Two", active: true },
      ],
      selectedWorkspaceIds: ["ws-2"],
      allowAllWorkspaces: false,
    });

    expect(html).not.toContain('id="workspace-selection-panel" class="workspace-selection-panel" hidden');
    expect(html).toContain('name="workspace_ids" value="ws-2" checked');
    expect(html).not.toContain('name="workspace_ids" value="ws-1" checked');
  });
});
