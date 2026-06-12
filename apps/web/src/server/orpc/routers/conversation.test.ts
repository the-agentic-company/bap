import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

function createProcedureStub() {
  const stub = {
    input: vi.fn<VitestProcedure>(),
    output: vi.fn<VitestProcedure>(),
    handler: vi.fn<VitestProcedure>((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  conversationFindFirstMock,
  conversationFindManyMock,
  sandboxFileFindFirstMock,
  userFindFirstMock,
  downloadFromS3Mock,
  dbMock,
} = vi.hoisted(() => {
  const conversationFindFirstMock = vi.fn<VitestProcedure>();
  const conversationFindManyMock = vi.fn<VitestProcedure>();
  const sandboxFileFindFirstMock = vi.fn<VitestProcedure>();
  const userFindFirstMock = vi.fn<VitestProcedure>();
  const downloadFromS3Mock = vi.fn<VitestProcedure>();

  const dbMock = {
    query: {
      conversation: {
        findFirst: conversationFindFirstMock,
        findMany: conversationFindManyMock,
      },
      sandboxFile: {
        findFirst: sandboxFileFindFirstMock,
      },
      user: {
        findFirst: userFindFirstMock,
      },
    },
  };

  return {
    conversationFindFirstMock,
    conversationFindManyMock,
    sandboxFileFindFirstMock,
    userFindFirstMock,
    downloadFromS3Mock,
    dbMock,
  };
});

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@cmdclaw/core/server/services/memory-service", () => ({
  writeSessionTranscriptFromConversation: vi.fn<VitestProcedure>(),
}));

vi.mock("@cmdclaw/core/server/services/opencode-session-snapshot-service", () => ({
  clearConversationSessionSnapshot: vi.fn<VitestProcedure>(),
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: vi.fn<VitestProcedure>(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "member" },
  })),
  requireActiveWorkspaceAdmin: vi.fn<VitestProcedure>(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "admin" },
  })),
}));

import { conversationRouter } from "./conversation";

const context = {
  user: { id: "user-1" },
  session: { impersonatedBy: null },
  db: dbMock,
};

const conversationRouterAny = conversationRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

describe("conversationRouter.getUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindFirstMock.mockResolvedValue({ role: "member" });
  });

  it("throws not found when the conversation does not belong to the user", async () => {
    conversationFindFirstMock.mockResolvedValue(null);

    await expect(
      conversationRouterAny.getUsage({
        input: { id: "conv-missing" },
        context,
      }),
    ).rejects.toMatchObject(new ORPCError("NOT_FOUND", { message: "Conversation not found" }));
  });

  it("returns stored usage from the conversation row", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      type: "chat",
      inputTokens: 11,
      outputTokens: 13,
      totalTokens: 24,
      assistantMessageCount: 2,
      usageInputTokens: 11,
      usageOutputTokens: 13,
      usageTotalTokens: 24,
      usageAssistantMessageCount: 2,
    });

    const result = await conversationRouterAny.getUsage({
      input: { id: "conv-1" },
      context,
    });

    expect(result).toEqual({
      inputTokens: 11,
      outputTokens: 13,
      totalTokens: 24,
      assistantMessageCount: 2,
    });
  });

  it("returns zero usage when no assistant usage has been stored yet", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      type: "chat",
      usageInputTokens: 0,
      usageOutputTokens: 0,
      usageTotalTokens: 0,
      usageAssistantMessageCount: 0,
    });

    await expect(
      conversationRouterAny.getUsage({
        input: { id: "conv-1" },
        context,
      }),
    ).resolves.toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      assistantMessageCount: 0,
    });
  });

  it("returns stored usage for coworker conversations used by runs", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-run-1",
      type: "coworker",
      usageInputTokens: 17,
      usageOutputTokens: 5,
      usageTotalTokens: 22,
      usageAssistantMessageCount: 1,
    });

    await expect(
      conversationRouterAny.getUsage({
        input: { id: "conv-run-1" },
        context,
      }),
    ).resolves.toEqual({
      inputTokens: 17,
      outputTokens: 5,
      totalTokens: 22,
      assistantMessageCount: 1,
    });
  });

  it("returns minimal impersonation target metadata for app admins", async () => {
    userFindFirstMock.mockResolvedValue({ role: "admin" });
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-2",
      title: "Pipeline review",
      userId: "user-2",
      user: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
    });

    const result = await conversationRouterAny.getImpersonationTarget({
      input: { conversationId: "conv-2" },
      context,
    });

    expect(result).toEqual({
      resourceType: "chat",
      resourceId: "conv-2",
      resourceLabel: "Pipeline review",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
    });
  });
});

describe("conversationRouter.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an encoded cursor when another page exists", async () => {
    conversationFindManyMock.mockResolvedValue([
      {
        id: "conv-new",
        title: "New",
        isPinned: true,
        isShared: false,
        generationStatus: "idle",
        createdAt: new Date("2026-04-10T10:00:00.000Z"),
        updatedAt: new Date("2026-04-10T10:00:00.000Z"),
        seenMessageCount: 1,
        messages: [{ id: "m-1" }],
      },
      {
        id: "conv-old",
        title: "Old",
        isPinned: false,
        isShared: false,
        generationStatus: "complete",
        createdAt: new Date("2026-04-09T09:00:00.000Z"),
        updatedAt: new Date("2026-04-09T09:00:00.000Z"),
        seenMessageCount: 2,
        messages: [{ id: "m-2" }, { id: "m-3" }],
      },
      {
        id: "conv-extra",
        title: "Extra",
        isPinned: false,
        isShared: false,
        generationStatus: "complete",
        createdAt: new Date("2026-04-08T08:00:00.000Z"),
        updatedAt: new Date("2026-04-08T08:00:00.000Z"),
        seenMessageCount: 0,
        messages: [],
      },
    ]);

    const result = (await conversationRouterAny.list({
      input: { limit: 2 },
      context,
    })) as {
      conversations: Array<{ id: string; messageCount: number }>;
      nextCursor?: string;
    };

    expect(result.conversations).toEqual([
      expect.objectContaining({ id: "conv-new", messageCount: 1 }),
      expect.objectContaining({ id: "conv-old", messageCount: 2 }),
    ]);
    expect(result.nextCursor).toBe(
      JSON.stringify({
        updatedAt: "2026-04-09T09:00:00.000Z",
        id: "conv-old",
        isPinned: false,
      }),
    );
  });

  it("rejects an invalid cursor", async () => {
    await expect(
      conversationRouterAny.list({
        input: { limit: 20, cursor: "not-json" },
        context,
      }),
    ).rejects.toMatchObject(
      new ORPCError("BAD_REQUEST", { message: "Invalid conversation list cursor" }),
    );
    expect(conversationFindManyMock).not.toHaveBeenCalled();
  });
});

describe("conversationRouter.getAgenticAppHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadFromS3Mock.mockResolvedValue(Buffer.from("<!doctype html><p>Preview</p>"));
  });

  it("returns preview HTML for an owned output.html sandbox file", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-1",
      filename: "output.html",
      mimeType: "text/html",
      storageKey: "sandbox-files/conv-1/output.html",
      sizeBytes: 29,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-1",
      },
    });

    const result = await conversationRouterAny.getAgenticAppHtml({
      input: { fileId: "file-1" },
      context,
    });

    expect(result).toEqual({
      html: "<!doctype html><p>Preview</p>",
      filename: "output.html",
      sizeBytes: 29,
    });
    expect(downloadFromS3Mock).toHaveBeenCalledWith("sandbox-files/conv-1/output.html");
  });

  it("rejects sandbox files outside the active workspace", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-2",
      filename: "output.html",
      mimeType: "text/html",
      storageKey: "sandbox-files/conv-2/output.html",
      sizeBytes: 29,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-2",
      },
    });

    await expect(
      conversationRouterAny.getAgenticAppHtml({
        input: { fileId: "file-2" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "File not found",
      data: { agenticAppCode: "not_found" },
    });
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects sandbox files not named exactly output.html", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-3",
      filename: "output.HTML",
      mimeType: "text/html",
      storageKey: "sandbox-files/conv-1/output.HTML",
      sizeBytes: 29,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-1",
      },
    });

    await expect(
      conversationRouterAny.getAgenticAppHtml({
        input: { fileId: "file-3" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "File is not an Agentic-App",
      data: { agenticAppCode: "invalid_filename" },
    });
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects output.html files over the size cap before downloading", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-4",
      filename: "output.html",
      mimeType: "text/html",
      storageKey: "sandbox-files/conv-1/output.html",
      sizeBytes: 2 * 1024 * 1024 + 1,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-1",
      },
    });

    await expect(
      conversationRouterAny.getAgenticAppHtml({
        input: { fileId: "file-4" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "File is too large to display",
      data: { agenticAppCode: "too_large" },
    });
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects output.html files that are not stored as HTML", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-5",
      filename: "output.html",
      mimeType: "application/json",
      storageKey: "sandbox-files/conv-1/output.html",
      sizeBytes: 29,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-1",
      },
    });

    await expect(
      conversationRouterAny.getAgenticAppHtml({
        input: { fileId: "file-5" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "File is not an Agentic-App HTML document",
      data: { agenticAppCode: "invalid_mime" },
    });
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });
});

describe("conversationRouter.downloadSandboxFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://app.example.com";
    process.env.APP_SERVER_SECRET = "test-download-secret";
  });

  it("returns an app-hosted signed download URL for an owned sandbox file", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      id: "file-1",
      filename: "hello.txt",
      mimeType: "text/plain",
      path: "/app/hello.txt",
      storageKey: "sandbox-files/conv-1/hello.txt",
      sizeBytes: 5,
      conversation: {
        userId: "user-1",
        workspaceId: "ws-1",
      },
    });

    const result = (await conversationRouterAny.downloadSandboxFile({
      input: { fileId: "file-1" },
      context,
    })) as {
      url: string;
      filename: string;
      mimeType: string;
      path: string;
      sizeBytes: number;
    };

    const url = new URL(result.url);
    expect(url.origin).toBe("https://app.example.com");
    expect(url.pathname).toBe("/api/sandbox-files/file-1/download");
    expect(url.searchParams.get("expiresAt")).toMatch(/^\d+$/);
    expect(url.searchParams.get("token")).toEqual(expect.any(String));
    expect(result).toEqual({
      url: result.url,
      filename: "hello.txt",
      mimeType: "text/plain",
      path: "/app/hello.txt",
      sizeBytes: 5,
    });
  });
});
