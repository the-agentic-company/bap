import { describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/server/hosted-mcp-oauth", () => ({
  assertHostedMcpWorkspaceMembership: vi.fn<VitestProcedure>(),
  createHostedMcpAuthorizationCode: vi.fn<VitestProcedure>(),
  listHostedMcpConsentWorkspaces: vi.fn<VitestProcedure>(),
  parseHostedMcpAuthorizationRequest: vi.fn<VitestProcedure>(),
  renderHostedMcpConsentHtml: vi.fn<VitestProcedure>(),
}));

import { handleHostedMcpAuthorizeGet } from "./authorize";

describe("handleHostedMcpAuthorizeGet", () => {
  it("redirects unauthenticated Bap MCP authorization requests to heybap.com login", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const response = await handleHostedMcpAuthorizeGet(
      new Request(
        "https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize?response_type=code&client_id=bap-mcp-client&scope=bap&resource=https%3A%2F%2Fmcp.heybap.com%2Fbap",
        {
          headers: {
            "x-bap-public-origin": "https://mcp.heybap.com",
            "x-forwarded-host": "mcp.heybap.com",
            "x-forwarded-proto": "https",
          },
        },
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://heybap.com/login?callbackUrl=%2Fapi%2Fmcp%2Foauth%2Fauthorize%3Fresponse_type%3Dcode%26client_id%3Dbap-mcp-client%26scope%3Dbap%26resource%3Dhttps%253A%252F%252Fmcp.heybap.com%252Fbap",
    );
  });

  it("canonicalizes production MCP login redirects to heybap.com", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const response = await handleHostedMcpAuthorizeGet(
      new Request(
        "https://cmdclaw-web-prod.onrender.com/api/mcp/oauth/authorize?response_type=code&client_id=bap-mcp-client&scope=bap&resource=https%3A%2F%2Fmcp.heybap.com%2Fbap",
        {
          headers: {
            "x-bap-public-origin": "https://www.heybap.com",
          },
        },
      ),
    );

    expect(response.headers.get("location")?.startsWith("https://heybap.com/login?")).toBe(true);
  });

  it("preserves staging for staging MCP login redirects", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const response = await handleHostedMcpAuthorizeGet(
      new Request(
        "https://cmdclaw-web-staging.onrender.com/api/mcp/oauth/authorize?response_type=code&client_id=bap-mcp-client&scope=bap&resource=https%3A%2F%2Fmcp.staging.heybap.com%2Fbap",
        {
          headers: {
            "x-bap-public-origin": "https://mcp.staging.heybap.com",
            "x-forwarded-host": "mcp.staging.heybap.com",
            "x-forwarded-proto": "https",
          },
        },
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://staging.heybap.com/login?callbackUrl=%2Fapi%2Fmcp%2Foauth%2Fauthorize%3Fresponse_type%3Dcode%26client_id%3Dbap-mcp-client%26scope%3Dbap%26resource%3Dhttps%253A%252F%252Fmcp.staging.heybap.com%252Fbap",
    );
  });
});
