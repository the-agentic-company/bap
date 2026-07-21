import { describe, expect, it, vi } from "vitest";
import {
  handleAttachmentCompleteUpload,
  handleAttachmentPrepareUpload,
  handleCoworkerRunRead,
  handleSkillSave,
  handleWorkspaceMcpServerSave,
  handleWorkspaceMemberSave,
  handleChatRun,
} from "./handlers";

describe("target MCP contract handlers", () => {
  it("rejects an empty chat turn without attachments", async () => {
    await expect(handleChatRun({ client: {} as never, message: "   " })).rejects.toThrow(
      "requires a message or at least one ready attachment",
    );
  });

  it("creates a skill with nested files and applies create-time metadata", async () => {
    const client = {
      skill: {
        import: vi.fn().mockResolvedValue({ id: "skill-new", name: "new-skill" }),
        update: vi.fn().mockResolvedValue({ success: true }),
        share: vi.fn().mockResolvedValue({ success: true }),
        get: vi.fn().mockResolvedValue({ id: "skill-new", files: [] }),
      },
    };

    await handleSkillSave({
      client: client as never,
      values: {
        displayName: "New skill",
        visibility: "public",
        files: [
          { path: "SKILL.md", contentBase64: "IyBTa2lsbA==" },
          { path: "references/example.md", contentBase64: "RXhhbXBsZQ==" },
        ],
      },
    });

    expect(client.skill.import).toHaveBeenCalledWith({
      mode: "folder",
      files: [
        { path: "SKILL.md", contentBase64: "IyBTa2lsbA==" },
        { path: "references/example.md", contentBase64: "RXhhbXBsZQ==" },
      ],
    });
    expect(client.skill.update).toHaveBeenCalledWith({
      id: "skill-new",
      displayName: "New skill",
    });
    expect(client.skill.share).toHaveBeenCalledWith({ id: "skill-new" });
  });

  it("updates an existing Workspace Membership instead of creating an invitation", async () => {
    const client = {
      billing: {
        members: vi.fn().mockResolvedValue({
          members: [{ id: "member-1", email: "Member@Example.com", role: "member" }],
          invitations: [],
        }),
        setMemberRole: vi.fn().mockResolvedValue({
          id: "member-1",
          email: "member@example.com",
          role: "admin",
        }),
        inviteMembers: vi.fn(),
      },
    };

    const result = await handleWorkspaceMemberSave({
      client: client as never,
      workspaceId: "ws-1",
      email: "member@example.com",
      role: "admin",
    });

    expect(client.billing.setMemberRole).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      email: "member@example.com",
      role: "admin",
    });
    expect(client.billing.inviteMembers).not.toHaveBeenCalled();
    expect(result.access).toMatchObject({ type: "membership", role: "admin" });
  });

  it("returns a distinct invitation result for a new Workspace email", async () => {
    const client = {
      billing: {
        members: vi.fn().mockResolvedValue({ members: [], invitations: [] }),
        setMemberRole: vi.fn(),
        inviteMembers: vi.fn().mockResolvedValue({
          added: ["new@example.com"],
          alreadyMembers: [],
          notFound: [],
        }),
      },
    };

    const result = await handleWorkspaceMemberSave({
      client: client as never,
      workspaceId: "ws-1",
      email: "new@example.com",
      role: "member",
    });

    expect(client.billing.setMemberRole).not.toHaveBeenCalled();
    expect(result.access).toEqual({
      type: "invitation",
      email: "new@example.com",
      role: "member",
    });
  });

  it("preserves omitted Workspace MCP Server values during a partial save", async () => {
    const client = {
      workspaceMcpServer: {
        list: vi.fn().mockResolvedValue({
          workspaceId: "ws-1",
          membershipRole: "owner",
          sources: [
            {
              id: "server-1",
              name: "GitHub",
              namespace: "github",
              endpoint: "https://old.example/mcp",
              enabled: true,
            },
          ],
        }),
        update: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    await handleWorkspaceMcpServerSave({
      client: client as never,
      id: "server-1",
      values: { endpoint: "https://new.example/mcp" },
    });

    expect(client.workspaceMcpServer.update).toHaveBeenCalledWith({
      id: "server-1",
      kind: "mcp",
      name: "GitHub",
      namespace: "github",
      endpoint: "https://new.example/mcp",
    });
  });

  it("updates existing skill files and adds nested files in one save", async () => {
    const current = {
      id: "skill-1",
      slug: "brief-writer",
      displayName: "Brief writer",
      description: "Old",
      icon: null,
      enabled: true,
      visibility: "private" as const,
      files: [{ id: "file-1", path: "SKILL.md", mimeType: "text/markdown" }],
    };
    const client = {
      skill: {
        get: vi.fn().mockResolvedValue(current),
        updateFile: vi.fn().mockResolvedValue({ success: true }),
        addFile: vi.fn().mockResolvedValue({ id: "file-2", path: "references/example.md" }),
        update: vi.fn().mockResolvedValue({ success: true }),
        share: vi.fn().mockResolvedValue({
          success: true,
          id: "skill-1",
          visibility: "public",
        }),
        unshare: vi.fn(),
      },
    };

    await handleSkillSave({
      client: client as never,
      id: "skill-1",
      values: {
        description: "New",
        visibility: "public",
        files: [
          { path: "SKILL.md", contentBase64: "bmV3" },
          { path: "references/example.md", contentBase64: "ZXhhbXBsZQ==" },
        ],
      },
    });

    expect(client.skill.updateFile).toHaveBeenCalledWith({
      id: "file-1",
      contentBase64: "bmV3",
    });
    expect(client.skill.addFile).toHaveBeenCalledWith({
      skillId: "skill-1",
      path: "references/example.md",
      contentBase64: "ZXhhbXBsZQ==",
    });
    expect(client.skill.update).toHaveBeenCalledWith({ id: "skill-1", description: "New" });
    expect(client.skill.share).toHaveBeenCalledWith({ id: "skill-1" });
  });

  it("maps pending uploads and Ready File Assets to public attachment identities", async () => {
    const client = {
      fileAsset: {
        createUpload: vi.fn().mockResolvedValue({
          uploadSessionId: "upload-1",
          uploadUrl: "https://storage.example/signed",
          expiresAt: "2026-07-18T08:00:00.000Z",
        }),
        completeUpload: vi.fn().mockResolvedValue({
          id: "asset-1",
          filename: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
        }),
      },
    };

    const prepared = await handleAttachmentPrepareUpload({
      client: client as never,
      filename: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });
    const completed = await handleAttachmentCompleteUpload({
      client: client as never,
      attachmentId: prepared.attachment.attachmentId,
    });

    expect(client.fileAsset.completeUpload).toHaveBeenCalledWith({ uploadSessionId: "upload-1" });
    expect(completed.attachment).toMatchObject({
      attachmentId: "asset-1",
      filename: "brief.pdf",
    });
  });

  it("downloads only files attached to the Coworker Run conversation", async () => {
    const client = {
      coworker: {
        getRun: vi.fn().mockResolvedValue({ id: "run-1", conversationId: "conversation-1" }),
      },
      conversation: {
        get: vi.fn().mockResolvedValue({
          messages: [
            {
              sandboxFiles: [{ fileId: "file-1" }],
            },
          ],
        }),
        downloadSandboxFile: vi.fn().mockResolvedValue({ url: "https://storage.example/file-1" }),
      },
    };

    await handleCoworkerRunRead({
      client: client as never,
      query: { type: "downloadFile", runId: "run-1", fileId: "file-1" },
    });
    await expect(
      handleCoworkerRunRead({
        client: client as never,
        query: { type: "downloadFile", runId: "run-1", fileId: "file-other" },
      }),
    ).rejects.toThrow("File does not belong to this Coworker Run.");

    expect(client.conversation.downloadSandboxFile).toHaveBeenCalledTimes(1);
  });
});
