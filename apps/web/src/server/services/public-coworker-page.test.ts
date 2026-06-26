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
      sharedAt: SHARED_AT,
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
    expect(page?.runs[0]).toEqual({
      id: "run-1",
      status: "completed",
      startedAt: STARTED_AT.toISOString(),
      finishedAt: FINISHED_AT.toISOString(),
      conversationId: "conversation-1",
    });
    expect(page?.selectedRun).not.toHaveProperty("errorMessage");
    expect(page?.messages[0]?.attachments?.[0]).toEqual({
      filename: "brief.pdf",
      mimeType: "application/pdf",
      previewUrl: "https://files.example/attachments/brief.pdf",
    });
  });

  it("returns null for invalid or unshared slugs", async () => {
    dbMock.query.coworker.findFirst.mockResolvedValue(null);

    await expect(getPublicCoworkerPage({ slug: "private-coworker" })).resolves.toBeNull();
    expect(dbMock.query.coworkerRun.findMany).not.toHaveBeenCalled();
  });
});
