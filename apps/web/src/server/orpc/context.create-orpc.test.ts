import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";
import { signManagedMcpToken } from "@bap/core/server/managed-mcp-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { findFirstMock, getRequestSessionMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn<VitestProcedure>(),
  getRequestSessionMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      user: {
        findFirst: findFirstMock,
      },
    },
  },
}));

vi.mock("@/server/session-auth", () => ({
  getRequestSession: getRequestSessionMock,
}));

import { createORPCContext } from "./context";

const SECRET = "test-secret";
const NOW_SECONDS = 1_900_000_000;

async function buildHostedToken(
  overrides?: Partial<Parameters<typeof signHostedMcpAccessToken>[0]>,
) {
  return signHostedMcpAccessToken({
    userId: "user-1",
    workspaceId: "ws-1",
    allowedWorkspaceIds: ["ws-1", "ws-2"],
    allowAllWorkspaces: false,
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

function buildHeaders(token: string, workspaceId?: string): Headers {
  return new Headers({
    authorization: `Bearer ${token}`,
    "x-bap-public-origin": "https://mcp.heybap.com",
    ...(workspaceId !== undefined ? { "x-bap-workspace-id": workspaceId } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_SERVER_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createORPCContext", () => {
  it("uses the explicit request workspace for hosted MCP tokens", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({
      id: "user-1",
    });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken(), "ws-2"),
    });

    expect(context.authSource).toBe("hosted_mcp");
    expect(context.workspaceId).toBe("ws-2");
    expect(context.hostedMcp).toMatchObject({
      workspaceId: "ws-2",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: false,
    });
  });

  it("rejects an explicit request workspace outside the hosted MCP grant", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({
      id: "user-1",
    });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken(), "ws-3"),
    });

    expect(context.authSource).toBe("anonymous");
    expect(context.workspaceId).toBeNull();
    expect(context.hostedMcp).toBeNull();
  });

  it("rejects a whitespace-only hosted MCP workspace selector", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({ id: "user-1" });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken(), "   "),
    });

    expect(context.authSource).toBe("anonymous");
    expect(context.workspaceId).toBeNull();
    expect(context.hostedMcp).toBeNull();
  });

  it("uses the token workspace when a global hosted MCP tool has no request workspace", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({ id: "user-1" });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken()),
    });

    expect(context.authSource).toBe("hosted_mcp");
    expect(context.workspaceId).toBe("ws-1");
  });

  it("rejects a managed MCP request scoped outside its Generation workspace", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({ id: "user-1" });
    const token = signManagedMcpToken(
      {
        userId: "user-1",
        workspaceId: "ws-1",
        internalKey: "bap",
        spawnDepth: 0,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      SECRET,
    );

    const context = await createORPCContext({
      headers: buildHeaders(token, "ws-2"),
    });

    expect(context.authSource).toBe("anonymous");
    expect(context.workspaceId).toBeNull();
  });

  it("rejects a whitespace-only managed MCP workspace selector", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({ id: "user-1" });
    const token = signManagedMcpToken(
      {
        userId: "user-1",
        workspaceId: "ws-1",
        internalKey: "bap",
        spawnDepth: 0,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      SECRET,
    );

    const context = await createORPCContext({
      headers: buildHeaders(token, "   "),
    });

    expect(context.authSource).toBe("anonymous");
    expect(context.workspaceId).toBeNull();
  });
});
