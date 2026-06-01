import { beforeEach, describe, expect, it, vi } from "vitest";

function createProcedureStub() {
  const stub = {
    input: vi.fn(),
    output: vi.fn(),
    handler: vi.fn((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  startMcpOAuthAuthorizationMock,
  storeWorkspaceMcpServerOAuthPendingMock,
  requireActiveWorkspaceAccessMock,
  requireActiveWorkspaceAdminMock,
} = vi.hoisted(() => ({
  startMcpOAuthAuthorizationMock: vi.fn(),
  storeWorkspaceMcpServerOAuthPendingMock: vi.fn(),
  requireActiveWorkspaceAccessMock: vi.fn(),
  requireActiveWorkspaceAdminMock: vi.fn(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: requireActiveWorkspaceAccessMock,
  requireActiveWorkspaceAdmin: requireActiveWorkspaceAdminMock,
}));

vi.mock("@cmdclaw/core/server/executor/workspace-sources", () => ({
  computeWorkspaceMcpServerRevisionHash: vi.fn(() => "hash"),
  listWorkspaceMcpServers: vi.fn(() => []),
  normalizeExecutorNamespace: vi.fn((value: string) => value),
  setWorkspaceMcpServerCredential: vi.fn(),
}));

vi.mock("@cmdclaw/core/server/executor/mcp-oauth", () => ({
  resolveMcpEndpoint: vi.fn(
    ({
      endpoint,
      queryParams,
    }: {
      endpoint: string;
      queryParams?: Record<string, string> | null;
    }) => (queryParams?.region ? `${endpoint}?region=${queryParams.region}` : endpoint),
  ),
  startMcpOAuthAuthorization: startMcpOAuthAuthorizationMock,
}));

vi.mock("@/server/executor-source-oauth", () => ({
  storeWorkspaceMcpServerOAuthPending: storeWorkspaceMcpServerOAuthPendingMock,
}));

import { workspaceMcpServerInputSchema, workspaceMcpServerRouter } from "./executor-source";

const workspaceMcpServerRouterAny = workspaceMcpServerRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

function createContext() {
  return {
    user: { id: "user-1" },
    db: {
      query: {
        user: {
          findFirst: vi.fn().mockResolvedValue({ role: "admin" }),
        },
        workspace: {
          findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Workspace" }),
        },
        workspaceMcpServer: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("workspaceMcpServerRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireActiveWorkspaceAccessMock.mockResolvedValue({
      workspace: { id: "ws-1", name: "Workspace" },
      membership: { role: "member" },
    });
    requireActiveWorkspaceAdminMock.mockResolvedValue({
      workspace: { id: "ws-1", name: "Workspace" },
      membership: { role: "owner" },
    });
  });

  it("accepts oauth2 auth for Workspace MCP Servers", () => {
    const parsed = workspaceMcpServerInputSchema.safeParse({
      kind: "mcp",
      name: "Linear MCP",
      namespace: "linear-mcp",
      endpoint: "https://mcp.linear.app/mcp",
      authType: "oauth2",
      enabled: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects non-MCP Workspace MCP Server kinds", () => {
    const parsed = workspaceMcpServerInputSchema.safeParse({
      kind: "http",
      name: "GitHub",
      namespace: "github",
      endpoint: "https://api.github.com",
      authType: "oauth2",
      enabled: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("starts MCP OAuth for a Workspace MCP Server", async () => {
    const context = createContext();
    context.db.query.workspaceMcpServer.findFirst.mockResolvedValue({
      id: "src-1",
      workspaceId: "ws-1",
      kind: "mcp",
      authType: "oauth2",
      endpoint: "https://mcp.linear.app/mcp",
      queryParams: { region: "eu" },
    });
    startMcpOAuthAuthorizationMock.mockResolvedValue({
      authorizationUrl: "https://linear.app/oauth/authorize?state=abc",
      session: {
        endpoint: "https://mcp.linear.app/mcp?region=eu",
        redirectUrl: "https://app.example.com/api/oauth/callback",
        codeVerifier: "verifier",
        resourceMetadataUrl: null,
        authorizationServerUrl: null,
        resourceMetadata: null,
        authorizationServerMetadata: null,
        clientInformation: null,
      },
    });

    const result = await workspaceMcpServerRouterAny.startOAuth({
      input: {
        workspaceMcpServerId: "src-1",
        redirectUrl: "https://app.example.com/toolbox/sources/src-1",
      },
      context,
    });

    expect(result).toEqual({
      authUrl: "https://linear.app/oauth/authorize?state=abc",
    });
    expect(startMcpOAuthAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://mcp.linear.app/mcp?region=eu",
        redirectUrl: expect.stringContaining("/api/oauth/callback"),
        state: expect.any(String),
      }),
    );
    expect(storeWorkspaceMcpServerOAuthPendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceMcpServerId: "src-1",
        redirectUrl: "https://app.example.com/toolbox/sources/src-1",
      }),
    );
  });

  it("rejects starting OAuth for a non-oauth source", async () => {
    const context = createContext();
    context.db.query.workspaceMcpServer.findFirst.mockResolvedValue({
      id: "src-1",
      workspaceId: "ws-1",
      kind: "mcp",
      authType: "bearer",
      endpoint: "https://mcp.linear.app/mcp",
      queryParams: null,
    });

    await expect(
      workspaceMcpServerRouterAny.startOAuth({
        input: {
          workspaceMcpServerId: "src-1",
          redirectUrl: "https://app.example.com/toolbox/sources/src-1",
        },
        context,
      }),
    ).rejects.toMatchObject({
      message: "This Workspace MCP Server is not configured for MCP OAuth.",
    });
  });

  it("creates new MCP OAuth servers for native OpenCode MCP resolution", async () => {
    const context = createContext();
    context.db.query.workspaceMcpServer.findFirst.mockResolvedValue(null);
    const returningMock = vi.fn().mockResolvedValue([{ id: "src-1" }]);
    const valuesMock = vi.fn(() => ({ returning: returningMock }));
    context.db.insert.mockReturnValue({ values: valuesMock });

    const result = await workspaceMcpServerRouterAny.create({
      input: {
        kind: "mcp",
        name: "Linear MCP",
        namespace: "linear-mcp",
        endpoint: "https://mcp.linear.app/mcp",
        authType: "oauth2",
        enabled: true,
      },
      context,
    });

    expect(result).toEqual({ id: "src-1" });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: "oauth2",
        transport: null,
      }),
    );
  });
});
