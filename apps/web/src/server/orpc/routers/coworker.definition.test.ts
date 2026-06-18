import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  coworkerRouterAny,
  createContext,
  downloadFromS3Mock,
  ensureBucketMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  normalizeAndEnsureUniqueCoworkerUsernameMock,
  removeCoworkerScheduleJobMock,
  resetCoworkerRouterTestHarness,
  syncCoworkerScheduleJobMock,
  uploadCoworkerDocumentMock,
  uploadToS3Mock,
} from "./coworker.test-harness";

describe("coworkerRouter", () => {
  beforeEach(resetCoworkerRouterTestHarness);
  it("updates allowed integration fields when provided", async () => {
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

    await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      }),
    );
  });

  it("sets empty coworker name when updating with blank name and blank prompt", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "   ",
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

    await coworkerRouterAny.update({
      input: { id: "wf-1", name: "   " },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ name: "" }));
  });

  it("fills missing metadata on first prompt transition from blank to non-blank", async () => {
    const context = createContext();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      name: "Summary sentence",
      description: "Summarizes the workflow.",
      username: "summary-sentence",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "   ",
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

    await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        prompt: "Summary sentence. another sentence",
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Summary sentence. another sentence",
        name: "Summary sentence",
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
  });

  it("preserves explicit name on first prompt transition while filling other metadata", async () => {
    const context = createContext();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      description: "Summarizes the workflow.",
      username: "explicit-name",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "   ",
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

    await coworkerRouterAny.update({
      input: { id: "wf-1", name: "Explicit Name", prompt: "... \n!" },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Explicit Name",
        description: "Summarizes the workflow.",
        username: "explicit-name",
      }),
    );
  });

  it("does not generate metadata after the prompt was already non-empty", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Existing",
      description: "Existing description",
      username: "existing",
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
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

    await coworkerRouterAny.update({
      input: { id: "wf-1", prompt: "Updated prompt" },
      context,
    });

    expect(generateCoworkerMetadataOnFirstPromptFillMock).toHaveBeenCalled();
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        name: expect.any(String),
        description: expect.any(String),
        username: expect.any(String),
      }),
    );
  });

  it("normalizes manual username edits before persisting", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Existing",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
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

    await coworkerRouterAny.update({
      input: { id: "wf-1", username: " Team Helper " },
      context,
    });

    expect(normalizeAndEnsureUniqueCoworkerUsernameMock).toHaveBeenCalledWith({
      database: context.db,
      coworkerId: "wf-1",
      username: "Team Helper",
    });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: "team-helper" }),
    );
  });

  it("deletes a manual coworker without touching the scheduler", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
    const result = await coworkerRouterAny.delete({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(removeCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("removes a scheduled coworker job before deleting the coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Scheduled coworker",
      status: "on",
      triggerType: "schedule",
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);

    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
    const result = await coworkerRouterAny.delete({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(removeCoworkerScheduleJobMock).toHaveBeenCalledWith("wf-1");
  });

  it("returns NOT_FOUND when deleting a missing coworker", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([]);

    await expect(
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
      coworkerRouterAny.delete({
        input: { id: "wf-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates builder conversations with auto-approve disabled", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Coworker",
      builderConversationId: null,
    });
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "conv-builder-1" }]);

    const result = await coworkerRouterAny.getOrCreateBuilderConversation({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ conversationId: "conv-builder-1" });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "coworker",
        autoApprove: false,
      }),
    );
  });

  it("forces existing builder conversations to disable auto-approve", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Coworker",
      builderConversationId: "conv-builder-1",
    });
    context.db.query.conversation.findFirst.mockResolvedValue({
      id: "conv-builder-1",
      autoApprove: true,
      userId: "user-1",
      workspaceId: "ws-1",
      type: "coworker",
    });

    const result = await coworkerRouterAny.getOrCreateBuilderConversation({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ conversationId: "conv-builder-1" });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: false }),
    );
  });

  it("exports a coworker definition with embedded documents", async () => {
    const context = createContext();
    const createdAt = new Date("2026-03-04T12:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Inbox triage",
      description: "Sort and summarize inbound work.",
      username: "inbox-triage",
      status: "on",
      triggerType: "manual",
      prompt: "Do the work",
      model: DEFAULT_MODEL,
      authSource: "shared",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-1"],
      allowedSkillSlugs: ["skill-a"],
      schedule: null,
      builderConversationId: "conv-builder-1",
      sharedAt: null,
    });
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      conversationId: "conv-run-1",
    });
    context.db.query.coworkerDocument.findMany.mockResolvedValue([
      {
        id: "doc-1",
        coworkerId: "wf-1",
        filename: "brief.txt",
        mimeType: "text/plain",
        description: "Brief",
        storageKey: "s3/doc-1",
        createdAt,
      },
    ]);
    context.db.query.sandboxFile.findMany.mockResolvedValue([
      {
        id: "file-1",
        conversationId: "conv-builder-1",
        messageId: "msg-1",
        path: "/app/output.html",
        filename: "output.html",
        mimeType: "text/html",
        sizeBytes: 29,
        storageKey: "s3/output-html",
        createdAt,
      },
    ]);
    downloadFromS3Mock.mockImplementation(async (storageKey: string) => {
      if (storageKey === "s3/output-html") {
        return Buffer.from("<!doctype html><p>Preview</p>");
      }
      return Buffer.from("hello world");
    });

    const result = await coworkerRouterAny.exportDefinition({
      input: { id: "wf-1" },
      context,
    });

    expect(downloadFromS3Mock).toHaveBeenCalledWith("s3/doc-1");
    expect(downloadFromS3Mock).toHaveBeenCalledWith("s3/output-html");
    expect(result).toMatchObject({
      version: 2,
      coworker: {
        name: "Inbox triage",
        username: "inbox-triage",
        toolAccessMode: "selected",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: ["custom-1"],
        allowedSkillSlugs: ["skill-a"],
      },
      documents: [
        {
          filename: "brief.txt",
          mimeType: "text/plain",
          description: "Brief",
          contentBase64: Buffer.from("hello world").toString("base64"),
        },
      ],
      artifacts: [
        {
          path: "/app/output.html",
          filename: "output.html",
          mimeType: "text/html",
          sizeBytes: 29,
          contentBase64: Buffer.from("<!doctype html><p>Preview</p>").toString("base64"),
        },
      ],
    });
  });

  it("imports a coworker definition in the off state and uploads documents", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-imported",
        name: "Imported coworker",
        description: "Imported description",
        username: "imported-coworker",
        status: "off",
      },
    ]);

    const result = await coworkerRouterAny.importDefinition({
      input: {
        definitionJson: JSON.stringify({
          version: 1,
          exportedAt: "2026-03-26T10:00:00.000Z",
          coworker: {
            name: "Imported coworker",
            description: "Imported description",
            username: "imported-coworker",
            status: "on",
            triggerType: "schedule",
            prompt: "Run every day",
            model: DEFAULT_MODEL,
            authSource: "shared",
            autoApprove: true,
            toolAccessMode: "selected",
            allowedIntegrations: ["slack"],
            allowedCustomIntegrations: ["custom-1"],
            allowedWorkspaceMcpServerIds: [],
            allowedSkillSlugs: ["skill-a"],
            schedule: {
              type: "daily",
              time: "09:00",
              timezone: "UTC",
            },
          },
          documents: [
            {
              filename: "brief.txt",
              mimeType: "text/plain",
              description: "Brief",
              contentBase64: "aGVsbG8=",
            },
          ],
        }),
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-imported",
      name: "Imported coworker",
      description: "Imported description",
      username: "imported-coworker",
      status: "off",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Imported coworker",
        status: "off",
        triggerType: "schedule",
        toolAccessMode: "selected",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: ["custom-1"],
        allowedSkillSlugs: ["skill-a"],
      }),
    );
    expect(uploadCoworkerDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: expect.any(String),
        filename: "brief.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        description: "Brief",
      }),
    );
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("imports v2 artifacts as builder conversation sandbox files", async () => {
    const context = createContext();
    context.mocks.insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "wf-imported",
          name: "Imported coworker",
          description: "Imported description",
          username: "imported-coworker",
          status: "off",
        },
      ])
      .mockResolvedValueOnce([{ id: "conv-imported-builder" }]);

    const artifactContent = "<!doctype html><p>Imported preview</p>";
    const result = await coworkerRouterAny.importDefinition({
      input: {
        definitionJson: JSON.stringify({
          version: 2,
          exportedAt: "2026-03-26T10:00:00.000Z",
          coworker: {
            name: "Imported coworker",
            description: "Imported description",
            username: "imported-coworker",
            status: "on",
            triggerType: "manual",
            prompt: "Run on demand",
            model: DEFAULT_MODEL,
            authSource: "shared",
            autoApprove: true,
            toolAccessMode: "selected",
            allowedIntegrations: [],
            allowedCustomIntegrations: [],
            allowedWorkspaceMcpServerIds: [],
            allowedSkillSlugs: [],
            schedule: null,
          },
          documents: [],
          artifacts: [
            {
              path: "/app/output.html",
              filename: "output.html",
              mimeType: "text/html",
              sizeBytes: artifactContent.length,
              contentBase64: Buffer.from(artifactContent).toString("base64"),
            },
          ],
        }),
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-imported",
      name: "Imported coworker",
      description: "Imported description",
      username: "imported-coworker",
      status: "off",
    });
    expect(ensureBucketMock).toHaveBeenCalled();
    expect(uploadToS3Mock).toHaveBeenCalledWith(
      expect.stringMatching(/^sandbox-files\/conv-imported-builder\/\d+-output\.html$/),
      Buffer.from(artifactContent),
      "text/html",
    );
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "coworker",
        title: "Imported coworker – Chat",
        autoApprove: false,
      }),
    );
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      builderConversationId: "conv-imported-builder",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-imported-builder",
        path: "/app/output.html",
        filename: "output.html",
        mimeType: "text/html",
        sizeBytes: artifactContent.length,
        storageKey: expect.stringMatching(
          /^sandbox-files\/conv-imported-builder\/\d+-output\.html$/,
        ),
      }),
    );
  });

  it("imports shared coworker definitions through artifact restore rules", async () => {
    const context = createContext();
    const createdAt = new Date("2026-03-04T12:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-shared",
      ownerId: "other-user",
      workspaceId: "ws-1",
      name: "Shared coworker",
      description: "Shared description",
      username: "shared-coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Run on demand",
      model: DEFAULT_MODEL,
      authSource: "shared",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: ["source-workspace-mcp-id"],
      allowedSkillSlugs: [],
      schedule: null,
      requiresUserInput: false,
      userInputPrompt: null,
      sharedAt: new Date("2026-03-04T12:10:00.000Z"),
      builderConversationId: "conv-shared-builder",
      createdAt,
      updatedAt: createdAt,
    });
    context.db.query.coworkerDocument.findMany.mockResolvedValue([]);
    context.db.query.coworkerRun.findFirst.mockResolvedValue({ conversationId: null });
    context.db.query.sandboxFile.findMany.mockResolvedValue([
      {
        id: "file-1",
        conversationId: "conv-shared-builder",
        path: "/app/shared.html",
        filename: "shared.html",
        mimeType: "text/html",
        sizeBytes: 32,
        storageKey: "s3/shared-html",
        createdAt,
      },
    ]);
    context.db.query.workspaceMcpServer.findMany.mockResolvedValue([
      {
        id: "target-slack-source",
        namespace: "slack",
        createdAt,
      },
    ]);
    downloadFromS3Mock.mockResolvedValue(Buffer.from("<!doctype html><p>Shared</p>"));
    context.mocks.insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "wf-imported",
          name: "Shared coworker",
          description: "Shared description",
          username: "shared-coworker",
          status: "off",
        },
      ])
      .mockResolvedValueOnce([{ id: "conv-imported-builder" }]);

    const result = await coworkerRouterAny.importShared({
      input: { sourceCoworkerId: "wf-shared" },
      context,
    });

    expect(result).toEqual({
      id: "wf-imported",
      name: "Shared coworker",
      description: "Shared description",
      username: "shared-coworker",
      status: "off",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "off",
        allowedWorkspaceMcpServerIds: ["target-slack-source"],
      }),
    );
    expect(ensureBucketMock).toHaveBeenCalled();
    expect(uploadToS3Mock).toHaveBeenCalledWith(
      expect.stringMatching(/^sandbox-files\/conv-imported-builder\/\d+-shared\.html$/),
      Buffer.from("<!doctype html><p>Shared</p>"),
      "text/html",
    );
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-imported-builder",
        path: "/app/shared.html",
        filename: "shared.html",
      }),
    );
  });

  it("returns INTERNAL_SERVER_ERROR when scheduler cleanup fails during delete", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Scheduled coworker",
      status: "on",
      triggerType: "schedule",
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);
    removeCoworkerScheduleJobMock.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
      coworkerRouterAny.delete({
        input: { id: "wf-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
