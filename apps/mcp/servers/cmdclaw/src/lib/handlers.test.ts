import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import {
  handleChatRun,
  handleCoworkerCreate,
  handleCoworkerGet,
  handleCoworkerList,
  handleCoworkerLogs,
  handleCoworkerRun,
  handleCoworkerRuns,
  handleCoworkerUploadDocument,
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
      promptDo: "Be concise.",
      promptDont: "Do not send messages.",
      autoApprove: false,
      authSource: "shared",
      integrations: ["gmail", "slack"],
    });

    expect(client.coworker.create).toHaveBeenCalledWith({
      name: "Daily",
      triggerType: "manual",
      prompt: "Summarize unread customer email.",
      promptDo: "Be concise.",
      promptDont: "Do not send messages.",
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
      promptDo: undefined,
      promptDont: undefined,
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
      promptDo: undefined,
      promptDont: undefined,
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
});
