import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  authorizeRuntimeTurnMock,
  resolvePolicyMock,
  getAllowedIntegrationsMock,
  generationFindFirstMock,
} = vi.hoisted(() => ({
  authorizeRuntimeTurnMock: vi.fn<VitestProcedure>(),
  resolvePolicyMock: vi.fn<VitestProcedure>(),
  getAllowedIntegrationsMock: vi.fn<VitestProcedure>(),
  generationFindFirstMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/server/internal/runtime-auth", () => ({
  authorizeRuntimeTurn: authorizeRuntimeTurnMock,
  buildRuntimeAuthErrorResponse: vi.fn<VitestProcedure>(() =>
    Response.json({ error: "invalid_callback_token" }, { status: 401 }),
  ),
}));

vi.mock("@bap/core/server/services/workspace-integration-policy", () => ({
  resolveWorkspaceIntegrationOperationPolicy: resolvePolicyMock,
}));

vi.mock("@bap/core/server/services/generation-manager", () => ({
  generationManager: {
    getAllowedIntegrationsForGeneration: getAllowedIntegrationsMock,
    requestPluginApproval: vi.fn<VitestProcedure>(),
    requestAuthInterrupt: vi.fn<VitestProcedure>(),
  },
}));

vi.mock("@bap/core/server/services/generation-interrupt-service", () => ({
  generationInterruptService: {
    findPendingInterruptByToolUseId: vi.fn<VitestProcedure>(),
    getInterrupt: vi.fn<VitestProcedure>(),
    markInterruptApplied: vi.fn<VitestProcedure>(),
  },
}));

vi.mock("@bap/core/server/integrations/cli-env", () => ({
  getTokensForIntegrations: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      generation: {
        findFirst: generationFindFirstMock,
      },
    },
  },
}));

import { handleInterruptCreate } from "./runtime-interrupts";

function policyRequest() {
  return new Request("https://example.com/api/internal/runtime/interrupts/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer callback",
    },
    body: JSON.stringify({
      kind: "policy_check",
      runtimeId: "runtime-1",
      turnSeq: 3,
      integration: "google_gmail",
      operation: "send",
    }),
  });
}

describe("runtime integration policy callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeRuntimeTurnMock.mockResolvedValue({
      ok: true,
      generationId: "gen-1",
      runtimeId: "runtime-1",
      turnSeq: 3,
    });
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      executionPolicy: { autoApprove: false },
      conversation: {
        workspaceId: "ws-1",
        autoApprove: false,
        userId: "user-1",
      },
    });
    getAllowedIntegrationsMock.mockResolvedValue(["google_gmail"]);
    resolvePolicyMock.mockResolvedValue({
      decision: "denied",
      source: "operation_denied",
      policyExplicit: true,
    });
  });

  it("returns the current Workspace policy decision for the authorized Generation", async () => {
    const response = await handleInterruptCreate(policyRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      decision: "denied",
      source: "operation_denied",
      policyExplicit: true,
    });
    expect(resolvePolicyMock).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      subject: {
        kind: "integration",
        integrationType: "google_gmail",
      },
      operationKey: "send",
      generationAutoApprove: false,
    });
  });

  it("passes Generation auto-approval into the shared resolver", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      executionPolicy: { autoApprove: true },
      conversation: {
        workspaceId: "ws-1",
        autoApprove: false,
        userId: "user-1",
      },
    });

    await handleInterruptCreate(policyRequest());

    expect(resolvePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ generationAutoApprove: true }),
    );
  });

  it("does not evaluate policy for an integration outside the Generation Toolbox", async () => {
    getAllowedIntegrationsMock.mockResolvedValue(["salesforce"]);

    const response = await handleInterruptCreate(policyRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "integration_not_allowed" });
    expect(resolvePolicyMock).not.toHaveBeenCalled();
  });
});
