import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";
import { describe, expect, it } from "vitest";
import { authenticateHostedMcpRequest } from "./auth";

describe("MCP auth", () => {
  it("accepts hosted OAuth tokens issued for the public MCP origin", async () => {
    const secret = "test-server-secret";
    process.env.APP_SERVER_SECRET = secret;
    process.env.APP_URL = "https://heybap.com";

    const token = await signHostedMcpAccessToken({
      userId: "user-1",
      workspaceId: "workspace-1",
      allowedWorkspaceIds: ["workspace-1", "workspace-2"],
      audience: "bap",
      scope: ["bap"],
      clientId: "bap-mcp-client",
      grantId: "grant-1",
      secret,
      issuer: "https://mcp.heybap.com",
      nowSeconds: 1_900_000_000,
    });

    const auth = await authenticateHostedMcpRequest({
      req: {
        headers: {
          authorization: `Bearer ${token}`,
          "x-bap-public-origin": "https://mcp.heybap.com",
        },
      },
      requiredAudience: "bap",
      allowManagedToken: true,
    });

    expect(auth.clientId).toBe("bap-mcp-client");
    expect(auth.extra.authType).toBe("hosted_oauth");
    expect(auth.extra.workspaceId).toBe("workspace-1");
    expect(auth.extra.allowedWorkspaceIds).toEqual(["workspace-1", "workspace-2"]);
    expect(auth.extra.allowAllWorkspaces).toBe(false);
  });
});
