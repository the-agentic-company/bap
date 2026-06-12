import { describe, expect, it } from "vitest";

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

const { computeWorkspaceMcpServerRevisionHash, normalizeExecutorNamespace } = await import(
  "./workspace-sources"
);

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
});
