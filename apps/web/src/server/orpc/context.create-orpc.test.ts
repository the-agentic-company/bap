import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { findFirstMock, getRequestSessionMock, resolveSessionPrincipalWorkspaceIdMock } = vi.hoisted(
  () => ({
    findFirstMock: vi.fn<VitestProcedure>(),
    getRequestSessionMock: vi.fn<VitestProcedure>(),
    resolveSessionPrincipalWorkspaceIdMock: vi.fn<VitestProcedure>(),
  }),
);

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

vi.mock("@/server/session-principal-workspace", () => ({
  resolveSessionPrincipalWorkspaceId: resolveSessionPrincipalWorkspaceIdMock,
}));

import { createORPCContext } from "./context";

const SECRET = "test-secret";
const NOW_SECONDS = 1_900_000_000;

async function buildHostedToken(overrides?: Partial<Parameters<typeof signHostedMcpAccessToken>[0]>) {
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

function buildHeaders(token: string): Headers {
  return new Headers({
    authorization: `Bearer ${token}`,
    "x-bap-public-origin": "https://mcp.heybap.com",
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
  it("keeps hosted MCP tokens scoped to the active allowed workspace", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    resolveSessionPrincipalWorkspaceIdMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({
      id: "user-1",
      activeWorkspaceId: "ws-2",
    });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken()),
    });

    expect(context.authSource).toBe("hosted_mcp");
    expect(context.workspaceId).toBe("ws-2");
    expect(context.hostedMcp).toMatchObject({
      workspaceId: "ws-2",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: false,
    });
  });

  it("rejects hosted MCP tokens when the active workspace is outside the allowed set", async () => {
    getRequestSessionMock.mockResolvedValueOnce(null);
    findFirstMock.mockResolvedValueOnce({
      id: "user-1",
      activeWorkspaceId: "ws-3",
    });

    const context = await createORPCContext({
      headers: buildHeaders(await buildHostedToken()),
    });

    expect(context.authSource).toBe("anonymous");
    expect(context.workspaceId).toBeNull();
    expect(context.hostedMcp).toBeNull();
  });
});
