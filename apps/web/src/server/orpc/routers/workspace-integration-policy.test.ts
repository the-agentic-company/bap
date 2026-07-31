import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

function createProcedureStub() {
  const stub = {
    input: vi.fn<VitestProcedure>(),
    handler: vi.fn<VitestProcedure>((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  return stub;
}

const {
  requireAccessMock,
  requireAdminMock,
  listCatalogMock,
  replacePolicyMock,
  discoverToolCatalogMock,
} = vi.hoisted(() => ({
  requireAccessMock: vi.fn<VitestProcedure>(),
  requireAdminMock: vi.fn<VitestProcedure>(),
  listCatalogMock: vi.fn<VitestProcedure>(),
  replacePolicyMock: vi.fn<VitestProcedure>(),
  discoverToolCatalogMock: vi.fn<VitestProcedure>(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: requireAccessMock,
  requireActiveWorkspaceAdmin: requireAdminMock,
}));

vi.mock("@bap/core/server/services/workspace-integration-policy", () => ({
  listWorkspaceIntegrationPolicyCatalog: listCatalogMock,
  replaceWorkspaceIntegrationPolicy: replacePolicyMock,
}));

vi.mock("@/server/internal/workspace-mcp-tool-discovery", () => ({
  discoverWorkspaceMcpToolCatalog: discoverToolCatalogMock,
}));

import {
  workspaceIntegrationPolicyRouter,
  workspaceIntegrationPolicySubjectSchema,
} from "./workspace-integration-policy";

const router = workspaceIntegrationPolicyRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

function context(server: { id: string; internalKey: string | null } | null = null) {
  return {
    user: { id: "user-1" },
    workspaceId: "workspace-1",
    db: {
      query: {
        workspaceMcpServer: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue(server),
        },
        workspaceMcpToolCatalog: {
          findMany: vi.fn<VitestProcedure>().mockResolvedValue([]),
        },
      },
    },
  };
}

describe("workspaceIntegrationPolicyRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessMock.mockResolvedValue({
      workspace: { id: "workspace-1" },
      membership: { role: "member" },
    });
    requireAdminMock.mockResolvedValue({
      workspace: { id: "workspace-1" },
      membership: { role: "admin" },
    });
    listCatalogMock.mockResolvedValue({
      managedIntegrations: [],
      workspaceMcpServers: [],
    });
    replacePolicyMock.mockResolvedValue({
      mode: "denied",
      explicit: true,
      restrictions: {},
    });
    discoverToolCatalogMock.mockResolvedValue(undefined);
  });

  it("allows an active member to read the effective catalog", async () => {
    await expect(router.list({ context: context() })).resolves.toEqual({
      workspaceId: "workspace-1",
      membershipRole: "member",
      canEdit: false,
      catalog: { managedIntegrations: [], workspaceMcpServers: [] },
    });
    expect(requireAccessMock).toHaveBeenCalledWith("user-1", "workspace-1");
    expect(discoverToolCatalogMock).not.toHaveBeenCalled();
  });

  it("discovers Workspace MCP tools before they need to be used", async () => {
    await expect(router.discover({ context: context() })).resolves.toEqual({
      success: true,
    });
    expect(discoverToolCatalogMock).toHaveBeenCalledWith({
      database: expect.anything(),
      workspaceId: "workspace-1",
      userId: "user-1",
    });
  });

  it("requires owner or admin access before mutation", async () => {
    requireAdminMock.mockRejectedValue(
      new ORPCError("FORBIDDEN", { message: "Workspace admin access is required." }),
    );

    await expect(
      router.replace({
        input: {
          subject: { kind: "integration", integrationType: "salesforce" },
          mode: "denied",
          restrictions: [],
        },
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(replacePolicyMock).not.toHaveBeenCalled();
  });

  it("lets an admin replace an Integration Type policy", async () => {
    await expect(
      router.replace({
        input: {
          subject: { kind: "integration", integrationType: "salesforce" },
          mode: "denied",
          restrictions: [],
        },
        context: context(),
      }),
    ).resolves.toMatchObject({ mode: "denied" });
    expect(replacePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        subject: { kind: "integration", integrationType: "salesforce" },
      }),
    );
  });

  it("rejects a Workspace MCP Server outside the active Workspace", async () => {
    await expect(
      router.replace({
        input: {
          subject: { kind: "workspace_mcp_server", workspaceMcpServerId: "other-server" },
          mode: "denied",
          restrictions: [],
        },
        context: context(null),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(replacePolicyMock).not.toHaveBeenCalled();
  });

  it("does not accept Platform MCP identities as policy subjects", () => {
    expect(
      workspaceIntegrationPolicySubjectSchema.safeParse({
        kind: "platform_mcp_server",
        internalKey: "bap",
      }).success,
    ).toBe(false);
  });

  it("rejects a persisted Bap Platform MCP row", async () => {
    await expect(
      router.replace({
        input: {
          subject: { kind: "workspace_mcp_server", workspaceMcpServerId: "bap-server" },
          mode: "denied",
          restrictions: [],
        },
        context: context({ id: "bap-server", internalKey: "bap" }),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replacePolicyMock).not.toHaveBeenCalled();
  });
});
