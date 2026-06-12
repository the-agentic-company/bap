import { describe, expect, it } from "vitest";
import { verifyManagedMcpToken } from "../managed-mcp-auth";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";
import {
  buildCmdclawPlatformMcpServer,
  PLATFORM_MCP_TOKEN_TTL_SECONDS,
} from "./platform-mcp-server";

describe("bap platform MCP server", () => {
  it("builds an http server entry pointing at the gateway /bap path", () => {
    const server = buildCmdclawPlatformMcpServer({
      userId: "user-1",
      workspaceId: "ws-1",
      spawnDepth: 0,
      baseUrl: "https://mcp.example.com",
      secret: "test-secret",
      nowSeconds: 1_900_000_000,
    });

    expect(server).toMatchObject({
      type: "http",
      name: "bap",
      url: "https://mcp.example.com/bap",
    });
  });

  it("signs a managed token carrying the acting user, workspace, and spawn depth", () => {
    const server = buildCmdclawPlatformMcpServer({
      userId: "user-1",
      workspaceId: "ws-1",
      spawnDepth: 2,
      baseUrl: "https://mcp.example.com",
      secret: "test-secret",
      nowSeconds: 1_900_000_000,
    });

    if (server.type === "stdio") {
      throw new Error("expected http server");
    }
    const authorization = server.headers.find((header) => header.name === "Authorization");
    expect(authorization?.value).toMatch(/^Bearer /);
    const token = authorization?.value.slice("Bearer ".length) ?? "";

    const claims = verifyManagedMcpToken(token, "test-secret", 1_900_000_000);
    expect(claims).toMatchObject({
      userId: "user-1",
      workspaceId: "ws-1",
      internalKey: "bap",
      spawnDepth: 2,
    });
    expect(claims.exp).toBe(1_900_000_000 + PLATFORM_MCP_TOKEN_TTL_SECONDS);
  });

  it("mints a token that outlives a single generation's run deadline", () => {
    expect(PLATFORM_MCP_TOKEN_TTL_SECONDS * 1000).toBeGreaterThan(
      generationLifecyclePolicy.runDeadlineMs,
    );
  });

  it("rejects verification with the wrong secret", () => {
    const server = buildCmdclawPlatformMcpServer({
      userId: "user-1",
      workspaceId: "ws-1",
      spawnDepth: 0,
      baseUrl: "https://mcp.example.com",
      secret: "test-secret",
      nowSeconds: 1_900_000_000,
    });
    if (server.type === "stdio") {
      throw new Error("expected http server");
    }
    const token =
      server.headers.find((header) => header.name === "Authorization")?.value.slice(7) ?? "";
    expect(() => verifyManagedMcpToken(token, "other-secret", 1_900_000_000)).toThrow(/signature/i);
  });
});
