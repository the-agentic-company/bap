import { describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<VitestProcedure>(),
}));

const {
  createHostedMcpAuthorizationCodeMock,
  listHostedMcpConsentWorkspacesMock,
  parseHostedMcpAuthorizationRequestMock,
  resolveHostedMcpWorkspaceConsentMock,
  renderHostedMcpConsentHtmlMock,
} = vi.hoisted(() => ({
  createHostedMcpAuthorizationCodeMock: vi.fn<VitestProcedure>(),
  listHostedMcpConsentWorkspacesMock: vi.fn<VitestProcedure>(),
  parseHostedMcpAuthorizationRequestMock: vi.fn<VitestProcedure>(),
  resolveHostedMcpWorkspaceConsentMock: vi.fn<VitestProcedure>(),
  renderHostedMcpConsentHtmlMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/server/hosted-mcp-oauth", async () => {
  const actual = await vi.importActual<typeof import("@/server/hosted-mcp-oauth")>(
    "@/server/hosted-mcp-oauth",
  );

  return {
    ...actual,
    createHostedMcpAuthorizationCode: createHostedMcpAuthorizationCodeMock,
    listHostedMcpConsentWorkspaces: listHostedMcpConsentWorkspacesMock,
    parseHostedMcpAuthorizationRequest: parseHostedMcpAuthorizationRequestMock,
    resolveHostedMcpWorkspaceConsent: resolveHostedMcpWorkspaceConsentMock,
    renderHostedMcpConsentHtml: renderHostedMcpConsentHtmlMock,
  };
});

function mockBapAuthorizationRequest() {
  parseHostedMcpAuthorizationRequestMock.mockResolvedValueOnce({
    audience: "bap",
    clientId: "client-1",
    redirectUri: "http://localhost:34567/callback",
    resource: "http://127.0.0.1:3010/bap",
    scopes: ["bap"],
    state: "state-1",
    codeChallenge: "challenge-1",
  });
}

function mockBapAuthorizationConsentRequest() {
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
}

function createBapAuthorizationFormData(params?: {
  decision?: "approve" | "deny";
  workspaceAccessMode?: "all" | "selected";
  workspaceIds?: string[];
}) {
  const formData = new FormData();
  formData.set("decision", params?.decision ?? "approve");
  if (params?.workspaceAccessMode) {
    formData.set("workspace_access_mode", params.workspaceAccessMode);
  }
  for (const workspaceId of params?.workspaceIds ?? []) {
    formData.append("workspace_ids", workspaceId);
  }
  formData.set("response_type", "code");
  formData.set("client_id", "client-1");
  formData.set("redirect_uri", "http://localhost:34567/callback");
  formData.set("resource", "http://127.0.0.1:3010/bap");
  formData.set("code_challenge", "challenge-1");
  formData.set("code_challenge_method", "S256");
  formData.set("scope", "bap");
  formData.set("state", "state-1");
  return formData;
}

import { handleHostedMcpAuthorizeGet, handleHostedMcpAuthorizePost } from "./authorize";

describe("handleHostedMcpAuthorizeGet", () => {
  it("renders Bap consent without forcing a single selected workspace", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockBapAuthorizationConsentRequest();
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
    mockBapAuthorizationRequest();
    listHostedMcpConsentWorkspacesMock.mockResolvedValueOnce([
      { id: "ws-1", name: "Workspace One", active: false },
      { id: "ws-2", name: "Workspace Two", active: true },
    ]);
    resolveHostedMcpWorkspaceConsentMock.mockResolvedValueOnce({
      workspaceId: "ws-2",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: true,
      selectedWorkspaceIds: ["ws-1", "ws-2"],
    });
    createHostedMcpAuthorizationCodeMock.mockResolvedValueOnce("code-1");

    const formData = createBapAuthorizationFormData({
      workspaceAccessMode: "all",
    });

    const response = await handleHostedMcpAuthorizePost(
      new Request("http://localhost:3000/api/mcp/oauth/authorize", {
        method: "POST",
        body: formData,
      }),
    );

    expect(resolveHostedMcpWorkspaceConsentMock).toHaveBeenCalledWith({
      audience: "bap",
      userId: "user-1",
      workspaces: [
        { id: "ws-1", name: "Workspace One", active: false },
        { id: "ws-2", name: "Workspace Two", active: true },
      ],
      workspaceAccessMode: "all",
      selectedWorkspaceIds: [],
      workspaceId: null,
    });
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
    mockBapAuthorizationRequest();
    listHostedMcpConsentWorkspacesMock.mockResolvedValueOnce([
      { id: "ws-1", name: "Workspace One", active: false },
      { id: "ws-2", name: "Workspace Two", active: true },
      { id: "ws-3", name: "Workspace Three", active: false },
    ]);
    resolveHostedMcpWorkspaceConsentMock.mockResolvedValueOnce({
      workspaceId: "ws-1",
      allowedWorkspaceIds: ["ws-1", "ws-3"],
      allowAllWorkspaces: false,
      selectedWorkspaceIds: ["ws-1", "ws-3"],
    });
    createHostedMcpAuthorizationCodeMock.mockResolvedValueOnce("code-2");

    const formData = createBapAuthorizationFormData({
      workspaceAccessMode: "selected",
      workspaceIds: ["ws-1", "ws-3"],
    });

    const response = await handleHostedMcpAuthorizePost(
      new Request("http://localhost:3000/api/mcp/oauth/authorize", {
        method: "POST",
        body: formData,
      }),
    );

    expect(resolveHostedMcpWorkspaceConsentMock).toHaveBeenCalledWith({
      audience: "bap",
      userId: "user-1",
      workspaces: [
        { id: "ws-1", name: "Workspace One", active: false },
        { id: "ws-2", name: "Workspace Two", active: true },
        { id: "ws-3", name: "Workspace Three", active: false },
      ],
      workspaceAccessMode: "selected",
      selectedWorkspaceIds: ["ws-1", "ws-3"],
      workspaceId: null,
    });
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
