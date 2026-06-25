import { describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<VitestProcedure>(),
}));

const {
  assertHostedMcpWorkspaceMembershipMock,
  createHostedMcpAuthorizationCodeMock,
  listHostedMcpConsentWorkspacesMock,
  parseHostedMcpAuthorizationRequestMock,
  renderHostedMcpConsentHtmlMock,
} = vi.hoisted(() => ({
  assertHostedMcpWorkspaceMembershipMock: vi.fn<VitestProcedure>(),
  createHostedMcpAuthorizationCodeMock: vi.fn<VitestProcedure>(),
  listHostedMcpConsentWorkspacesMock: vi.fn<VitestProcedure>(),
  parseHostedMcpAuthorizationRequestMock: vi.fn<VitestProcedure>(),
  renderHostedMcpConsentHtmlMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/server/hosted-mcp-oauth", () => ({
  assertHostedMcpWorkspaceMembership: assertHostedMcpWorkspaceMembershipMock,
  createHostedMcpAuthorizationCode: createHostedMcpAuthorizationCodeMock,
  listHostedMcpConsentWorkspaces: listHostedMcpConsentWorkspacesMock,
  normalizeHostedMcpSelectedWorkspaceIds: (
    value: FormDataEntryValue | Array<FormDataEntryValue> | null,
  ) => {
    const rawValues = Array.isArray(value) ? value : value ? [value] : [];
    return Array.from(
      new Set(
        rawValues
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((workspaceId) => workspaceId.length > 0),
      ),
    );
  },
  parseHostedMcpAuthorizationRequest: parseHostedMcpAuthorizationRequestMock,
  renderHostedMcpConsentHtml: renderHostedMcpConsentHtmlMock,
  resolveHostedMcpConsentWorkspaceId: (workspaces: Array<{ id: string; active: boolean }>) =>
    workspaces.find((workspace) => workspace.active)?.id ?? workspaces[0]?.id ?? null,
  resolveHostedMcpWorkspaceConsent: async (params: {
    audience: string;
    userId: string;
    workspaces: Array<{ id: string; active: boolean }>;
    workspaceAccessMode: string | null;
    selectedWorkspaceIds: string[];
    workspaceId: string | null;
  }) => {
    if (params.audience !== "bap") {
      const workspaceId = params.workspaceId?.trim() ?? "";
      if (!workspaceId) {
        throw new Error("workspace_id is required.");
      }
      await assertHostedMcpWorkspaceMembershipMock(params.userId, workspaceId);
      return {
        workspaceId,
        allowedWorkspaceIds: [workspaceId],
        allowAllWorkspaces: false,
        selectedWorkspaceIds: [workspaceId],
      };
    }

    if (params.workspaceAccessMode === "all") {
      const workspaceId =
        params.workspaces.find((workspace) => workspace.active)?.id ?? params.workspaces[0]?.id;
      if (!workspaceId) {
        throw new Error("At least one workspace membership is required.");
      }
      return {
        workspaceId,
        allowedWorkspaceIds: params.workspaces.map((workspace) => workspace.id),
        allowAllWorkspaces: true,
        selectedWorkspaceIds: params.workspaces.map((workspace) => workspace.id),
      };
    }

    if (params.selectedWorkspaceIds.length === 0) {
      throw new Error("Select at least one workspace or authorize all workspaces.");
    }

    await Promise.all(
      params.selectedWorkspaceIds.map((workspaceId) =>
        assertHostedMcpWorkspaceMembershipMock(params.userId, workspaceId),
      ),
    );

    return {
      workspaceId: params.selectedWorkspaceIds[0] ?? null,
      allowedWorkspaceIds: params.selectedWorkspaceIds,
      allowAllWorkspaces: false,
      selectedWorkspaceIds: params.selectedWorkspaceIds,
    };
  },
}));

import { handleHostedMcpAuthorizeGet, handleHostedMcpAuthorizePost } from "./authorize";

describe("handleHostedMcpAuthorizeGet", () => {
  it("renders Bap consent without forcing a single selected workspace", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    parseHostedMcpAuthorizationRequestMock.mockResolvedValueOnce({
      audience: "bap",
      clientId: "client-1",
      clientName: "Codex",
      redirectUri: "http://localhost:34567/callback",
      resource: "http://127.0.0.1:3010/bap",
      resourceName: "Bap MCP",
      scopes: ["bap"],
      state: "state-1",
      codeChallenge: "challenge-1",
    });
    listHostedMcpConsentWorkspacesMock.mockResolvedValueOnce([
      { id: "ws-1", name: "Workspace One", active: false },
      { id: "ws-2", name: "Workspace Two", active: true },
    ]);
    renderHostedMcpConsentHtmlMock.mockReturnValueOnce("<html>ok</html>");

    const response = await handleHostedMcpAuthorizeGet(
      new Request("http://localhost:3000/api/mcp/oauth/authorize"),
    );

    expect(response.status).toBe(200);
    expect(renderHostedMcpConsentHtmlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "bap",
        currentWorkspaceId: "ws-2",
        allowAllWorkspaces: true,
        workspaces: [
          { id: "ws-1", name: "Workspace One", active: false },
          { id: "ws-2", name: "Workspace Two", active: true },
        ],
      }),
    );
  });

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

describe("handleHostedMcpAuthorizePost", () => {
  it("approves Bap OAuth without requiring workspace_id in the form", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    parseHostedMcpAuthorizationRequestMock.mockResolvedValueOnce({
      audience: "bap",
      clientId: "client-1",
      redirectUri: "http://localhost:34567/callback",
      resource: "http://127.0.0.1:3010/bap",
      scopes: ["bap"],
      state: "state-1",
      codeChallenge: "challenge-1",
    });
    listHostedMcpConsentWorkspacesMock.mockResolvedValueOnce([
      { id: "ws-1", name: "Workspace One", active: false },
      { id: "ws-2", name: "Workspace Two", active: true },
    ]);
    createHostedMcpAuthorizationCodeMock.mockResolvedValueOnce("code-1");

    const formData = new FormData();
    formData.set("decision", "approve");
    formData.set("workspace_access_mode", "all");
    formData.set("response_type", "code");
    formData.set("client_id", "client-1");
    formData.set("redirect_uri", "http://localhost:34567/callback");
    formData.set("resource", "http://127.0.0.1:3010/bap");
    formData.set("code_challenge", "challenge-1");
    formData.set("code_challenge_method", "S256");
    formData.set("scope", "bap");
    formData.set("state", "state-1");

    const response = await handleHostedMcpAuthorizePost(
      new Request("http://localhost:3000/api/mcp/oauth/authorize", {
        method: "POST",
        body: formData,
      }),
    );

    expect(assertHostedMcpWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(createHostedMcpAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-2",
        allowAllWorkspaces: true,
        allowedWorkspaceIds: ["ws-1", "ws-2"],
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:34567/callback?code=code-1&state=state-1",
    );
  });

  it("approves Bap OAuth with only selected workspaces", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    parseHostedMcpAuthorizationRequestMock.mockResolvedValueOnce({
      audience: "bap",
      clientId: "client-1",
      redirectUri: "http://localhost:34567/callback",
      resource: "http://127.0.0.1:3010/bap",
      scopes: ["bap"],
      state: "state-1",
      codeChallenge: "challenge-1",
    });
    listHostedMcpConsentWorkspacesMock.mockResolvedValueOnce([
      { id: "ws-1", name: "Workspace One", active: false },
      { id: "ws-2", name: "Workspace Two", active: true },
      { id: "ws-3", name: "Workspace Three", active: false },
    ]);
    assertHostedMcpWorkspaceMembershipMock
      .mockResolvedValueOnce({ workspace: { id: "ws-1" } })
      .mockResolvedValueOnce({ workspace: { id: "ws-3" } });
    createHostedMcpAuthorizationCodeMock.mockResolvedValueOnce("code-2");

    const formData = new FormData();
    formData.set("decision", "approve");
    formData.set("workspace_access_mode", "selected");
    formData.append("workspace_ids", "ws-1");
    formData.append("workspace_ids", "ws-3");
    formData.set("response_type", "code");
    formData.set("client_id", "client-1");
    formData.set("redirect_uri", "http://localhost:34567/callback");
    formData.set("resource", "http://127.0.0.1:3010/bap");
    formData.set("code_challenge", "challenge-1");
    formData.set("code_challenge_method", "S256");
    formData.set("scope", "bap");
    formData.set("state", "state-1");

    const response = await handleHostedMcpAuthorizePost(
      new Request("http://localhost:3000/api/mcp/oauth/authorize", {
        method: "POST",
        body: formData,
      }),
    );

    expect(createHostedMcpAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        allowAllWorkspaces: false,
        allowedWorkspaceIds: ["ws-1", "ws-3"],
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:34567/callback?code=code-2&state=state-1",
    );
  });
});
