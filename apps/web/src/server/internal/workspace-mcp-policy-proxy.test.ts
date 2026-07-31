import { signManagedMcpToken } from "@bap/core/server/managed-mcp-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = (...args: never[]) => unknown;

process.env.APP_SERVER_SECRET ??= "workspace-mcp-proxy-test-secret";

const {
  resolvePolicyMock,
  waitForApprovalMock,
  buildUpstreamMock,
  sourceFindFirstMock,
  credentialFindFirstMock,
  generationFindFirstMock,
  membershipFindFirstMock,
  sourceVisibleMock,
  credentialUnavailableReasonMock,
  fetchMock,
  updateWhereMock,
  insertConflictMock,
  claimInterruptApplicationMock,
} = vi.hoisted(() => ({
  resolvePolicyMock: vi.fn<VitestProcedure>(),
  waitForApprovalMock: vi.fn<VitestProcedure>(),
  buildUpstreamMock: vi.fn<VitestProcedure>(),
  sourceFindFirstMock: vi.fn<VitestProcedure>(),
  credentialFindFirstMock: vi.fn<VitestProcedure>(),
  generationFindFirstMock: vi.fn<VitestProcedure>(),
  membershipFindFirstMock: vi.fn<VitestProcedure>(),
  sourceVisibleMock: vi.fn<VitestProcedure>(),
  credentialUnavailableReasonMock: vi.fn<VitestProcedure>(),
  fetchMock: vi.fn<VitestProcedure>(),
  updateWhereMock: vi.fn<VitestProcedure>(),
  insertConflictMock: vi.fn<VitestProcedure>(),
  claimInterruptApplicationMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/services/workspace-integration-policy", () => ({
  resolveWorkspaceIntegrationOperationPolicy: resolvePolicyMock,
}));

vi.mock("@bap/core/server/services/generation-manager", () => ({
  generationManager: { waitForApproval: waitForApprovalMock },
}));

vi.mock("@bap/core/server/services/generation-interrupt-service", () => ({
  generationInterruptService: {
    claimInterruptApplicationByProviderRequestId: claimInterruptApplicationMock,
  },
}));

vi.mock("@bap/core/server/executor/workspace-sources", () => ({
  buildWorkspaceMcpUpstreamRuntimeServer: buildUpstreamMock,
  isWorkspaceMcpServerVisibleForUser: sourceVisibleMock,
  getWorkspaceMcpAuthorizationUnavailableReason: credentialUnavailableReasonMock,
}));

vi.mock("@bap/db/client", () => {
  const tx = {
    update: vi.fn<VitestProcedure>(() => ({
      set: vi.fn<VitestProcedure>(() => ({ where: updateWhereMock })),
    })),
    insert: vi.fn<VitestProcedure>(() => ({
      values: vi.fn<VitestProcedure>(() => ({ onConflictDoUpdate: insertConflictMock })),
    })),
  };
  return {
    db: {
      query: {
        workspaceMcpServer: { findFirst: sourceFindFirstMock },
        workspaceMcpAuthorization: { findFirst: credentialFindFirstMock },
        generation: { findFirst: generationFindFirstMock },
        workspaceMember: { findFirst: membershipFindFirstMock },
      },
      transaction: vi.fn<VitestProcedure>((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
});

const { handleWorkspaceMcpPolicyProxy } = await import("./workspace-mcp-policy-proxy");

function proxyToken(): string {
  return signManagedMcpToken(
    {
      userId: "user-1",
      workspaceId: "workspace-1",
      internalKey: "workspace-mcp-policy-proxy",
      workspaceMcpServerId: "server-1",
      generationId: "generation-1",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    process.env.APP_SERVER_SECRET ?? "workspace-mcp-proxy-test-secret",
  );
}

function rpcRequest(method: string, params?: Record<string, unknown>): Request {
  return new Request("http://app.test/api/internal/workspace-mcp-proxy/server-1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${proxyToken()}`,
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });
}

describe("Workspace MCP policy proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    sourceFindFirstMock.mockResolvedValue({
      id: "server-1",
      workspaceId: "workspace-1",
      name: "Sales fixture",
      namespace: "sales-fixture",
      endpoint: "https://fixture.test/mcp",
      transport: "http",
      headers: null,
      queryParams: null,
      authType: "none",
      authHeaderName: null,
      authQueryParam: null,
      authPrefix: null,
      enabled: true,
      internalKey: null,
      sharedWithWorkspace: true,
      createdByUserId: "user-1",
    });
    credentialFindFirstMock.mockResolvedValue(null);
    generationFindFirstMock.mockResolvedValue({
      id: "generation-1",
      status: "running",
      deadlineAt: new Date(Date.now() + 30_000),
      executionPolicy: { autoApprove: false },
      conversation: {
        workspaceId: "workspace-1",
        userId: "user-1",
        autoApprove: false,
      },
    });
    membershipFindFirstMock.mockResolvedValue({ id: "membership-1" });
    sourceVisibleMock.mockResolvedValue(true);
    credentialUnavailableReasonMock.mockReturnValue(null);
    buildUpstreamMock.mockResolvedValue({
      type: "http",
      name: "sales-fixture",
      url: "https://fixture.test/mcp",
      headers: [{ name: "X-API-Key", value: "server-only-secret" }],
    });
    updateWhereMock.mockResolvedValue(undefined);
    insertConflictMock.mockResolvedValue(undefined);
    claimInterruptApplicationMock.mockResolvedValue({ id: "interrupt-1" });
  });

  it("keeps a denied tool visible while preventing its tools/call upstream", async () => {
    resolvePolicyMock.mockResolvedValue({
      decision: "denied",
      source: "parent_policy",
      policyExplicit: true,
    });

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          data: expect.objectContaining({
            code: "WORKSPACE_POLICY_DENIED",
            operation: "create_lead",
          }),
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitForApprovalMock).not.toHaveBeenCalled();
  });

  it("rejects JSON-RPC batches before they can bypass tools/call policy", async () => {
    const request = new Request("http://app.test/api/internal/workspace-mcp-proxy/server-1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${proxyToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "create_lead", arguments: { name: "Ada" } },
        },
      ]),
    });

    const response = await handleWorkspaceMcpPolicyProxy(request, "server-1");

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolvePolicyMock).not.toHaveBeenCalled();
  });

  it("forwards tools/list under Denied and records the visible catalog", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        id: 7,
        result: {
          tools: [
            {
              name: "create_lead",
              title: "Create lead",
              description: "Creates a lead.",
              inputSchema: { type: "object" },
            },
          ],
        },
      }),
    );

    const response = await handleWorkspaceMcpPolicyProxy(rpcRequest("tools/list"), "server-1");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(resolvePolicyMock).not.toHaveBeenCalled();
    expect(insertConflictMock).toHaveBeenCalledOnce();
  });

  it("forwards an approval-required tool exactly once after human approval", async () => {
    resolvePolicyMock
      .mockResolvedValueOnce({
        decision: "requires_approval",
        source: "parent_policy",
        policyExplicit: true,
      })
      .mockResolvedValueOnce({
        decision: "auto_approved",
        source: "generation_consent",
        policyExplicit: true,
      });
    waitForApprovalMock.mockResolvedValue("allow");
    fetchMock.mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 7, result: { content: [] } }));

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(response.status).toBe(200);
    expect(waitForApprovalMock).toHaveBeenCalledOnce();
    expect(waitForApprovalMock).toHaveBeenCalledWith(
      "generation-1",
      expect.objectContaining({
        providerRequestId: expect.stringContaining(
          "workspace-mcp:generation-1:server-1:7:create_lead:",
        ),
        deadlineAt: expect.any(Date),
      }),
    );
    expect(resolvePolicyMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not forward a retried approved MCP invocation twice", async () => {
    resolvePolicyMock.mockResolvedValue({
      decision: "requires_approval",
      source: "parent_policy",
      policyExplicit: true,
    });
    waitForApprovalMock.mockResolvedValue("allow");
    claimInterruptApplicationMock
      .mockResolvedValueOnce({ id: "interrupt-1" })
      .mockResolvedValueOnce(null);
    fetchMock.mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 7, result: { content: [] } }));

    const first = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );
    const retry = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(first.status).toBe(200);
    expect(await retry.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          data: { code: "APPROVAL_ALREADY_APPLIED" },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not forward after Workspace membership is revoked during approval", async () => {
    resolvePolicyMock.mockResolvedValue({
      decision: "requires_approval",
      source: "parent_policy",
      policyExplicit: true,
    });
    waitForApprovalMock.mockResolvedValue("allow");
    membershipFindFirstMock
      .mockResolvedValueOnce({ id: "membership-1" })
      .mockResolvedValueOnce(null);

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(claimInterruptApplicationMock).not.toHaveBeenCalled();
  });

  it("does not forward when Auto-approved changes to Requires approval before execution", async () => {
    resolvePolicyMock
      .mockResolvedValueOnce({
        decision: "auto_approved",
        source: "parent_policy",
        policyExplicit: true,
      })
      .mockResolvedValueOnce({
        decision: "requires_approval",
        source: "parent_policy",
        policyExplicit: true,
      });

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          data: { code: "WORKSPACE_POLICY_APPROVAL_REQUIRED_RETRY" },
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward Auto-approved calls after the Generation is cancelled", async () => {
    resolvePolicyMock.mockResolvedValue({
      decision: "auto_approved",
      source: "parent_policy",
      policyExplicit: true,
    });
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: "generation-1",
        status: "running",
        deadlineAt: new Date(Date.now() + 30_000),
        executionPolicy: { autoApprove: false },
        conversation: {
          workspaceId: "workspace-1",
          userId: "user-1",
          autoApprove: false,
        },
      })
      .mockResolvedValueOnce({
        status: "cancelled",
        deadlineAt: new Date(Date.now() + 30_000),
      });

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes a human rejection from an administrator policy denial", async () => {
    resolvePolicyMock.mockResolvedValue({
      decision: "requires_approval",
      source: "parent_policy",
      policyExplicit: true,
    });
    waitForApprovalMock.mockResolvedValue("deny");

    const response = await handleWorkspaceMcpPolicyProxy(
      rpcRequest("tools/call", { name: "create_lead", arguments: { name: "Ada" } }),
      "server-1",
    );

    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          data: { code: "APPROVAL_REJECTED" },
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
