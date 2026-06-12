import { signManagedMcpToken } from "@cmdclaw/core/server/managed-mcp-auth";
import { describe, expect, it } from "vitest";
import { resolveManagedMcpClaims } from "./context";

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
