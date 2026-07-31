import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { dbMock, downloadFromS3Mock, getPresignedDownloadUrlMock } = vi.hoisted(() => ({
  dbMock: {
    query: {
      coworker: {
        findFirst: vi.fn<VitestProcedure>(),
      },
      coworkerRun: {
        findMany: vi.fn<VitestProcedure>(),
      },
      generation: {
        findFirst: vi.fn<VitestProcedure>(),
      },
      conversation: {
        findFirst: vi.fn<VitestProcedure>(),
      },
    },
  },
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
  getPresignedDownloadUrlMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/db/client", () => ({
  db: dbMock,
}));

vi.mock("@bap/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
}));

import { getPublicCoworkerPage } from "./public-coworker-page";

const STARTED_AT = new Date("2026-06-26T10:00:00.000Z");
const FINISHED_AT = new Date("2026-06-26T10:01:00.000Z");
const SHARED_AT = new Date("2026-06-26T10:02:00.000Z");

describe("getPublicCoworkerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPresignedDownloadUrlMock.mockImplementation(
      async (storageKey: string) => `https://files.example/${storageKey}`,
    );
    downloadFromS3Mock.mockResolvedValue(Buffer.from(""));
  });

  it("returns public coworker data for a shared slug without raw run errors", async () => {
    dbMock.query.coworker.findFirst.mockResolvedValue({
      id: "coworker-1",
      name: "Shared Coworker",
      description: "Shared description",
      username: "shared-coworker",
      publishedAt: SHARED_AT,
    });
    dbMock.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "completed",
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        errorMessage: "private runtime error",
        conversationId: "conversation-1",
        generationId: null,
      },
    ]);
    dbMock.query.conversation.findFirst.mockResolvedValue({
      id: "conversation-1",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Shared answer",
          contentParts: null,
          timing: null,
          createdAt: FINISHED_AT,
          attachments: [
            {
              filename: "brief.pdf",
              mimeType: "application/pdf",
              storageKey: "attachments/brief.pdf",
            },
          ],
          sandboxFiles: [],
        },
      ],
    });

    const page = await getPublicCoworkerPage({ slug: "shared-coworker" });

    expect(page?.coworker).toMatchObject({
      id: "coworker-1",
      username: "shared-coworker",
      sharedAt: SHARED_AT.toISOString(),
    });
    expect(page?.runs).toEqual([]);
    expect(page?.selectedRun).toBeNull();
    expect(page?.messages).toEqual([]);
    expect(JSON.parse(page!.definitionJson)).toMatchObject({
      coworker: {
        status: "off",
        authSource: null,
        allowedWorkspaceMcpServerIds: [],
      },
      documents: [],
      artifacts: [],
    });
    expect(dbMock.query.coworkerRun.findMany).not.toHaveBeenCalled();
  });

  it("returns null for invalid or unshared slugs", async () => {
    dbMock.query.coworker.findFirst.mockResolvedValue(null);

    await expect(getPublicCoworkerPage({ slug: "private-coworker" })).resolves.toBeNull();
    expect(dbMock.query.coworkerRun.findMany).not.toHaveBeenCalled();
  });

  it("returns null for malformed percent-encoded slugs", async () => {
    await expect(getPublicCoworkerPage({ slug: "%" })).resolves.toBeNull();
    await expect(getPublicCoworkerPage({ slug: "%gg" })).resolves.toBeNull();

    expect(dbMock.query.coworker.findFirst).not.toHaveBeenCalled();
  });

  it("does not expose live source Workspace output through publication", async () => {
    dbMock.query.coworker.findFirst.mockResolvedValue({
      id: "coworker-1",
      name: "Shared Coworker",
      description: "Shared description",
      username: "shared-coworker",
      publishedAt: SHARED_AT,
    });
    dbMock.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "completed",
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        conversationId: "conversation-1",
        generationId: null,
      },
    ]);
    dbMock.query.conversation.findFirst.mockResolvedValue({
      id: "conversation-1",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Shared answer",
          contentParts: null,
          timing: null,
          createdAt: FINISHED_AT,
          attachments: [],
          sandboxFiles: [
            {
              id: "file-1",
              path: "/app/output.html",
              filename: "output.html",
              mimeType: "text/html",
              sizeBytes: 17,
              storageKey: "sandbox/output.html",
            },
          ],
        },
      ],
    });
    downloadFromS3Mock.mockResolvedValue(Buffer.from("<h1>Shared</h1>"));

    const page = await getPublicCoworkerPage({ slug: "shared-coworker" });

    expect(page?.outputFile).toBeNull();
    expect(page?.outputHtml).toBeNull();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });
});
