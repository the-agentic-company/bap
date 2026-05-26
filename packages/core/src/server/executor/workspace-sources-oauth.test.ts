import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../utils/encryption";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/cmdclaw_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CMDCLAW_SERVER_SECRET ??= "test-server-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:9000";
process.env.AWS_ACCESS_KEY_ID ??= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-key";

const { ensureValidMcpOAuthCredentialMock } = vi.hoisted(() => ({
  ensureValidMcpOAuthCredentialMock: vi.fn(),
}));

vi.mock("./mcp-oauth", () => ({
  ensureValidMcpOAuthCredential: ensureValidMcpOAuthCredentialMock,
}));

const {
  getWorkspaceExecutorBootstrap,
  getWorkspaceExecutorNativeMcpOAuthBootstrapSources,
  listWorkspaceExecutorSources,
} = await import("./workspace-sources");

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
    transport: "streamable-http",
    headers: null,
    queryParams: null,
    defaultHeaders: null,
    authType: "oauth2" as const,
    authHeaderName: null,
    authQueryParam: null,
    authPrefix: null,
    enabled: true,
    revisionHash: "source-hash",
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: updatedAt,
    updatedAt,
  };
}

function createPackageRow(source: ReturnType<typeof createSource>) {
  const revisionHash = createHash("sha256")
    .update(
      JSON.stringify([
        {
          id: source.id,
          revisionHash: source.revisionHash,
          enabled: source.enabled,
          updatedAt: source.updatedAt.toISOString(),
        },
      ]),
    )
    .digest("hex");

  return {
    revisionHash,
    configJson: `${JSON.stringify(
      {
        workspace: { name: "Workspace" },
        sources: {
          [source.id]: {
            kind: "mcp",
            name: source.name,
            namespace: source.namespace,
            enabled: source.enabled,
            config: {
              endpoint: source.endpoint,
              transport: source.transport,
              queryParams: source.queryParams,
              headers: source.headers,
              command: null,
              args: null,
              env: null,
              cwd: null,
              auth: { kind: "none" },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    workspaceStateJson: `${JSON.stringify(
      {
        version: 1,
        sources: {
          [source.id]: {
            status: "connected",
            lastError: null,
            sourceHash: source.revisionHash,
            createdAt: source.createdAt.getTime(),
            updatedAt: source.updatedAt.getTime(),
          },
        },
        policies: {},
      },
      null,
      2,
    )}\n`,
    workspaceId: "ws-1",
    builtAt: source.updatedAt,
    createdAt: source.updatedAt,
    updatedAt: source.updatedAt,
  };
}

function createDatabase(input: {
  source: ReturnType<typeof createSource>;
  packageRow: ReturnType<typeof createPackageRow>;
  credentials: Array<Record<string, unknown>>;
}) {
  const credentialFindFirstMock = vi.fn(async () => input.credentials[0] ?? null);

  return {
    query: {
      workspaceExecutorPackage: {
        findFirst: vi.fn(async () => input.packageRow),
      },
      workspaceExecutorSource: {
        findMany: vi.fn(async () => [input.source]),
      },
      workspaceExecutorSourceCredential: {
        findMany: vi.fn(async () => input.credentials),
        findFirst: credentialFindFirstMock,
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

describe("workspace executor OAuth bootstrap", () => {
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

  it("leaves OAuth MCP auth out of the package config for native sandbox reconciliation", async () => {
    const source = createSource();
    const packageRow = createPackageRow(source);
    const database = createDatabase({
      source,
      packageRow,
      credentials: [
        {
          id: "cred-1",
          workspaceExecutorSourceId: source.id,
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

    const result = await getWorkspaceExecutorBootstrap({
      database: database as never,
      workspaceId: "ws-1",
      workspaceName: "Workspace",
      userId: "user-1",
    });

    expect(result.sources).toEqual([
      expect.objectContaining({
        id: "src-1",
        connected: true,
      }),
    ]);
    const config = JSON.parse(result.configJson) as {
      sources: Record<string, { config: { headers: Record<string, string> | null } }>;
    };
    expect(config.sources["src-1"]?.config.headers).toBeNull();
  });

  it("marks disconnected OAuth sources as auth_required", async () => {
    const source = createSource();
    const packageRow = createPackageRow(source);
    const database = createDatabase({
      source,
      packageRow,
      credentials: [
        {
          id: "cred-1",
          workspaceExecutorSourceId: source.id,
          userId: "user-1",
          secret: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          oauthMetadata: null,
          enabled: true,
          displayName: null,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
      ],
    });

    const result = await getWorkspaceExecutorBootstrap({
      database: database as never,
      workspaceId: "ws-1",
      workspaceName: "Workspace",
      userId: "user-1",
    });

    expect(result.sources[0]?.connected).toBe(false);
    const workspaceState = JSON.parse(result.workspaceStateJson) as {
      sources: Record<string, { status: string }>;
    };
    expect(workspaceState.sources["src-1"]?.status).toBe("auth_required");
  });

  it("refreshes expired OAuth credentials before native sandbox reconciliation", async () => {
    const source = createSource();
    const packageRow = createPackageRow(source);
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
      packageRow,
      credentials: [
        {
          id: "cred-1",
          workspaceExecutorSourceId: source.id,
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

    const result = await getWorkspaceExecutorNativeMcpOAuthBootstrapSources({
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
    expect(result).toEqual([
      expect.objectContaining({
        namespace: "linear-mcp",
        credential: expect.objectContaining({
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
          expiresAt: refreshedAt,
        }),
      }),
    ]);
    expect(database.insert).toHaveBeenCalled();
  });
});

describe("workspace executor source listing", () => {
  it("treats connected managed Galien sources as credential-enabled", async () => {
    const updatedAt = new Date("2025-01-01T00:00:00.000Z");
    const source = {
      ...createSource(),
      id: "galien-source",
      internalKey: "galien",
      name: "Galien MCP",
      namespace: "galien",
      endpoint: "https://cmdclaw-mcp-prod.onrender.com/galien",
      authType: "none" as const,
      createdAt: updatedAt,
      updatedAt,
    };
    const database = {
      query: {
        workspaceExecutorSource: {
          findMany: vi.fn(async () => [source]),
        },
        workspaceExecutorSourceCredential: {
          findMany: vi.fn(async () => []),
        },
        workspaceMember: {
          findFirst: vi.fn(async () => ({
            user: {
              email: "galien.user@example.com",
            },
          })),
        },
        galienWorkspaceAccess: {
          findFirst: vi.fn(async () => ({ id: "access-1" })),
        },
        galienCredential: {
          findFirst: vi.fn(async () => ({
            id: "galien-credential-1",
            displayName: "Galien User",
            galienUserId: 123,
            validatedAt: updatedAt,
            updatedAt,
          })),
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

    const sources = await listWorkspaceExecutorSources({
      database: database as never,
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: "galien-source",
        connected: true,
        credentialEnabled: true,
      }),
    ]);
  });
});
