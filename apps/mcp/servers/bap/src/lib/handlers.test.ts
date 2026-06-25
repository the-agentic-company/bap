import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import {
  handleChatRun,
  handleCoworkerCreate,
  handleCoworkerDelete,
  handleCoworkerDeleteDocument,
  handleCoworkerGet,
  handleCoworkerList,
  handleCoworkerLogs,
  handleCoworkerMove,
  handleCoworkerMoveWorkspace,
  handleCoworkerRun,
  handleCoworkerRuns,
  handleCoworkerSetFavorite,
  handleCoworkerSetStatus,
  handleCoworkerUpdate,
  handleCoworkerUpdateDocument,
  handleCoworkerUploadDocument,
  handleSkillAdd,
  handleWorkspaceList,
  handleWorkspaceCreate,
  handleWorkspaceAddMembers,
  handleWorkspaceSwitch,
} from "./handlers";

describe("MCP handlers", () => {
  it("surfaces needs_auth from chat runs", async () => {
    const client = {
      generation: {
        startGeneration: vi.fn().mockResolvedValue({
          generationId: "gen-1",
          conversationId: "conv-1",
        }),
        subscribeGeneration: vi.fn().mockResolvedValue(
          (async function* () {
            yield {
              type: "interrupt_pending" as const,
              generationId: "gen-1",
              conversationId: "conv-1",
              kind: "auth" as const,
              providerToolUseId: "tool-1",
              display: {
                title: "Auth required",
                authSpec: {
                  integrations: ["google_drive"],
                },
              },
            };
          })(),
        ),
      },
    };

    const result = await handleChatRun({
      client: client as never,
      message: "hi",
    });

    expect(result.status).toBe("needs_auth");
  });

  it("lists coworkers", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
      },
    };

    const result = await handleCoworkerList(client as never);
    expect(result.status).toBe("completed");
    expect(result.coworkers).toHaveLength(1);
  });

  it("lists workspaces from billing overview", async () => {
    const client = {
      billing: {
        overview: vi.fn().mockResolvedValue({
          owner: { ownerType: "workspace", ownerId: "ws-2", planId: "free" },
          workspaces: [
            {
              id: "ws-1",
              name: "Alpha",
              slug: "alpha",
              imageUrl: null,
              role: "member",
              billingPlanId: "free",
              active: false,
            },
            {
              id: "ws-2",
              name: "Beta",
              slug: "beta",
              imageUrl: null,
              role: "admin",
              billingPlanId: "free",
              active: true,
            },
          ],
        }),
      },
    };

    const result = await handleWorkspaceList(client as never);

    expect(client.billing.overview).toHaveBeenCalledWith();
    expect(result).toEqual({
      status: "completed",
      activeWorkspaceId: "ws-2",
      workspaces: [
        {
          id: "ws-1",
          name: "Alpha",
          slug: "alpha",
          imageUrl: null,
          role: "member",
          billingPlanId: "free",
          active: false,
        },
        {
          id: "ws-2",
          name: "Beta",
          slug: "beta",
          imageUrl: null,
          role: "admin",
          billingPlanId: "free",
          active: true,
        },
      ],
    });
  });

  it("switches the active workspace and returns the refreshed workspace list", async () => {
    const client = {
      billing: {
        switchWorkspace: vi.fn().mockResolvedValue({ success: true }),
        overview: vi.fn().mockResolvedValue({
          owner: { ownerType: "workspace", ownerId: "ws-2", planId: "free" },
          workspaces: [
            {
              id: "ws-1",
              name: "Alpha",
              slug: "alpha",
              imageUrl: null,
              role: "member",
              billingPlanId: "free",
              active: false,
            },
            {
              id: "ws-2",
              name: "Beta",
              slug: "beta",
              imageUrl: null,
              role: "admin",
              billingPlanId: "free",
              active: true,
            },
          ],
        }),
      },
    };

    const result = await handleWorkspaceSwitch({
      client: client as never,
      workspaceId: "ws-2",
    });

    expect(client.billing.switchWorkspace).toHaveBeenCalledWith({ workspaceId: "ws-2" });
    expect(client.billing.overview).toHaveBeenCalledWith();
    expect(result).toEqual({
      status: "completed",
      activeWorkspaceId: "ws-2",
      workspaces: [
        {
          id: "ws-1",
          name: "Alpha",
          slug: "alpha",
          imageUrl: null,
          role: "member",
          billingPlanId: "free",
          active: false,
        },
        {
          id: "ws-2",
          name: "Beta",
          slug: "beta",
          imageUrl: null,
          role: "admin",
          billingPlanId: "free",
          active: true,
        },
      ],
    });
  });

  it("creates a workspace and returns the refreshed workspace list", async () => {
    const client = {
      billing: {
        createWorkspace: vi.fn().mockResolvedValue({
          id: "ws-3",
          name: "Gamma",
          billingPlanId: "free",
        }),
        overview: vi.fn().mockResolvedValue({
          owner: { ownerType: "workspace", ownerId: "ws-3", planId: "free" },
          workspaces: [
            {
              id: "ws-1",
              name: "Alpha",
              slug: "alpha",
              imageUrl: null,
              role: "owner",
              billingPlanId: "free",
              active: false,
            },
            {
              id: "ws-3",
              name: "Gamma",
              slug: "gamma",
              imageUrl: null,
              role: "owner",
              billingPlanId: "free",
              active: true,
            },
          ],
        }),
      },
    };

    const result = await handleWorkspaceCreate({
      client: client as never,
      name: "Gamma",
    });

    expect(client.billing.createWorkspace).toHaveBeenCalledWith({ name: "Gamma" });
    expect(client.billing.overview).toHaveBeenCalledWith();
    expect(result).toEqual({
      status: "completed",
      workspace: {
        id: "ws-3",
        name: "Gamma",
        billingPlanId: "free",
      },
      activeWorkspaceId: "ws-3",
      workspaces: [
        {
          id: "ws-1",
          name: "Alpha",
          slug: "alpha",
          imageUrl: null,
          role: "owner",
          billingPlanId: "free",
          active: false,
        },
        {
          id: "ws-3",
          name: "Gamma",
          slug: "gamma",
          imageUrl: null,
          role: "owner",
          billingPlanId: "free",
          active: true,
        },
      ],
    });
  });

  it("adds members to a workspace with the requested role", async () => {
    const client = {
      billing: {
        inviteMembers: vi.fn().mockResolvedValue({
          added: ["alice@example.com", "bob@example.com"],
          alreadyMembers: ["carol@example.com"],
          notFound: ["nobody@example.com"],
        }),
      },
    };

    const result = await handleWorkspaceAddMembers({
      client: client as never,
      workspaceId: "ws-2",
      emails: ["alice@example.com", "bob@example.com"],
      role: "admin",
    });

    expect(client.billing.inviteMembers).toHaveBeenCalledWith({
      workspaceId: "ws-2",
      emails: ["alice@example.com", "bob@example.com"],
      role: "admin",
    });
    expect(result).toEqual({
      status: "completed",
      workspaceId: "ws-2",
      role: "admin",
      added: ["alice@example.com", "bob@example.com"],
      alreadyMembers: ["carol@example.com"],
      notFound: ["nobody@example.com"],
    });
  });

  it("gets a coworker by username reference", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        get: vi.fn().mockResolvedValue({ id: "cw-1", name: "Daily" }),
      },
    };

    const result = await handleCoworkerGet(client as never, "@daily");
    expect(result.coworker).toMatchObject({ id: "cw-1" });
  });

  it("creates a coworker from the CLI-equivalent MCP fields", async () => {
    const client = {
      coworker: {
        create: vi.fn().mockResolvedValue({
          id: "cw-1",
          name: "Daily",
          username: null,
          status: "on",
        }),
      },
    };

    const result = await handleCoworkerCreate({
      client: client as never,
      name: "Daily",
      trigger: "manual",
      prompt: "Summarize unread customer email.",
      autoApprove: false,
      authSource: "shared",
      integrations: ["gmail", "slack"],
    });

    expect(client.coworker.create).toHaveBeenCalledWith({
      name: "Daily",
      triggerType: "manual",
      prompt: "Summarize unread customer email.",
      autoApprove: false,
      model: DEFAULT_CONNECTED_CHATGPT_MODEL,
      authSource: "shared",
      toolAccessMode: "selected",
      allowedIntegrations: ["gmail", "slack"],
    });
    expect(result).toMatchObject({
      status: "completed",
      coworker: { id: "cw-1", status: "on" },
    });
  });

  it("does not invent omitted coworker create fields except the CLI model default", async () => {
    const client = {
      coworker: {
        create: vi.fn().mockResolvedValue({
          id: "cw-1",
          name: "",
          username: null,
          status: "on",
        }),
      },
    };

    await handleCoworkerCreate({
      client: client as never,
      trigger: "manual",
      prompt: "Reply exactly hi.",
    });

    expect(client.coworker.create).toHaveBeenCalledWith({
      name: undefined,
      triggerType: "manual",
      prompt: "Reply exactly hi.",
      autoApprove: undefined,
      model: DEFAULT_CONNECTED_CHATGPT_MODEL,
      authSource: undefined,
      toolAccessMode: undefined,
      allowedIntegrations: undefined,
    });
  });

  it("creates a builder shell when trigger and prompt are omitted", async () => {
    const client = {
      coworker: {
        create: vi.fn().mockResolvedValue({
          id: "cw-1",
          name: "Lead Magnet Automation on LinkedIn",
          username: null,
          status: "on",
        }),
      },
    };

    await handleCoworkerCreate({
      client: client as never,
      name: "Lead Magnet Automation on LinkedIn",
    });

    expect(client.coworker.create).toHaveBeenCalledWith({
      name: "Lead Magnet Automation on LinkedIn",
      triggerType: "manual",
      prompt: "",
      autoApprove: undefined,
      model: DEFAULT_CONNECTED_CHATGPT_MODEL,
      authSource: undefined,
      toolAccessMode: undefined,
      allowedIntegrations: undefined,
    });
  });

  it("creates a folder path and moves the created coworker into it", async () => {
    const client = {
      coworker: {
        create: vi.fn().mockResolvedValue({
          id: "cw-1",
          name: "Lead Magnet Automation on LinkedIn",
          username: null,
          status: "on",
        }),
      },
      coworkerFolder: {
        createPath: vi.fn().mockResolvedValue({
          id: "folder-1",
          name: "LinkedIn",
          parentId: null,
        }),
        moveCoworker: vi.fn().mockResolvedValue({ id: "cw-1", folderId: "folder-1" }),
      },
    };

    const result = await handleCoworkerCreate({
      client: client as never,
      name: "Lead Magnet Automation on LinkedIn",
      folderPath: " Marketing / LinkedIn ",
    });

    expect(client.coworkerFolder.createPath).toHaveBeenCalledWith({
      path: "Marketing / LinkedIn",
    });
    expect(client.coworkerFolder.moveCoworker).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      folderId: "folder-1",
    });
    expect(result.folder).toMatchObject({ id: "folder-1" });
  });

  it("uploads initial files after creating a coworker", async () => {
    const client = {
      coworker: {
        create: vi.fn().mockResolvedValue({
          id: "cw-1",
          name: "Output HTML Copier",
          username: null,
          status: "on",
        }),
        uploadDocument: vi.fn().mockResolvedValue({
          id: "doc-1",
          filename: "output.html",
          mimeType: "text/html",
          sizeBytes: 42,
        }),
      },
    };

    const result = await handleCoworkerCreate({
      client: client as never,
      name: "Output HTML Copier",
      trigger: "manual",
      prompt: "Copy the provided HTML into app/output.html.",
      files: [
        {
          filename: "output.html",
          mimeType: "text/html",
          contentBase64: "PGh0bWw+PC9odG1sPg==",
          description: "Reference HTML",
        },
      ],
    });

    expect(client.coworker.uploadDocument).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      filename: "output.html",
      mimeType: "text/html",
      content: "PGh0bWw+PC9odG1sPg==",
      description: "Reference HTML",
    });
    expect(result.documents).toEqual([
      {
        id: "doc-1",
        filename: "output.html",
        mimeType: "text/html",
        sizeBytes: 42,
      },
    ]);
  });

  it("triggers a coworker run", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        trigger: vi.fn().mockResolvedValue({ runId: "run-1", coworkerId: "cw-1" }),
      },
    };

    const result = await handleCoworkerRun({
      client: client as never,
      reference: "@daily",
      payload: { source: "test" },
    });

    expect(result.run).toMatchObject({ runId: "run-1" });
  });

  it("deletes a coworker by username reference and returns the deleted details", async () => {
    const deletedCoworker = {
      id: "cw-1",
      name: "Daily",
      username: "daily",
      documents: [],
      runs: [],
    };
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        get: vi.fn().mockResolvedValue(deletedCoworker),
        delete: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    const result = await handleCoworkerDelete({
      client: client as never,
      reference: "@daily",
    });

    expect(client.coworker.get).toHaveBeenCalledWith({ id: "cw-1" });
    expect(client.coworker.delete).toHaveBeenCalledWith({ id: "cw-1" });
    expect(result).toEqual({
      status: "completed",
      coworkerId: "cw-1",
      deletedCoworker,
      success: true,
    });
  });

  it("passes coworker run user input as trusted user input", async () => {
    const client = {
      coworker: {
        trigger: vi.fn().mockResolvedValue({
          runId: "run-1",
          coworkerId: "cw-1",
          generationId: "gen-1",
        }),
      },
    };

    const result = await handleCoworkerRun({
      client: client as never,
      reference: "cw-1",
      payload: { source: "test" },
      userInput: "  use alice@example.com  ",
    });

    expect(client.coworker.trigger).toHaveBeenCalledWith({
      id: "cw-1",
      payload: { source: "test" },
      trustedUserInput: "use alice@example.com",
      debugRunDeadlineMs: undefined,
    });
    expect(result.run).toMatchObject({ runId: "run-1" });
  });

  it("uploads documents to an existing coworker by username reference", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        uploadDocument: vi.fn().mockResolvedValue({
          id: "doc-1",
          filename: "brief.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
        }),
      },
    };

    const result = await handleCoworkerUploadDocument({
      client: client as never,
      reference: "@daily",
      files: [
        {
          filename: "brief.txt",
          mimeType: "text/plain",
          contentBase64: "aGVsbG8=",
        },
      ],
    });

    expect(client.coworker.uploadDocument).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      filename: "brief.txt",
      mimeType: "text/plain",
      content: "aGVsbG8=",
      description: undefined,
    });
    expect(result).toMatchObject({
      status: "completed",
      coworkerId: "cw-1",
      documents: [{ id: "doc-1", filename: "brief.txt" }],
    });
  });

  it("updates a coworker by username reference and returns updated details", async () => {
    const updatedCoworker = {
      id: "cw-1",
      name: "Daily updated",
      description: "Updated description",
      username: "daily",
      documents: [],
      runs: [],
    };
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        update: vi.fn().mockResolvedValue({ success: true }),
        get: vi.fn().mockResolvedValue(updatedCoworker),
      },
    };

    const result = await handleCoworkerUpdate({
      client: client as never,
      reference: "@daily",
      name: "Daily updated",
      description: null,
      trigger: "schedule",
      prompt: "Summarize the day.",
      autoApprove: false,
      isPinned: true,
      model: "openai/gpt-5.5",
      authSource: "shared",
      toolAccessMode: "selected",
      integrations: ["slack"],
      customIntegrations: ["custom-1"],
      workspaceMcpServerIds: ["server-1"],
      skillSlugs: ["weekly-report"],
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      requiresUserInput: true,
      userInputPrompt: "What should I summarize?",
    });

    expect(client.coworker.update).toHaveBeenCalledWith({
      id: "cw-1",
      name: "Daily updated",
      description: null,
      triggerType: "schedule",
      prompt: "Summarize the day.",
      autoApprove: false,
      isPinned: true,
      model: "openai/gpt-5.5",
      authSource: "shared",
      toolAccessMode: "selected",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-1"],
      allowedWorkspaceMcpServerIds: ["server-1"],
      allowedSkillSlugs: ["weekly-report"],
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      requiresUserInput: true,
      userInputPrompt: "What should I summarize?",
    });
    expect(client.coworker.get).toHaveBeenCalledWith({ id: "cw-1" });
    expect(result).toEqual({
      status: "completed",
      coworker: updatedCoworker,
    });
  });

  it("rejects empty coworker updates", async () => {
    const client = {
      coworker: {
        update: vi.fn(),
        get: vi.fn(),
      },
    };

    await expect(
      handleCoworkerUpdate({
        client: client as never,
        reference: "cw-1",
      }),
    ).rejects.toThrow("Coworker update must include at least one field.");

    expect(client.coworker.update).not.toHaveBeenCalled();
  });

  it("moves a coworker by username reference to a created folder path", async () => {
    const updatedCoworker = {
      id: "cw-1",
      name: "Daily",
      username: "daily",
      folderId: "folder-1",
    };
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        get: vi.fn().mockResolvedValue(updatedCoworker),
      },
      coworkerFolder: {
        createPath: vi.fn().mockResolvedValue({
          id: "folder-1",
          name: "LinkedIn",
          parentId: null,
        }),
        moveCoworker: vi.fn().mockResolvedValue({ id: "cw-1", folderId: "folder-1" }),
      },
    };

    const result = await handleCoworkerMove({
      client: client as never,
      reference: "@daily",
      folderPath: " Marketing / LinkedIn ",
    });

    expect(client.coworkerFolder.createPath).toHaveBeenCalledWith({
      path: "Marketing / LinkedIn",
    });
    expect(client.coworkerFolder.moveCoworker).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      folderId: "folder-1",
    });
    expect(client.coworker.get).toHaveBeenCalledWith({ id: "cw-1" });
    expect(result).toMatchObject({
      status: "completed",
      coworker: { id: "cw-1", folderId: "folder-1" },
      folder: { id: "folder-1" },
    });
  });

  it("moves a coworker to the top level", async () => {
    const client = {
      coworker: {
        get: vi.fn().mockResolvedValue({ id: "cw-1", folderId: null }),
      },
      coworkerFolder: {
        moveCoworker: vi.fn().mockResolvedValue({ id: "cw-1", folderId: null }),
      },
    };

    await handleCoworkerMove({
      client: client as never,
      reference: "cw-1",
      folder: null,
    });

    expect(client.coworkerFolder.moveCoworker).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      folderId: null,
    });
  });

  it("rejects coworker move calls without exactly one destination", async () => {
    const client = {
      coworkerFolder: {
        moveCoworker: vi.fn(),
      },
    };

    await expect(
      handleCoworkerMove({
        client: client as never,
        reference: "cw-1",
      }),
    ).rejects.toThrow("Coworker move must include exactly one destination.");
    await expect(
      handleCoworkerMove({
        client: client as never,
        reference: "cw-1",
        folderId: "folder-1",
        folder: null,
      }),
    ).rejects.toThrow("Coworker move must include exactly one destination.");

    expect(client.coworkerFolder.moveCoworker).not.toHaveBeenCalled();
  });

  it("moves a coworker to another workspace by username reference", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        moveWorkspace: vi.fn().mockResolvedValue({
          id: "cw-1",
          workspaceId: "ws-2",
          sourceWorkspaceId: "ws-1",
          targetWorkspaceId: "ws-2",
          triggerType: "manual",
        }),
      },
    };

    const result = await handleCoworkerMoveWorkspace({
      client: client as never,
      reference: "@daily",
      targetWorkspaceId: "ws-2",
    });

    expect(client.coworker.moveWorkspace).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      targetWorkspaceId: "ws-2",
    });
    expect(result).toEqual({
      status: "completed",
      id: "cw-1",
      workspaceId: "ws-2",
      sourceWorkspaceId: "ws-1",
      targetWorkspaceId: "ws-2",
      triggerType: "manual",
    });
  });

  it("sets coworker favorite state by username reference", async () => {
    const updatedCoworker = {
      id: "cw-1",
      name: "Daily",
      username: "daily",
      isPinned: true,
    };
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        update: vi.fn().mockResolvedValue({ success: true }),
        get: vi.fn().mockResolvedValue(updatedCoworker),
      },
    };

    const result = await handleCoworkerSetFavorite({
      client: client as never,
      reference: "@daily",
      favorite: true,
    });

    expect(client.coworker.update).toHaveBeenCalledWith({ id: "cw-1", isPinned: true });
    expect(result).toEqual({
      status: "completed",
      coworker: updatedCoworker,
    });
  });

  it("sets coworker status by username reference", async () => {
    const updatedCoworker = {
      id: "cw-1",
      name: "Daily",
      username: "daily",
      status: "off",
    };
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        update: vi.fn().mockResolvedValue({ success: true }),
        get: vi.fn().mockResolvedValue(updatedCoworker),
      },
    };

    const result = await handleCoworkerSetStatus({
      client: client as never,
      reference: "@daily",
      status: "off",
    });

    expect(client.coworker.update).toHaveBeenCalledWith({ id: "cw-1", status: "off" });
    expect(result).toEqual({
      status: "completed",
      coworker: updatedCoworker,
    });
  });

  it("updates coworker document metadata after checking coworker ownership", async () => {
    const client = {
      coworker: {
        list: vi.fn().mockResolvedValue([{ id: "cw-1", name: "Daily", username: "daily" }]),
        get: vi.fn().mockResolvedValue({
          id: "cw-1",
          documents: [{ id: "doc-1", filename: "brief.txt" }],
        }),
        updateDocument: vi.fn().mockResolvedValue({
          id: "doc-1",
          filename: "brief-v2.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          description: null,
        }),
      },
    };

    const result = await handleCoworkerUpdateDocument({
      client: client as never,
      reference: "@daily",
      documentId: "doc-1",
      filename: "brief-v2.txt",
      description: null,
    });

    expect(client.coworker.updateDocument).toHaveBeenCalledWith({
      id: "doc-1",
      filename: "brief-v2.txt",
      mimeType: undefined,
      content: undefined,
      description: null,
    });
    expect(result).toMatchObject({
      status: "completed",
      coworkerId: "cw-1",
      document: { id: "doc-1", filename: "brief-v2.txt", description: null },
    });
  });

  it("requires complete file fields when replacing a coworker document", async () => {
    const client = {
      coworker: {
        get: vi.fn(),
        updateDocument: vi.fn(),
      },
    };

    await expect(
      handleCoworkerUpdateDocument({
        client: client as never,
        reference: "cw-1",
        documentId: "doc-1",
        contentBase64: "aGVsbG8=",
      }),
    ).rejects.toThrow("File replacement requires filename, mimeType, and contentBase64.");

    expect(client.coworker.updateDocument).not.toHaveBeenCalled();
  });

  it("rejects coworker document mutations when the document belongs to another coworker", async () => {
    const client = {
      coworker: {
        get: vi.fn().mockResolvedValue({
          id: "cw-1",
          documents: [{ id: "doc-other", filename: "other.txt" }],
        }),
        deleteDocument: vi.fn(),
      },
    };

    await expect(
      handleCoworkerDeleteDocument({
        client: client as never,
        reference: "cw-1",
        documentId: "doc-1",
      }),
    ).rejects.toThrow("Document does not belong to the referenced coworker.");

    expect(client.coworker.deleteDocument).not.toHaveBeenCalled();
  });

  it("deletes a coworker document after checking coworker ownership", async () => {
    const client = {
      coworker: {
        get: vi.fn().mockResolvedValue({
          id: "cw-1",
          documents: [{ id: "doc-1", filename: "brief.txt" }],
        }),
        deleteDocument: vi.fn().mockResolvedValue({
          success: true,
          filename: "brief.txt",
        }),
      },
    };

    const result = await handleCoworkerDeleteDocument({
      client: client as never,
      reference: "cw-1",
      documentId: "doc-1",
    });

    expect(client.coworker.deleteDocument).toHaveBeenCalledWith({ id: "doc-1" });
    expect(result).toEqual({
      status: "completed",
      coworkerId: "cw-1",
      success: true,
      filename: "brief.txt",
    });
  });

  it("returns coworker logs", async () => {
    const client = {
      coworker: {
        getRun: vi.fn().mockResolvedValue({ id: "run-1", status: "completed", events: [] }),
      },
    };

    const result = await handleCoworkerLogs(client as never, "run-1");
    expect(result.run).toMatchObject({ id: "run-1" });
  });

  it("lists workspace coworker runs with filters", async () => {
    const client = {
      coworker: {
        listWorkspaceRuns: vi.fn().mockResolvedValue({
          runs: [{ id: "run-1", status: "error", errorMessage: "boom" }],
          nextCursor: "cursor-2",
        }),
      },
    };

    const result = await handleCoworkerRuns({
      client: client as never,
      status: "error",
      coworkerId: "cw-1",
      limit: 25,
      cursor: "cursor-1",
    });

    expect(client.coworker.listWorkspaceRuns).toHaveBeenCalledWith({
      status: "error",
      coworkerId: "cw-1",
      limit: 25,
      cursor: "cursor-1",
    });
    expect(result).toMatchObject({
      status: "completed",
      runs: [{ id: "run-1", status: "error" }],
      nextCursor: "cursor-2",
    });
  });

  it("adds a user skill from folder files", async () => {
    const client = {
      skill: {
        import: vi.fn().mockResolvedValue({
          id: "skill-1",
          name: "weekly-report",
          displayName: "weekly-report",
          description: "Build a weekly report",
          enabled: false,
        }),
      },
    };

    const files = [
      {
        path: "SKILL.md",
        mimeType: "text/markdown",
        contentBase64: Buffer.from(`---
name: weekly-report
description: Build a weekly report
---

# Weekly Report
`).toString("base64"),
      },
      {
        path: "references/checklist.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("ship it").toString("base64"),
      },
    ];

    const result = await handleSkillAdd({
      client: client as never,
      files,
    });

    expect(client.skill.import).toHaveBeenCalledWith({
      mode: "folder",
      files,
    });
    expect(result).toMatchObject({
      status: "completed",
      skill: { id: "skill-1", name: "weekly-report", enabled: false },
    });
  });
});
