import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/cmdclaw_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_SERVER_SECRET ??= "test-server-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:9000";
process.env.AWS_ACCESS_KEY_ID ??= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-key";

const { ensureValidMcpOAuthCredentialMock } = vi.hoisted(() => ({
  ensureValidMcpOAuthCredentialMock: vi.fn(),
}));

vi.mock("./mcp-oauth", () => ({
  ensureValidMcpOAuthCredential: ensureValidMcpOAuthCredentialMock,
}));

const [{ encrypt }, { resolveWorkspaceMcpServersForGeneration }] = await Promise.all([
  import("../utils/encryption"),
  import("./workspace-sources"),
]);

function createSource() {
  const updatedAt = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "src-1",
    workspaceId: "ws-1",
    kind: "mcp" as const,
    name: "Linear MCP",
    namespace: "linear-mcp",
    endpoint: "https://mcp.linear.app/mcp",
    specUrl: null,
    transport: "http",
    headers: null,
    queryParams: null,
    defaultHeaders: null,
    authType: "oauth2" as const,
    authHeaderName: null,
    authQueryParam: null,
    authPrefix: null,
    enabled: true,
    revisionHash: "source-hash",
    internalKey: null,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: updatedAt,
    updatedAt,
  };
}

function createDatabase(input: {
  source: ReturnType<typeof createSource>;
  credentials: Array<Record<string, unknown>>;
}) {
  return {
    query: {
      workspaceMcpServer: {
        findMany: vi.fn(async () => [input.source]),
      },
      workspaceMcpAuthorization: {
        findMany: vi.fn(async () => input.credentials),
        findFirst: vi.fn(async () => input.credentials[0] ?? null),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  };
}

describe("Workspace MCP OAuth resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureValidMcpOAuthCredentialMock.mockResolvedValue({
      credential: {
        accessToken: "oauth-access",
        refreshToken: "oauth-refresh",
        expiresAt: new Date("2099-01-01T01:00:00.000Z"),
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
      },
      refreshed: false,
      reauthRequired: false,
    });
  });

  it("passes stored OAuth credentials to OpenCode MCP servers as bearer headers", async () => {
    const source = createSource();
    const database = createDatabase({
      source,
      credentials: [
        {
          id: "cred-1",
          workspaceMcpServerId: source.id,
          userId: "user-1",
          secret: null,
          accessToken: encrypt("oauth-access"),
          refreshToken: encrypt("oauth-refresh"),
          expiresAt: new Date("2099-01-01T01:00:00.000Z"),
          oauthMetadata: {
            tokenType: "Bearer",
            scope: "read write",
            redirectUri: "https://app.example.com/api/oauth/callback",
            resourceMetadataUrl: null,
            authorizationServerUrl: null,
            resourceMetadata: null,
            authorizationServerMetadata: null,
            clientInformation: null,
          },
          enabled: true,
          displayName: null,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
      ],
    });

    const result = await resolveWorkspaceMcpServersForGeneration({
      database: database as never,
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(result.unavailableServers).toEqual([]);
    expect(result.requestedServers).toEqual([
      expect.objectContaining({
        id: "src-1",
        namespace: "linear-mcp",
        server: expect.objectContaining({
          name: "linear-mcp",
          url: "https://mcp.linear.app/mcp",
          headers: [{ name: "Authorization", value: "Bearer oauth-access" }],
        }),
      }),
    ]);
  });

  it("refreshes expired OAuth credentials before building OpenCode MCP config", async () => {
    const source = createSource();
    const expiredAt = new Date("2025-01-01T01:00:00.000Z");
    const refreshedAt = new Date("2099-01-01T01:00:00.000Z");
    ensureValidMcpOAuthCredentialMock.mockResolvedValueOnce({
      credential: {
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresAt: refreshedAt,
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
      },
      refreshed: true,
      reauthRequired: false,
    });
    const database = createDatabase({
      source,
      credentials: [
        {
          id: "cred-1",
          workspaceMcpServerId: source.id,
          userId: "user-1",
          secret: null,
          accessToken: encrypt("expired-access"),
          refreshToken: encrypt("oauth-refresh"),
          expiresAt: expiredAt,
          oauthMetadata: {
            tokenType: "Bearer",
            scope: "read write",
            redirectUri: "https://app.example.com/api/oauth/callback",
            resourceMetadataUrl: null,
            authorizationServerUrl: null,
            resourceMetadata: null,
            authorizationServerMetadata: null,
            clientInformation: null,
          },
          enabled: true,
          displayName: null,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
      ],
    });

    const result = await resolveWorkspaceMcpServersForGeneration({
      database: database as never,
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(ensureValidMcpOAuthCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: source.endpoint,
        accessToken: "expired-access",
        refreshToken: "oauth-refresh",
        expiresAt: expiredAt,
      }),
    );
    expect(result.requestedServers[0]?.server.headers).toEqual([
      { name: "Authorization", value: "Bearer fresh-access" },
    ]);
    expect(database.insert).toHaveBeenCalled();
  });

  it("warns when an allowlisted Workspace MCP Server no longer exists", async () => {
    const database = {
      query: {
        workspaceMcpServer: {
          findMany: vi.fn(async () => []),
        },
        workspaceMcpAuthorization: {
          findMany: vi.fn(async () => []),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(),
        })),
      })),
    };

    const result = await resolveWorkspaceMcpServersForGeneration({
      database: database as never,
      workspaceId: "ws-1",
      userId: "user-1",
      allowedWorkspaceMcpServerIds: ["missing-server"],
    });

    expect(result.requestedServers).toEqual([]);
    expect(result.unavailableServers).toEqual([
      {
        id: "missing-server",
        name: "missing-server",
        namespace: "missing-server",
        reason: "Workspace MCP Server was not found in this workspace.",
      },
    ]);
  });
});
