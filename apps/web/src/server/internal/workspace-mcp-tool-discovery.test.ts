import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  buildUpstreamMock,
  clientCloseMock,
  clientConnectMock,
  clientListToolsMock,
  persistCatalogMock,
  hasManagedAccessMock,
} = vi.hoisted(() => ({
  buildUpstreamMock: vi.fn<VitestProcedure>(),
  clientCloseMock: vi.fn<VitestProcedure>(),
  clientConnectMock: vi.fn<VitestProcedure>(),
  clientListToolsMock: vi.fn<VitestProcedure>(),
  persistCatalogMock: vi.fn<VitestProcedure>(),
  hasManagedAccessMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/executor/workspace-sources", () => ({
  buildWorkspaceMcpUpstreamRuntimeServer: buildUpstreamMock,
}));

vi.mock("@bap/core/server/services/workspace-integration-policy", () => ({
  hasWorkspaceManagedMcpAccess: hasManagedAccessMock,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    close = clientCloseMock;
    connect = clientConnectMock;
    listTools = clientListToolsMock;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn<VitestProcedure>(),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn<VitestProcedure>(),
}));

vi.mock("./workspace-mcp-tool-catalog", () => ({
  persistWorkspaceMcpToolCatalog: persistCatalogMock,
}));

import { discoverWorkspaceMcpToolCatalog } from "./workspace-mcp-tool-discovery";

function database() {
  return {
    query: {
      workspaceMcpServer: {
        findMany: vi.fn<VitestProcedure>().mockResolvedValue([
          {
            id: "server-1",
            workspaceId: "workspace-1",
            name: "CRM",
            internalKey: null,
            enabled: true,
          },
          {
            id: "bap-server",
            workspaceId: "workspace-1",
            name: "Bap",
            internalKey: "bap",
            enabled: true,
          },
          {
            id: "galien-server",
            workspaceId: "workspace-1",
            name: "Galien MCP",
            internalKey: "galien",
            enabled: true,
            managedWorkspaceWideAccess: false,
          },
        ]),
      },
      workspaceMcpAuthorization: {
        findMany: vi.fn<VitestProcedure>().mockResolvedValue([
          {
            id: "authorization-1",
            workspaceMcpServerId: "server-1",
            userId: "user-1",
            enabled: true,
          },
        ]),
      },
    },
  };
}

describe("discoverWorkspaceMcpToolCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildUpstreamMock.mockResolvedValue({
      type: "http",
      name: "crm",
      url: "https://mcp.example.test",
      headers: [{ name: "Authorization", value: "Bearer test" }],
    });
    clientConnectMock.mockResolvedValue(undefined);
    clientCloseMock.mockResolvedValue(undefined);
    clientListToolsMock
      .mockResolvedValueOnce({
        tools: [{ name: "list_leads", inputSchema: { type: "object" } }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        tools: [{ name: "create_lead", inputSchema: { type: "object" } }],
      });
    persistCatalogMock.mockResolvedValue(undefined);
    hasManagedAccessMock.mockResolvedValue(false);
  });

  it("initializes enabled MCP servers, follows pagination, and persists the full catalog", async () => {
    const db = database();

    await discoverWorkspaceMcpToolCatalog({
      database: db as never,
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    expect(buildUpstreamMock).toHaveBeenCalledOnce();
    expect(hasManagedAccessMock).toHaveBeenCalledWith({
      database: db,
      workspaceId: "workspace-1",
      internalKey: "galien",
      managedWorkspaceWideAccess: false,
    });
    expect(buildUpstreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ id: "server-1" }),
        credential: expect.objectContaining({ id: "authorization-1" }),
        userId: "user-1",
      }),
    );
    expect(clientConnectMock).toHaveBeenCalledOnce();
    expect(clientListToolsMock).toHaveBeenNthCalledWith(1, undefined);
    expect(clientListToolsMock).toHaveBeenNthCalledWith(2, { cursor: "next" });
    expect(persistCatalogMock).toHaveBeenCalledWith({
      database: db,
      workspaceMcpServerId: "server-1",
      tools: [
        { name: "list_leads", inputSchema: { type: "object" } },
        { name: "create_lead", inputSchema: { type: "object" } },
      ],
      markMissingUnavailable: true,
    });
    expect(clientCloseMock).toHaveBeenCalledOnce();
  });

  it("stops discovery when a server repeats a pagination cursor", async () => {
    clientListToolsMock.mockReset().mockResolvedValue({
      tools: [],
      nextCursor: "repeated",
    });

    await discoverWorkspaceMcpToolCatalog({
      database: database() as never,
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    expect(clientListToolsMock).toHaveBeenCalledTimes(2);
    expect(persistCatalogMock).not.toHaveBeenCalled();
    expect(clientCloseMock).toHaveBeenCalledOnce();
  });
});
