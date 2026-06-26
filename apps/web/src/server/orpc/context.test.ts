import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";
import { signManagedMcpToken } from "@bap/core/server/managed-mcp-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHostedMcpClaims, resolveManagedMcpClaims } from "./context";

const SECRET = "test-secret";
const NOW_SECONDS = 1_900_000_000;

function headersWithToken(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

function buildToken(overrides?: Partial<Parameters<typeof signManagedMcpToken>[0]>): string {
  return signManagedMcpToken(
    {
      userId: "user-1",
      workspaceId: "ws-1",
      internalKey: "bap",
      exp: NOW_SECONDS + 600,
      spawnDepth: 1,
      ...overrides,
    },
    SECRET,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveHostedMcpClaims", () => {
  async function buildHostedToken(
    overrides?: Partial<Parameters<typeof signHostedMcpAccessToken>[0]>,
  ): Promise<string> {
    return signHostedMcpAccessToken({
      userId: "user-1",
      workspaceId: "ws-1",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      audience: "bap",
      scope: ["bap"],
      clientId: "client-1",
      grantId: "grant-1",
      secret: SECRET,
      issuer: "https://mcp.heybap.com",
      expiresInSeconds: 600,
      nowSeconds: NOW_SECONDS,
      ...overrides,
    });
  }

  it("resolves hosted MCP tokens against the forwarded public MCP origin", async () => {
    vi.stubEnv("APP_URL", "https://heybap.com");
    const token = await buildHostedToken();
    const claims = await resolveHostedMcpClaims(
      new Headers({
        authorization: `Bearer ${token}`,
        "x-bap-public-origin": "https://mcp.heybap.com",
      }),
      SECRET,
      NOW_SECONDS,
    );

    expect(claims).toMatchObject({
      token,
      userId: "user-1",
      workspaceId: "ws-1",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: false,
      audience: "bap",
      scopes: ["bap"],
      clientId: "client-1",
      grantId: "grant-1",
    });
  });

  it("rejects prod hosted MCP tokens when the public MCP origin is not forwarded", async () => {
    vi.stubEnv("APP_URL", "https://heybap.com");
    const token = await buildHostedToken();

    await expect(
      resolveHostedMcpClaims(headersWithToken(token), SECRET, NOW_SECONDS),
    ).rejects.toThrow(/iss/i);
  });

  it("rejects hosted MCP tokens for other audiences", async () => {
    const token = await buildHostedToken({ audience: "gmail", scope: ["gmail"] });

    await expect(
      resolveHostedMcpClaims(
        new Headers({
          authorization: `Bearer ${token}`,
          "x-bap-public-origin": "https://mcp.heybap.com",
        }),
        SECRET,
        NOW_SECONDS,
      ),
    ).rejects.toThrow(/aud/i);
  });
});

describe("resolveManagedMcpClaims", () => {
  it("resolves a valid bap managed token to acting-user claims", () => {
    const claims = resolveManagedMcpClaims(headersWithToken(buildToken()), SECRET, NOW_SECONDS);
    expect(claims).toMatchObject({
      userId: "user-1",
      workspaceId: "ws-1",
      internalKey: "bap",
      spawnDepth: 1,
    });
  });

  it("rejects a Bap token missing its spawn depth", () => {
    const token = signManagedMcpToken(
      {
        userId: "user-1",
        workspaceId: "ws-1",
        internalKey: "bap",
        exp: NOW_SECONDS + 600,
      },
      SECRET,
    );
    expect(() => resolveManagedMcpClaims(headersWithToken(token), SECRET, NOW_SECONDS)).toThrow(
      /missing its spawn depth/i,
    );
  });

  it("rejects tokens for other managed internal keys", () => {
    const token = buildToken({ internalKey: "galien" });
    expect(() => resolveManagedMcpClaims(headersWithToken(token), SECRET, NOW_SECONDS)).toThrow(
      /not valid for the Bap API/i,
    );
  });

  it("rejects expired tokens", () => {
    const token = buildToken({ exp: NOW_SECONDS - 1 });
    expect(() => resolveManagedMcpClaims(headersWithToken(token), SECRET, NOW_SECONDS)).toThrow(
      /expired/i,
    );
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signManagedMcpToken(
      {
        userId: "user-1",
        workspaceId: "ws-1",
        internalKey: "bap",
        exp: NOW_SECONDS + 600,
      },
      "other-secret",
    );
    expect(() => resolveManagedMcpClaims(headersWithToken(token), SECRET, NOW_SECONDS)).toThrow(
      /signature/i,
    );
  });

  it("rejects requests without a bearer token", () => {
    expect(() => resolveManagedMcpClaims(new Headers(), SECRET, NOW_SECONDS)).toThrow(
      /missing bearer/i,
    );
  });
});
