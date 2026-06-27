import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn<() => Promise<unknown>>();
const handleQueryRequestMock = vi.fn<() => Promise<unknown>>();
const mustGetQueryMock = vi.fn<() => { fn: (input: unknown) => unknown }>();
const resolveSessionPrincipalWorkspaceIdMock =
  vi.fn<(userId: string, activeOrganizationId?: string | null) => Promise<string>>();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/zero/queries", () => ({
  zeroQueries: {
    conversations: {},
  },
}));

vi.mock("@/server/session-principal-workspace", () => ({
  resolveSessionPrincipalWorkspaceId: resolveSessionPrincipalWorkspaceIdMock,
}));

vi.mock("@/zero/schema", () => ({
  schema: {
    tables: {},
    relationships: [],
  },
}));

vi.mock("@rocicorp/zero", () => ({
  mustGetQuery: mustGetQueryMock,
}));

vi.mock("@rocicorp/zero/server", () => ({
  handleQueryRequest: handleQueryRequestMock,
}));

describe("handleZeroQueryRequest", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    handleQueryRequestMock.mockReset();
    mustGetQueryMock.mockReset();
    resolveSessionPrincipalWorkspaceIdMock.mockReset();
  });

  it("rejects unauthenticated query hydration", async () => {
    const { handleZeroQueryRequest } = await import("./query");
    getSessionMock.mockResolvedValue(null);

    const response = await handleZeroQueryRequest(new Request("http://localhost/api/zero/query"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(handleQueryRequestMock).not.toHaveBeenCalled();
  });

  it("hydrates authenticated query requests with user and active workspace context", async () => {
    const { handleZeroQueryRequest } = await import("./query");
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveSessionPrincipalWorkspaceIdMock.mockResolvedValue("workspace-1");
    handleQueryRequestMock.mockResolvedValue({ ok: true });

    const response = await handleZeroQueryRequest(
      new Request("http://localhost/api/zero/query", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resolveSessionPrincipalWorkspaceIdMock).toHaveBeenCalledWith("user-1", null);
    expect(handleQueryRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: expect.any(Function),
        request: expect.any(Request),
        userID: "user-1",
      }),
    );

    const [{ handler }] = handleQueryRequestMock.mock.calls[0] as unknown as [
      { handler: (name: string, args: unknown) => unknown },
    ];
    const queryFn = vi.fn<(input: unknown) => unknown>();
    mustGetQueryMock.mockReturnValue({ fn: queryFn });
    handler("conversations.recent", { limit: 50 });
    expect(queryFn).toHaveBeenCalledWith({
      args: { limit: 50 },
      ctx: { userId: "user-1", workspaceId: "workspace-1" },
    });
  });

  it("passes Better Auth active organization into Zero workspace context", async () => {
    const { handleZeroQueryRequest } = await import("./query");
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "workspace-2" },
    });
    resolveSessionPrincipalWorkspaceIdMock.mockResolvedValue("workspace-2");
    handleQueryRequestMock.mockResolvedValue({ ok: true });

    await handleZeroQueryRequest(
      new Request("http://localhost/api/zero/query", { method: "POST" }),
    );

    expect(resolveSessionPrincipalWorkspaceIdMock).toHaveBeenCalledWith("user-1", "workspace-2");
  });
});
