import { describe, expect, it } from "vitest";
import { signHostedMcpAccessToken, verifyHostedMcpAccessToken } from "./hosted-mcp-oauth";

describe("hosted MCP OAuth", () => {
  it("signs and verifies a hosted MCP access token", async () => {
    const token = await signHostedMcpAccessToken({
      userId: "user-1",
      workspaceId: "ws-1",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      audience: "gmail",
      scope: ["gmail"],
      clientId: "client-1",
      grantId: "grant-1",
      secret: "test-secret",
      issuer: "https://heybap.com",
      nowSeconds: 1_900_000_000,
      expiresInSeconds: 3600,
    });

    await expect(
      verifyHostedMcpAccessToken(token, {
        secret: "test-secret",
        expectedAudience: "gmail",
        issuer: "https://heybap.com",
        nowSeconds: 1_900_000_100,
      }),
    ).resolves.toMatchObject({
      userId: "user-1",
      workspaceId: "ws-1",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: false,
      audience: "gmail",
      scope: ["gmail"],
      clientId: "client-1",
      grantId: "grant-1",
    });
  });

  it("rejects tokens for the wrong audience", async () => {
    const token = await signHostedMcpAccessToken({
      userId: "user-1",
      workspaceId: "ws-1",
      allowAllWorkspaces: true,
      audience: "gmail",
      scope: ["gmail"],
      clientId: "client-1",
      grantId: "grant-1",
      secret: "test-secret",
      issuer: "https://heybap.com",
      nowSeconds: 1_900_000_000,
      expiresInSeconds: 3600,
    });

    await expect(
      verifyHostedMcpAccessToken(token, {
        secret: "test-secret",
        expectedAudience: "internal",
        issuer: "https://heybap.com",
        nowSeconds: 1_900_000_100,
      }),
    ).rejects.toThrow();
  });
});
