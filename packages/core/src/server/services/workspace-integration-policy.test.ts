import { describe, expect, it } from "vitest";
import {
  hasWorkspaceManagedMcpAccess,
  normalizeWorkspaceIntegrationPolicyMutation,
  workspaceIntegrationPolicySubjectKey,
} from "./workspace-integration-policy";
import { vi } from "vitest";

describe("Workspace integration policy service", () => {
  it("builds stable, disjoint subject keys", () => {
    expect(
      workspaceIntegrationPolicySubjectKey({
        kind: "integration",
        integrationType: "google_gmail",
      }),
    ).toBe("integration:google_gmail");
    expect(
      workspaceIntegrationPolicySubjectKey({
        kind: "workspace_mcp_server",
        workspaceMcpServerId: "google_gmail",
      }),
    ).toBe("workspace_mcp_server:google_gmail");
  });

  it("accepts only restrictive, unique Personalized operation settings", () => {
    expect(
      normalizeWorkspaceIntegrationPolicyMutation({
        mode: "personalized",
        restrictions: [
          { operationKey: "send", restriction: "denied" },
          { operationKey: "search", restriction: "requires_approval" },
        ],
      }),
    ).toEqual([
      { operationKey: "search", restriction: "requires_approval" },
      { operationKey: "send", restriction: "denied" },
    ]);

    expect(() =>
      normalizeWorkspaceIntegrationPolicyMutation({
        mode: "auto_approved",
        restrictions: [{ operationKey: "send", restriction: "denied" }],
      }),
    ).toThrow("Operation restrictions are only valid in Personalized mode.");

    expect(() =>
      normalizeWorkspaceIntegrationPolicyMutation({
        mode: "personalized",
        restrictions: [
          { operationKey: "send", restriction: "denied" },
          { operationKey: " send ", restriction: "requires_approval" },
        ],
      }),
    ).toThrow("Duplicate operation restriction: send");
  });

  it("shows managed MCP servers only when the workspace has access", async () => {
    const database = {
      query: {
        galienWorkspaceAccess: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        modulrWorkspaceAccess: {
          findFirst: vi.fn().mockResolvedValue({ id: "modulr-access" }),
        },
      },
    };

    await expect(
      hasWorkspaceManagedMcpAccess({
        database: database as never,
        workspaceId: "workspace-1",
        internalKey: "galien",
        managedWorkspaceWideAccess: false,
      }),
    ).resolves.toBe(false);
    await expect(
      hasWorkspaceManagedMcpAccess({
        database: database as never,
        workspaceId: "workspace-1",
        internalKey: "modulr",
        managedWorkspaceWideAccess: false,
      }),
    ).resolves.toBe(true);
    await expect(
      hasWorkspaceManagedMcpAccess({
        database: database as never,
        workspaceId: "workspace-1",
        internalKey: "galien",
        managedWorkspaceWideAccess: true,
      }),
    ).resolves.toBe(true);
  });
});
