import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  coworkerRouterAny,
  createContext,
  deleteCoworkerDocumentMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  getPresignedDownloadUrlMock,
  resetCoworkerRouterTestHarness,
  syncCoworkerScheduleJobMock,
  updateCoworkerDocumentMock,
  uploadCoworkerDocumentMock,
} from "./coworker.test-harness";

describe("coworkerRouter", () => {
  beforeEach(resetCoworkerRouterTestHarness);
  it("backfills missing builder metadata on get when prompt already exists", async () => {
    const context = createContext();
    const now = new Date("2026-03-12T10:00:00.000Z");
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      description: "Summarizes the workflow.",
      username: "summary-sentence",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-builder-1",
      name: "Builder Draft",
      description: null,
      username: null,
      status: "on",
      autoApprove: true,
      toolAccessMode: "all",
      allowedSkillSlugs: [],
      triggerType: "manual",
      prompt: "Summary sentence. another sentence",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
    });
    context.mocks.updateReturningMock.mockResolvedValueOnce([
      {
        id: "wf-1",
        ownerId: "user-1",
        builderConversationId: "conv-builder-1",
        name: "Builder Draft",
        description: "Summarizes the workflow.",
        username: "summary-sentence",
        status: "on",
        autoApprove: true,
        toolAccessMode: "all",
        allowedSkillSlugs: [],
        triggerType: "manual",
        prompt: "Summary sentence. another sentence",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    context.db.query.coworkerRun.findMany.mockResolvedValue([]);

    const result = await coworkerRouterAny.get({
      input: { id: "wf-1" },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
  });

  it("returns NOT_FOUND when getting a missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.get({
        input: { id: "wf-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uploads a document for a coworker", async () => {
    const context = createContext();

    const result = await coworkerRouterAny.uploadDocument({
      input: {
        coworkerId: "wf-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("test").toString("base64"),
        description: "Reference brief",
      },
      context,
    });

    expect(uploadCoworkerDocumentMock).toHaveBeenCalledWith({
      database: context.db,
      userId: "user-1",
      coworkerId: "wf-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("test").toString("base64"),
      description: "Reference brief",
    });
    expect(result).toEqual({
      id: "doc-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    });
  });

  it("deletes a document for a coworker", async () => {
    const context = createContext();

    const result = await coworkerRouterAny.deleteDocument({
      input: { id: "doc-1" },
      context,
    });

    expect(deleteCoworkerDocumentMock).toHaveBeenCalledWith({
      database: context.db,
      userId: "user-1",
      documentId: "doc-1",
    });
    expect(result).toEqual({
      success: true,
      filename: "brief.pdf",
    });
  });

  it("updates a document for a coworker", async () => {
    const context = createContext();

    const result = await coworkerRouterAny.updateDocument({
      input: {
        id: "doc-1",
        filename: "brief-v2.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("updated").toString("base64"),
        description: null,
      },
      context,
    });

    expect(updateCoworkerDocumentMock).toHaveBeenCalledWith({
      database: context.db,
      userId: "user-1",
      documentId: "doc-1",
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("updated").toString("base64"),
      description: null,
    });
    expect(result).toEqual({
      id: "doc-1",
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      description: null,
    });
  });

  it("returns an app download URL for a coworker document", async () => {
    const context = createContext();
    context.db.query.coworkerDocument.findFirst.mockResolvedValue({
      coworkerId: "wf-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      storageKey: "coworkers/user-1/wf-1/documents/brief.pdf",
    });

    const result = await coworkerRouterAny.getDocumentUrl({
      input: { id: "doc-1" },
      context,
    });

    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: "/api/coworkers/documents/doc-1/download",
      filename: "brief.pdf",
      mimeType: "application/pdf",
    });
  });

  it("uses provided coworker name without generation", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-2",
        name: "Explicit Name",
        description: null,
        username: null,
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = await coworkerRouterAny.create({
      input: {
        name: "  Explicit Name  ",
        triggerType: "manual",
        prompt: "Prompt text",
        model: DEFAULT_MODEL,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-2",
      name: "Explicit Name",
      description: null,
      username: null,
      status: "on",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Explicit Name" }),
    );
    expect(generateCoworkerMetadataOnFirstPromptFillMock).not.toHaveBeenCalled();
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("creates a coworker with blank metadata when no explicit values are provided", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-3",
        name: "",
        description: null,
        username: null,
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = (await coworkerRouterAny.create({
      input: {
        triggerType: "manual",
        prompt: "First sentence for fallback. second sentence",
        model: DEFAULT_MODEL,
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    })) as {
      name: string;
      description: string | null;
      username: string | null;
    };

    expect(result).toEqual({
      id: "wf-3",
      name: "",
      description: null,
      username: null,
      status: "on",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "", description: null, username: null }),
    );
  });

  it("rejects admin-only Claude model on create for non-admin users", async () => {
    const context = createContext();

    await expect(
      coworkerRouterAny.create({
        input: {
          triggerType: "manual",
          prompt: "Prompt text",
          model: "anthropic/claude-sonnet-4-6",
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  });

  it("normalizes and persists explicit username and description on create", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-4",
        name: "Coworker",
        description: "Handles follow-ups",
        username: "team-helper",
        status: "on",
        triggerType: "manual",
      },
    ]);

    await coworkerRouterAny.create({
      input: {
        name: "Coworker",
        description: "  Handles follow-ups  ",
        username: " Team Helper ",
        triggerType: "manual",
        prompt: "... \n!",
        model: DEFAULT_MODEL,
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Coworker",
        description: "Handles follow-ups",
        username: "team-helper",
      }),
    );
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during create", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        name: "",
        description: null,
        username: null,
        status: "on",
        triggerType: "schedule",
      },
    ]);
    syncCoworkerScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      coworkerRouterAny.create({
        input: {
          triggerType: "schedule",
          prompt: "Daily task",
          model: DEFAULT_MODEL,
          autoApprove: true,
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
          schedule: {
            type: "daily",
            time: "09:30",
            timezone: "UTC",
          },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("updates a coworker on happy path", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Old Name",
      status: "on",
      triggerType: "manual",
      prompt: "Old prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "off",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        name: "Renamed Coworker",
        status: "off",
      },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("requires reset before ordinary enable for a backlog-disabled coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "off",
      disabledReason: "run_backlog_limit",
      disabledAt: new Date("2026-06-17T21:22:40.000Z"),
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          status: "on",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Reset coworker runs before enabling automated triggers.",
    });

    expect(context.mocks.updateSetMock).not.toHaveBeenCalled();
  });

  it("requires reset before ordinary enable when backlog runs are already at the cap", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "off",
      disabledReason: null,
      disabledAt: null,
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.db.query.coworkerRun.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({ id: `run-${index + 1}` })),
    );

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          status: "on",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Reset coworker runs before enabling automated triggers.",
    });

    expect(context.mocks.updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects changing a coworker to the Gmail trigger", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          triggerType: "gmail.new_email",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Coworker trigger type is disabled: gmail.new_email",
    });

    expect(context.mocks.updateSetMock).not.toHaveBeenCalled();
  });

  it("preserves existing legacy Gmail trigger when editing other fields", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "gmail.new_email",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "gmail.new_email",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        name: "Renamed Coworker",
        triggerType: "gmail.new_email",
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed Coworker",
        triggerType: "gmail.new_email",
      }),
    );
  });

  it("returns NOT_FOUND when updating a missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-missing",
          name: "Name",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects admin-only Claude model on update for non-admin users", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      model: DEFAULT_MODEL,
      authSource: "shared",
    });

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          model: "anthropic/claude-sonnet-4-6",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during update", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "schedule",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "schedule",
        schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      },
    ]);
    syncCoworkerScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("resolves workspace MCP server ids when selected toolbox integrations change", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: ["stale-source"],
      schedule: null,
      requiresUserInput: false,
      userInputPrompt: null,
    });
    context.db.query.workspaceMcpServer.findMany.mockResolvedValue([
      {
        id: "linear-source-1",
        namespace: "linear",
        createdAt: new Date("2026-03-03T12:00:00.000Z"),
      },
    ]);
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        toolAccessMode: "selected",
        allowedIntegrations: ["linear"],
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.db.query.workspaceMcpServer.findMany).toHaveBeenCalled();
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["linear"],
        allowedWorkspaceMcpServerIds: ["linear-source-1"],
      }),
    );
  });

  it("returns NOT_FOUND when update returning payload is empty", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([]);

    await expect(
      coworkerRouterAny.update({
        input: { id: "wf-1", name: "Renamed" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not sync scheduler when update changes only non-schedule fields", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: { id: "wf-1", name: "Renamed" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });
});
