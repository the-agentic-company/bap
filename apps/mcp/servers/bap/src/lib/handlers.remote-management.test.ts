import { describe, expect, it, vi } from "vitest";
import {
  handleIntegrationList,
  handleIntegrationGetConnectUrl,
  handleIntegrationStatus,
  handleIntegrationDisconnect,
  handleRunProvideInput,
  handleRunResume,
  handleRunCancel,
  handleWorkspaceMcpServerList,
  handleWorkspaceMcpServerCreate,
  handleWorkspaceMcpServerUpdate,
  handleWorkspaceMcpServerDelete,
  handleWorkspaceMcpServerSetCredential,
  handleWorkspaceMcpServerStartOAuth,
  handleWorkspaceMcpServerDisconnectCredential,
  handleSkillList,
  handleSkillGet,
  handleSkillUpdate,
  handleSkillDelete,
  handleSkillSetEnabled,
  handleSkillSetVisibility,
  handleMembersList,
  handleMembersSetRole,
  handleMembersRemove,
  handleCoworkerExport,
  handleCoworkerClone,
  handleCoworkerDownloadFile,
} from "./handlers";

function sampleCoworkerDetails() {
  return {
    id: "cw-1",
    name: "Reporter",
    description: "desc",
    username: "reporter",
    status: "on",
    triggerType: "manual",
    prompt: "do the thing",
    model: "claude",
    authSource: "shared",
    autoApprove: true,
    toolAccessMode: "selected",
    allowedIntegrations: ["gmail"],
    allowedCustomIntegrations: [],
    allowedWorkspaceMcpServerIds: ["srv-1"],
    allowedSkillSlugs: ["weekly-report"],
    schedule: null,
    requiresUserInput: false,
    userInputPrompt: null,
    sharedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    documents: [
      {
        id: "doc-1",
        filename: "brief.md",
        mimeType: "text/markdown",
        sizeBytes: 12,
        description: "the brief",
        createdAt: "2026-01-01",
      },
    ],
    runs: [],
  };
}

describe("MCP handlers (remote management)", () => {
  it("lists integrations", async () => {
    const client = {
      integration: {
        list: vi.fn().mockResolvedValue([{ id: "i1", type: "gmail", authStatus: "connected" }]),
      },
    };
    const result = await handleIntegrationList(client as never);
    expect(result).toMatchObject({
      status: "completed",
      integrations: [{ id: "i1", type: "gmail" }],
    });
  });

  it("returns an integration connect URL", async () => {
    const client = {
      integration: { getAuthUrl: vi.fn().mockResolvedValue({ authUrl: "https://oauth.example" }) },
    };
    const result = await handleIntegrationGetConnectUrl({
      client: client as never,
      type: "gmail",
      redirectUrl: "https://app.example",
    });
    expect(client.integration.getAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "gmail", redirectUrl: "https://app.example" }),
    );
    expect(result).toMatchObject({
      status: "completed",
      type: "gmail",
      authUrl: "https://oauth.example",
    });
  });

  it("filters integration status by type", async () => {
    const client = {
      integration: {
        list: vi.fn().mockResolvedValue([
          {
            id: "i1",
            type: "gmail",
            displayName: "G",
            enabled: true,
            authStatus: "connected",
            authErrorCode: null,
            scopes: [],
            accountLabel: null,
          },
          {
            id: "i2",
            type: "slack",
            displayName: "S",
            enabled: true,
            authStatus: "error",
            authErrorCode: "x",
            scopes: [],
            accountLabel: null,
          },
        ]),
      },
    };
    const result = await handleIntegrationStatus({ client: client as never, type: "slack" });
    expect(result.integrations).toHaveLength(1);
    expect(result.integrations[0]).toMatchObject({ id: "i2", authStatus: "error" });
  });

  it("disconnects an integration", async () => {
    const client = { integration: { disconnect: vi.fn().mockResolvedValue({ success: true }) } };
    const result = await handleIntegrationDisconnect({ client: client as never, id: "i1" });
    expect(client.integration.disconnect).toHaveBeenCalledWith({ id: "i1" });
    expect(result).toMatchObject({ status: "completed", id: "i1", success: true });
  });

  it("provides input to a run waiting in needs_user_input", async () => {
    const client = {
      coworker: {
        getRun: vi.fn().mockResolvedValue({
          status: "needs_user_input",
          conversationId: "c1",
          generationId: "g0",
        }),
      },
      generation: {
        startGeneration: vi.fn().mockResolvedValue({ generationId: "g1", conversationId: "c1" }),
      },
    };
    const result = await handleRunProvideInput({
      client: client as never,
      runId: "r1",
      userInput: "go",
    });
    expect(client.generation.startGeneration).toHaveBeenCalledWith({
      conversationId: "c1",
      content: "go",
    });
    expect(result).toMatchObject({ status: "completed", runId: "r1", generationId: "g1" });
  });

  it("rejects provideInput when the run is not waiting", async () => {
    const client = {
      coworker: {
        getRun: vi.fn().mockResolvedValue({
          status: "running",
          conversationId: "c1",
          generationId: "g0",
        }),
      },
      generation: { startGeneration: vi.fn() },
    };
    await expect(
      handleRunProvideInput({ client: client as never, runId: "r1", userInput: "go" }),
    ).rejects.toThrow(/needs_user_input/);
    expect(client.generation.startGeneration).not.toHaveBeenCalled();
  });

  it("resumes a paused run", async () => {
    const client = {
      coworker: { getRun: vi.fn().mockResolvedValue({ status: "paused", generationId: "g1" }) },
      generation: { resumeGeneration: vi.fn().mockResolvedValue({ success: true }) },
    };
    const result = await handleRunResume({ client: client as never, runId: "r1" });
    expect(client.generation.resumeGeneration).toHaveBeenCalledWith({ generationId: "g1" });
    expect(result).toMatchObject({ status: "completed", success: true });
  });

  it("rejects resume when the run is not paused", async () => {
    const client = {
      coworker: { getRun: vi.fn().mockResolvedValue({ status: "running", generationId: "g1" }) },
      generation: { resumeGeneration: vi.fn() },
    };
    await expect(handleRunResume({ client: client as never, runId: "r1" })).rejects.toThrow(
      /not "paused"/,
    );
    expect(client.generation.resumeGeneration).not.toHaveBeenCalled();
  });

  it("cancels a run", async () => {
    const client = {
      coworker: { getRun: vi.fn().mockResolvedValue({ status: "running", generationId: "g1" }) },
      generation: { cancelGeneration: vi.fn().mockResolvedValue({ success: true }) },
    };
    const result = await handleRunCancel({ client: client as never, runId: "r1" });
    expect(client.generation.cancelGeneration).toHaveBeenCalledWith({ generationId: "g1" });
    expect(result).toMatchObject({ status: "completed", success: true });
  });

  it("rejects cancel when the run is already in a terminal state", async () => {
    const client = {
      coworker: { getRun: vi.fn().mockResolvedValue({ status: "completed", generationId: "g1" }) },
      generation: { cancelGeneration: vi.fn() },
    };
    await expect(handleRunCancel({ client: client as never, runId: "r1" })).rejects.toThrow(
      /already "completed"/,
    );
    expect(client.generation.cancelGeneration).not.toHaveBeenCalled();
  });

  it("creates a workspace MCP server", async () => {
    const client = { workspaceMcpServer: { create: vi.fn().mockResolvedValue({ id: "s1" }) } };
    const input = {
      kind: "mcp" as const,
      name: "X",
      namespace: "x",
      endpoint: "https://x.example/mcp",
    };
    const result = await handleWorkspaceMcpServerCreate({ client: client as never, input });
    expect(client.workspaceMcpServer.create).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ status: "completed", id: "s1" });
  });

  it("lists workspace MCP servers", async () => {
    const client = {
      workspaceMcpServer: {
        list: vi.fn().mockResolvedValue({
          workspaceId: "w1",
          membershipRole: "admin",
          sources: [{ id: "s1" }],
        }),
      },
    };
    const result = await handleWorkspaceMcpServerList(client as never);
    expect(result).toMatchObject({
      status: "completed",
      workspaceId: "w1",
      servers: [{ id: "s1" }],
    });
  });

  it("updates a workspace MCP server", async () => {
    const client = { workspaceMcpServer: { update: vi.fn().mockResolvedValue({ success: true }) } };
    const result = await handleWorkspaceMcpServerUpdate({
      client: client as never,
      id: "s1",
      input: { name: "X", namespace: "x", endpoint: "https://x.example/mcp" },
    });
    expect(client.workspaceMcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", name: "X" }),
    );
    expect(result).toMatchObject({ status: "completed", id: "s1" });
  });

  it("deletes a workspace MCP server", async () => {
    const client = { workspaceMcpServer: { delete: vi.fn().mockResolvedValue({ success: true }) } };
    const result = await handleWorkspaceMcpServerDelete({ client: client as never, id: "s1" });
    expect(client.workspaceMcpServer.delete).toHaveBeenCalledWith({ id: "s1" });
    expect(result).toMatchObject({ status: "completed", id: "s1", deleted: true });
  });

  it("sets a workspace MCP server credential", async () => {
    const client = {
      workspaceMcpServer: { setCredential: vi.fn().mockResolvedValue({ success: true }) },
    };
    const result = await handleWorkspaceMcpServerSetCredential({
      client: client as never,
      workspaceMcpServerId: "s1",
      secret: "sek",
    });
    expect(client.workspaceMcpServer.setCredential).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMcpServerId: "s1", secret: "sek" }),
    );
    expect(result).toMatchObject({ status: "completed", workspaceMcpServerId: "s1" });
  });

  it("starts OAuth for a workspace MCP server", async () => {
    const client = {
      workspaceMcpServer: {
        startOAuth: vi.fn().mockResolvedValue({ authUrl: "https://oauth.example/mcp" }),
      },
    };
    const result = await handleWorkspaceMcpServerStartOAuth({
      client: client as never,
      workspaceMcpServerId: "s1",
      redirectUrl: "https://app.example",
    });
    expect(client.workspaceMcpServer.startOAuth).toHaveBeenCalledWith({
      workspaceMcpServerId: "s1",
      redirectUrl: "https://app.example",
    });
    expect(result).toMatchObject({
      status: "completed",
      workspaceMcpServerId: "s1",
      authUrl: "https://oauth.example/mcp",
    });
  });

  it("disconnects a workspace MCP server credential", async () => {
    const client = {
      workspaceMcpServer: { disconnectCredential: vi.fn().mockResolvedValue({ success: true }) },
    };
    const result = await handleWorkspaceMcpServerDisconnectCredential({
      client: client as never,
      workspaceMcpServerId: "s1",
    });
    expect(client.workspaceMcpServer.disconnectCredential).toHaveBeenCalledWith({
      workspaceMcpServerId: "s1",
    });
    expect(result).toMatchObject({ status: "completed", workspaceMcpServerId: "s1" });
  });

  it("lists skills", async () => {
    const client = { skill: { list: vi.fn().mockResolvedValue([{ id: "sk1" }]) } };
    const result = await handleSkillList(client as never);
    expect(result).toMatchObject({ status: "completed", skills: [{ id: "sk1" }] });
  });

  it("gets a skill", async () => {
    const client = {
      skill: { get: vi.fn().mockResolvedValue({ id: "sk1", files: [], documents: [] }) },
    };
    const result = await handleSkillGet({ client: client as never, id: "sk1" });
    expect(client.skill.get).toHaveBeenCalledWith({ id: "sk1" });
    expect(result).toMatchObject({ status: "completed", skill: { id: "sk1" } });
  });

  it("updates a skill with only the provided fields", async () => {
    const client = {
      skill: {
        update: vi.fn().mockResolvedValue({ success: true }),
        get: vi.fn().mockResolvedValue({ id: "sk1" }),
      },
    };
    await handleSkillUpdate({ client: client as never, id: "sk1", displayName: "New" });
    expect(client.skill.update).toHaveBeenCalledWith({ id: "sk1", displayName: "New" });
  });

  it("throws when skill update has no fields", async () => {
    const client = { skill: { update: vi.fn(), get: vi.fn() } };
    await expect(handleSkillUpdate({ client: client as never, id: "sk1" })).rejects.toThrow(
      /at least one field/,
    );
  });

  it("deletes a skill", async () => {
    const client = { skill: { delete: vi.fn().mockResolvedValue({ success: true }) } };
    const result = await handleSkillDelete({ client: client as never, id: "sk1" });
    expect(result).toMatchObject({ status: "completed", id: "sk1", deleted: true });
  });

  it("sets skill enabled via update", async () => {
    const client = { skill: { update: vi.fn().mockResolvedValue({ success: true }) } };
    const result = await handleSkillSetEnabled({
      client: client as never,
      id: "sk1",
      enabled: false,
    });
    expect(client.skill.update).toHaveBeenCalledWith({ id: "sk1", enabled: false });
    expect(result).toMatchObject({ status: "completed", id: "sk1", enabled: false });
  });

  it("shares a skill when visibility is public", async () => {
    const client = {
      skill: {
        share: vi.fn().mockResolvedValue({ success: true, id: "sk1", visibility: "public" }),
        unshare: vi.fn(),
      },
    };
    const result = await handleSkillSetVisibility({
      client: client as never,
      id: "sk1",
      visibility: "public",
    });
    expect(client.skill.share).toHaveBeenCalledWith({ id: "sk1" });
    expect(client.skill.unshare).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed", visibility: "public" });
  });

  it("unshares a skill when visibility is private", async () => {
    const client = {
      skill: {
        share: vi.fn(),
        unshare: vi.fn().mockResolvedValue({ success: true, id: "sk1", visibility: "private" }),
      },
    };
    const result = await handleSkillSetVisibility({
      client: client as never,
      id: "sk1",
      visibility: "private",
    });
    expect(client.skill.unshare).toHaveBeenCalledWith({ id: "sk1" });
    expect(result).toMatchObject({ status: "completed", visibility: "private" });
  });

  it("lists workspace members", async () => {
    const client = {
      billing: {
        members: vi.fn().mockResolvedValue({
          members: [{ userId: "u1", email: "a@b.c", name: null, role: "admin" }],
          membershipRole: "admin",
        }),
      },
    };
    const result = await handleMembersList({ client: client as never, workspaceId: "w1" });
    expect(client.billing.members).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(result).toMatchObject({
      status: "completed",
      workspaceId: "w1",
      membershipRole: "admin",
    });
  });

  it("sets a workspace member role", async () => {
    const client = {
      billing: { setMemberRole: vi.fn().mockResolvedValue({ email: "a@b.c", role: "admin" }) },
    };
    const result = await handleMembersSetRole({
      client: client as never,
      workspaceId: "w1",
      email: "a@b.c",
      role: "admin",
    });
    expect(client.billing.setMemberRole).toHaveBeenCalledWith({
      workspaceId: "w1",
      email: "a@b.c",
      role: "admin",
    });
    expect(result).toMatchObject({
      status: "completed",
      workspaceId: "w1",
      email: "a@b.c",
      role: "admin",
    });
  });

  it("removes a workspace member via the workspace-admin path", async () => {
    const client = {
      billing: { removeMember: vi.fn().mockResolvedValue({ email: "a@b.c" }) },
    };
    const result = await handleMembersRemove({
      client: client as never,
      workspaceId: "w1",
      email: "a@b.c",
    });
    expect(client.billing.removeMember).toHaveBeenCalledWith({
      workspaceId: "w1",
      email: "a@b.c",
    });
    expect(result).toMatchObject({ status: "completed", email: "a@b.c", removed: true });
  });

  it("exports a coworker config", async () => {
    const client = { coworker: { get: vi.fn().mockResolvedValue(sampleCoworkerDetails()) } };
    const result = await handleCoworkerExport({ client: client as never, reference: "cw-1" });
    expect(client.coworker.get).toHaveBeenCalledWith({ id: "cw-1" });
    expect(result.export).toMatchObject({
      version: 1,
      name: "Reporter",
      triggerType: "manual",
      allowedSkillSlugs: ["weekly-report"],
      documents: [{ filename: "brief.md", mimeType: "text/markdown" }],
    });
  });

  it("clones a coworker config without copying documents", async () => {
    const client = {
      coworker: {
        get: vi.fn().mockResolvedValue(sampleCoworkerDetails()),
        create: vi.fn().mockResolvedValue({ id: "cw-2", name: "Reporter (copy)" }),
      },
    };
    const result = await handleCoworkerClone({ client: client as never, reference: "cw-1" });
    expect(client.coworker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Reporter (copy)",
        triggerType: "manual",
        prompt: "do the thing",
        allowedSkillSlugs: ["weekly-report"],
        allowedWorkspaceMcpServerIds: ["srv-1"],
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      sourceId: "cw-1",
      documentsCopied: false,
      sourceDocumentCount: 1,
    });
  });

  it("returns a signed download URL for a run file", async () => {
    const client = {
      conversation: {
        downloadSandboxFile: vi.fn().mockResolvedValue({
          url: "https://files.example/signed",
          filename: "out.pdf",
          mimeType: "application/pdf",
          path: "/app/out.pdf",
          sizeBytes: 100,
        }),
      },
    };
    const result = await handleCoworkerDownloadFile({ client: client as never, fileId: "f1" });
    expect(client.conversation.downloadSandboxFile).toHaveBeenCalledWith({ fileId: "f1" });
    expect(result).toMatchObject({
      status: "completed",
      file: { url: "https://files.example/signed", filename: "out.pdf" },
    });
  });
});
