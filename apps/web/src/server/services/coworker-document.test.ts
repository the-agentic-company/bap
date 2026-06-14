import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { ensureBucketMock, uploadToS3Mock, deleteFromS3Mock, validateFileUploadMock } = vi.hoisted(
  () => ({
    ensureBucketMock: vi.fn<VitestProcedure>(),
    uploadToS3Mock: vi.fn<VitestProcedure>(),
    deleteFromS3Mock: vi.fn<VitestProcedure>(),
    validateFileUploadMock: vi.fn<VitestProcedure>(),
  }),
);

vi.mock("@bap/core/server/storage/s3-client", () => ({
  ensureBucket: ensureBucketMock,
  uploadToS3: uploadToS3Mock,
  deleteFromS3: deleteFromS3Mock,
}));

vi.mock("@/server/storage/validation", () => ({
  validateFileUpload: validateFileUploadMock,
}));

import { updateCoworkerDocument } from "./coworker-document";

function createDatabase() {
  const updateReturningMock = vi.fn<VitestProcedure>();
  const updateWhereMock = vi.fn<VitestProcedure>(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn<VitestProcedure>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<VitestProcedure>(() => ({ set: updateSetMock }));

  const database = {
    query: {
      coworkerDocument: {
        findFirst: vi.fn<VitestProcedure>(),
      },
      coworker: {
        findFirst: vi.fn<VitestProcedure>(),
      },
    },
    update: updateMock,
  };

  database.query.coworkerDocument.findFirst.mockResolvedValue({
    id: "doc-1",
    coworkerId: "cw-1",
    filename: "brief.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    storageKey: "coworkers/user-1/cw-1/documents/old-brief.pdf",
    description: "Old description",
  });
  database.query.coworker.findFirst.mockResolvedValue({ id: "cw-1" });
  updateReturningMock.mockResolvedValue([
    {
      id: "doc-1",
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
      storageKey: "coworkers/user-1/cw-1/documents/new-brief.pdf",
      description: null,
    },
  ]);

  return {
    database,
    mocks: {
      updateSetMock,
      updateReturningMock,
    },
  };
}

describe("coworker document service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBucketMock.mockResolvedValue(undefined);
    uploadToS3Mock.mockResolvedValue(undefined);
    deleteFromS3Mock.mockResolvedValue(undefined);
    validateFileUploadMock.mockReturnValue(undefined);
  });

  it("updates document metadata without touching storage", async () => {
    const { database, mocks } = createDatabase();
    mocks.updateReturningMock.mockResolvedValue([
      {
        id: "doc-1",
        filename: "brief-renamed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: "coworkers/user-1/cw-1/documents/old-brief.pdf",
        description: null,
      },
    ]);

    const result = await updateCoworkerDocument({
      database: database as never,
      userId: "user-1",
      documentId: "doc-1",
      filename: "brief-renamed.pdf",
      description: null,
    });

    expect(mocks.updateSetMock).toHaveBeenCalledWith({
      filename: "brief-renamed.pdf",
      description: null,
    });
    expect(uploadToS3Mock).not.toHaveBeenCalled();
    expect(deleteFromS3Mock).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "doc-1",
      filename: "brief-renamed.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      description: null,
    });
  });

  it("replaces file bytes while preserving the document id", async () => {
    const { database, mocks } = createDatabase();

    const result = await updateCoworkerDocument({
      database: database as never,
      userId: "user-1",
      documentId: "doc-1",
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("updated").toString("base64"),
      description: null,
    });

    expect(validateFileUploadMock).toHaveBeenCalledWith("brief-v2.pdf", "application/pdf", 7, 0);
    expect(ensureBucketMock).toHaveBeenCalled();
    expect(uploadToS3Mock).toHaveBeenCalledWith(
      expect.stringContaining("coworkers/user-1/cw-1/documents/"),
      Buffer.from("updated"),
      "application/pdf",
    );
    expect(mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "brief-v2.pdf",
        mimeType: "application/pdf",
        sizeBytes: 7,
        description: null,
        storageKey: expect.stringContaining("brief-v2.pdf"),
      }),
    );
    expect(deleteFromS3Mock).toHaveBeenCalledWith("coworkers/user-1/cw-1/documents/old-brief.pdf");
    expect(result).toEqual({
      id: "doc-1",
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
      description: null,
    });
  });

  it("cleans up newly uploaded storage when the database update fails", async () => {
    const { database, mocks } = createDatabase();
    mocks.updateReturningMock.mockRejectedValue(new Error("database down"));

    await expect(
      updateCoworkerDocument({
        database: database as never,
        userId: "user-1",
        documentId: "doc-1",
        filename: "brief-v2.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("updated").toString("base64"),
      }),
    ).rejects.toThrow("database down");

    expect(deleteFromS3Mock).toHaveBeenCalledWith(expect.stringContaining("brief-v2.pdf"));
    expect(deleteFromS3Mock).not.toHaveBeenCalledWith(
      "coworkers/user-1/cw-1/documents/old-brief.pdf",
    );
  });

  it("rejects an empty document update", async () => {
    const { database } = createDatabase();

    await expect(
      updateCoworkerDocument({
        database: database as never,
        userId: "user-1",
        documentId: "doc-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Document update must include a change",
    });
  });

  it("rejects mimeType changes without file content", async () => {
    const { database } = createDatabase();

    await expect(
      updateCoworkerDocument({
        database: database as never,
        userId: "user-1",
        documentId: "doc-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "File replacement requires filename, mimeType, and content",
    });
  });
});
