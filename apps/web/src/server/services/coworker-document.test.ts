import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  createFileAssetFromBufferMock,
  downloadFromS3Mock,
  readRuntimeVolumeFileMock,
  writeRuntimeVolumeFileMock,
  deleteRuntimeVolumeFileMock,
  validateFileUploadMock,
} = vi.hoisted(() => ({
  createFileAssetFromBufferMock: vi.fn<VitestProcedure>(),
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
  readRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  writeRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  deleteRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  validateFileUploadMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/services/file-asset-service", () => ({
  createFileAssetFromBuffer: createFileAssetFromBufferMock,
}));

vi.mock("@bap/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

vi.mock("@bap/core/server/services/runtime-volume-service", () => ({
  buildCoworkerDocumentsRuntimeVolumePrefix: ({
    workspaceId,
    coworkerId,
  }: {
    workspaceId: string;
    coworkerId: string;
  }) => `runtime-volumes/${workspaceId}/coworkers/${coworkerId}/documents/`,
  buildRuntimeVolumeObjectKey: (prefix: string, relativePath: string) => `${prefix}${relativePath}`,
  deleteRuntimeVolumeFile: deleteRuntimeVolumeFileMock,
  readRuntimeVolumeFile: readRuntimeVolumeFileMock,
  writeRuntimeVolumeFile: writeRuntimeVolumeFileMock,
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
    fileAssetId: null,
    description: "Old description",
  });
  database.query.coworker.findFirst.mockResolvedValue({ id: "cw-1", workspaceId: "ws-1" });
  updateReturningMock.mockResolvedValue([
    {
      id: "doc-1",
      fileAssetId: null,
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
      storageKey: "runtime-volumes/ws-1/coworkers/cw-1/documents/brief-v2.pdf",
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
    createFileAssetFromBufferMock.mockImplementation(
      async ({
        filename,
        mimeType,
        content,
      }: {
        filename: string;
        mimeType: string;
        content: Buffer;
      }) => ({
        id: "asset-new",
        filename,
        mimeType,
        sizeBytes: content.length,
        storageKey: "file-assets/ws-1/server/asset-new",
      }),
    );
    downloadFromS3Mock.mockResolvedValue(Buffer.from("updated"));
    readRuntimeVolumeFileMock.mockResolvedValue(Buffer.from("old"));
    writeRuntimeVolumeFileMock.mockResolvedValue(undefined);
    deleteRuntimeVolumeFileMock.mockResolvedValue(undefined);
    validateFileUploadMock.mockReturnValue(undefined);
  });

  it("renames document projection and Runtime Volume file without replacing bytes", async () => {
    const { database, mocks } = createDatabase();
    mocks.updateReturningMock.mockResolvedValue([
      {
        id: "doc-1",
        filename: "brief-renamed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: "runtime-volumes/ws-1/coworkers/cw-1/documents/brief-renamed.pdf",
        fileAssetId: null,
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
      fileAssetId: null,
      storageKey: "runtime-volumes/ws-1/coworkers/cw-1/documents/brief-renamed.pdf",
      description: null,
    });
    expect(createFileAssetFromBufferMock).not.toHaveBeenCalled();
    expect(readRuntimeVolumeFileMock).toHaveBeenCalledWith({
      storagePrefix: "runtime-volumes/ws-1/coworkers/cw-1/documents/",
      relativePath: "brief.pdf",
    });
    expect(writeRuntimeVolumeFileMock).toHaveBeenCalledWith({
      storagePrefix: "runtime-volumes/ws-1/coworkers/cw-1/documents/",
      relativePath: "brief-renamed.pdf",
      body: Buffer.from("old"),
      contentType: "application/pdf",
    });
    expect(result).toEqual({
      id: "doc-1",
      fileAssetId: null,
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
    expect(createFileAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "ws-1",
        filename: "brief-v2.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("updated"),
      }),
    );
    expect(mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAssetId: null,
        mimeType: "application/pdf",
        sizeBytes: 7,
        description: null,
        storageKey: "runtime-volumes/ws-1/coworkers/cw-1/documents/brief-v2.pdf",
      }),
    );
    expect(writeRuntimeVolumeFileMock).toHaveBeenCalledWith({
      storagePrefix: "runtime-volumes/ws-1/coworkers/cw-1/documents/",
      relativePath: "brief-v2.pdf",
      body: Buffer.from("updated"),
      contentType: "application/pdf",
    });
    expect(deleteRuntimeVolumeFileMock).toHaveBeenCalledWith({
      storagePrefix: "runtime-volumes/ws-1/coworkers/cw-1/documents/",
      relativePath: "brief.pdf",
    });
    expect(result).toEqual({
      id: "doc-1",
      fileAssetId: null,
      filename: "brief-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
      description: null,
    });
  });

  it("keeps existing storage when the database update fails", async () => {
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

    expect(deleteRuntimeVolumeFileMock).not.toHaveBeenCalled();
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
