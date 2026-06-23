import { beforeEach, describe, expect, it, vi } from "vitest";
import { stageRuntimePromptAttachments } from "./prompt-attachments";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  assertReadyFileAssetsForWorkspaceMock,
  downloadFromS3Mock,
  writeCoworkerDocumentsToSandboxMock,
} = vi.hoisted(() => ({
  assertReadyFileAssetsForWorkspaceMock: vi.fn<VitestProcedure>(),
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
  writeCoworkerDocumentsToSandboxMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/db/client", () => ({
  db: {},
}));

vi.mock("../services/file-asset-service", () => ({
  assertReadyFileAssetsForWorkspace: assertReadyFileAssetsForWorkspaceMock,
}));

vi.mock("../storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

vi.mock("../sandbox/prep/coworker-documents-prep", () => ({
  writeCoworkerDocumentsToSandbox: writeCoworkerDocumentsToSandboxMock,
}));

describe("stageRuntimePromptAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeCoworkerDocumentsToSandboxMock.mockResolvedValue([]);
    assertReadyFileAssetsForWorkspaceMock.mockImplementation(
      async (input: { fileAssetIds: string[] }) => {
        const assetsById = new Map([
          [
            "asset-image",
            {
              id: "asset-image",
              filename: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
              storageKey: "file-assets/ws-1/uploads/image",
            },
          ],
          [
            "asset-notes",
            {
              id: "asset-notes",
              filename: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              storageKey: "file-assets/ws-1/uploads/notes",
            },
          ],
        ]);
        return input.fileAssetIds.map((fileAssetId) => {
          const asset = assetsById.get(fileAssetId);
          if (!asset) {
            throw new Error(`Unexpected file asset ${fileAssetId}`);
          }
          return asset;
        });
      },
    );
    downloadFromS3Mock.mockImplementation(async (storageKey: string) => {
      const buffersByStorageKey = new Map([
        ["file-assets/ws-1/uploads/image", Buffer.from("image")],
        ["file-assets/ws-1/uploads/notes", Buffer.from("notes")],
      ]);
      const buffer = buffersByStorageKey.get(storageKey);
      if (!buffer) {
        throw new Error(`Unexpected storage key ${storageKey}`);
      }
      return buffer;
    });
  });

  it("stages File Asset message attachments into the sandbox and prompts with their paths", async () => {
    const runtimeSandbox = {
      exec: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const userStagedFilePaths = new Set<string>();
    const runStep = vi.fn(async (_stepName: string, _metricName: string, fn: () => Promise<unknown>) =>
      await fn(),
    );

    const result = await stageRuntimePromptAttachments({
      runtimeSandbox,
      workspaceId: "ws-1",
      attachments: [
        {
          fileAssetId: "asset-image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
        {
          fileAssetId: "asset-notes",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
        },
      ],
      userStagedFilePaths,
      runStep,
    });

    expect(result).toMatchObject({
      stagedCoworkerDocumentCount: 0,
      stagedUploadCount: 2,
      stagedUploadFailureCount: 0,
    });
    expect(result.promptParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/home/user/uploads/image.png"),
        }),
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("/home/user/uploads/notes.txt"),
        }),
      ]),
    );
    expect(assertReadyFileAssetsForWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        fileAssetIds: ["asset-image"],
      }),
    );
    expect(assertReadyFileAssetsForWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        fileAssetIds: ["asset-notes"],
      }),
    );
    expect(downloadFromS3Mock).toHaveBeenCalledWith("file-assets/ws-1/uploads/image");
    expect(downloadFromS3Mock).toHaveBeenCalledWith("file-assets/ws-1/uploads/notes");
    expect(runtimeSandbox.writeFile).toHaveBeenCalledWith(
      "/home/user/uploads/image.png",
      expect.any(ArrayBuffer),
    );
    expect(runtimeSandbox.writeFile).toHaveBeenCalledWith(
      "/home/user/uploads/notes.txt",
      expect.any(ArrayBuffer),
    );
    expect(userStagedFilePaths).toEqual(
      new Set(["/home/user/uploads/image.png", "/home/user/uploads/notes.txt"]),
    );
  });
});
