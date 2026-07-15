import { beforeEach, describe, expect, it, vi } from "vitest";

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
  startMcpOAuthAuthorizationMock,
  storeWorkspaceMcpServerOAuthPendingMock,
  requireActiveWorkspaceAccessMock,
  requireActiveWorkspaceAdminMock,
} = vi.hoisted(() => ({
  startMcpOAuthAuthorizationMock: vi.fn<VitestProcedure>(),
  storeWorkspaceMcpServerOAuthPendingMock: vi.fn<VitestProcedure>(),
  requireActiveWorkspaceAccessMock: vi.fn<VitestProcedure>(),
  requireActiveWorkspaceAdminMock: vi.fn<VitestProcedure>(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: requireActiveWorkspaceAccessMock,
  requireActiveWorkspaceAdmin: requireActiveWorkspaceAdminMock,
}));

vi.mock("@bap/core/server/executor/workspace-sources", () => ({
  computeWorkspaceMcpServerRevisionHash: vi.fn<VitestProcedure>(() => "hash"),
  listWorkspaceMcpServers: vi.fn<VitestProcedure>(() => []),
  normalizeExecutorNamespace: vi.fn<VitestProcedure>((value: string) => value),
  setWorkspaceMcpServerCredential: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/executor/mcp-oauth", () => ({
  resolveMcpEndpoint: vi.fn<VitestProcedure>(
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
    workspaceId: "ws-active",
    db: {
      query: {
        user: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({ role: "admin" }),
        },
        workspace: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({ id: "ws-1", name: "Workspace" }),
        },
        workspaceMcpServer: {
          findFirst: vi.fn<VitestProcedure>(),
        },
      },
      insert: vi.fn<VitestProcedure>(),
      update: vi.fn<VitestProcedure>(),
      delete: vi.fn<VitestProcedure>(),
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

  it("lists Workspace MCP Servers from the request workspace", async () => {
    const context = createContext();

    await expect(workspaceMcpServerRouterAny.list({ context })).resolves.toMatchObject({
      workspaceId: "ws-1",
      sources: [],
    });

    expect(requireActiveWorkspaceAccessMock).toHaveBeenCalledWith("user-1", "ws-active");
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

  it("allows Workspace members to create new MCP OAuth servers", async () => {
    const context = createContext();
    context.db.query.workspaceMcpServer.findFirst.mockResolvedValue(null);
    const returningMock = vi.fn<VitestProcedure>().mockResolvedValue([{ id: "src-1" }]);
    const valuesMock = vi.fn<VitestProcedure>(() => ({ returning: returningMock }));
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
    expect(requireActiveWorkspaceAccessMock).toHaveBeenCalledWith("user-1", "ws-active");
    expect(requireActiveWorkspaceAdminMock).not.toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: "oauth2",
        transport: null,
      }),
    );
  });
});
