import { describe, expect, it, vi } from "vitest";
import "../test-env";

const {
  computeWorkspaceMcpServerRevisionHash,
  listWorkspaceMcpServers,
  normalizeExecutorNamespace,
  setWorkspaceMcpServerCredential,
} = await import("./workspace-sources");

describe("Workspace MCP Servers", () => {
  it("normalizes namespaces into stable slugs", () => {
    expect(normalizeExecutorNamespace("  SalesForce Prod  ")).toBe("salesforce-prod");
    expect(normalizeExecutorNamespace("mcp/internal.crm")).toBe("mcp-internal-crm");
  });

  it("changes the revision hash when source auth or endpoint changes", () => {
    const base = {
      kind: "mcp" as const,
      name: "HubSpot",
      namespace: "hubspot-prod",
      endpoint: "https://mcp.hubspot.com/mcp",
      specUrl: null,
      transport: null,
      headers: null,
      queryParams: null,
      defaultHeaders: null,
      authType: "bearer" as const,
      authHeaderName: "Authorization",
      authQueryParam: null,
      authPrefix: "Bearer ",
      enabled: true,
    };

    const initial = computeWorkspaceMcpServerRevisionHash(base);
    const changedEndpoint = computeWorkspaceMcpServerRevisionHash({
      ...base,
      endpoint: "https://api2.hubspot.com",
    });
    const changedAuth = computeWorkspaceMcpServerRevisionHash({
      ...base,
      authType: "api_key",
      authPrefix: null,
      authHeaderName: "X-API-Key",
    });

    expect(changedEndpoint).not.toBe(initial);
    expect(changedAuth).not.toBe(initial);
  });

  it("surfaces and stores credential expiration dates", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-06-01T23:59:59.999Z");
    const source = {
      id: "src-1",
      workspaceId: "ws-1",
      kind: "mcp" as const,
      name: "Deepgram MCP",
      namespace: "deepgram",
      endpoint: "https://mcp.example.com/deepgram",
      specUrl: null,
      transport: "http",
      headers: null,
      queryParams: null,
      defaultHeaders: null,
      authType: "api_key" as const,
      authHeaderName: "X-API-Key",
      authQueryParam: null,
      authPrefix: null,
      enabled: true,
      revisionHash: "hash",
      internalKey: null,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: now,
      updatedAt: now,
    };
    const credential = {
      id: "cred-1",
      workspaceMcpServerId: "src-1",
      userId: "user-1",
      secret: "encrypted-secret",
      accessToken: null,
      refreshToken: null,
      expiresAt,
      oauthMetadata: null,
      enabled: true,
      displayName: "Personal key",
      createdAt: now,
      updatedAt: now,
    };
    const setMock = vi.fn(() => undefined);
    const onConflictDoUpdateMock = vi.fn();
    const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
    const database = {
      query: {
        workspaceMcpServer: {
          findMany: vi.fn(async () => [source]),
        },
        workspaceMcpAuthorization: {
          findMany: vi.fn(async () => [credential]),
        },
      },
      insert: vi.fn(() => ({
        values: valuesMock,
      })),
      update: vi.fn(() => ({ set: setMock })),
    };

    const sources = await listWorkspaceMcpServers({
      database: database as never,
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(sources[0]).toMatchObject({
      id: "src-1",
      connected: true,
      credentialExpiresAt: expiresAt,
    });

    await setWorkspaceMcpServerCredential({
      database: database as never,
      workspaceMcpServerId: "src-1",
      userId: "user-1",
      secret: "new-secret",
      expiresAt,
    });

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ expiresAt }));
    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ expiresAt }),
      }),
    );
  });
});
