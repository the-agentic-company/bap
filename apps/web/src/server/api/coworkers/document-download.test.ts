import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  getSessionMock,
  coworkerDocumentFindFirstMock,
  coworkerFindFirstMock,
  getFileAssetDownloadUrlMock,
  getPresignedDownloadUrlMock,
  requireActiveWorkspaceAccessMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn<VitestProcedure>(),
  coworkerDocumentFindFirstMock: vi.fn<VitestProcedure>(),
  coworkerFindFirstMock: vi.fn<VitestProcedure>(),
  getFileAssetDownloadUrlMock: vi.fn<VitestProcedure>(),
  getPresignedDownloadUrlMock: vi.fn<VitestProcedure>(),
  requireActiveWorkspaceAccessMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      coworkerDocument: {
        findFirst: coworkerDocumentFindFirstMock,
      },
      coworker: {
        findFirst: coworkerFindFirstMock,
      },
    },
  },
}));

vi.mock("@bap/core/server/storage/s3-client", () => ({
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
}));

vi.mock("@bap/core/server/services/file-asset-service", () => ({
  getFileAssetDownloadUrl: getFileAssetDownloadUrlMock,
}));

vi.mock("@/server/orpc/workspace-access", () => ({
  requireActiveWorkspaceAccess: requireActiveWorkspaceAccessMock,
}));

import { downloadCoworkerDocument } from "./document-download";

describe("downloadCoworkerDocument (GET /api/coworkers/documents/:id/download)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    coworkerDocumentFindFirstMock.mockReset();
    coworkerFindFirstMock.mockReset();
    getFileAssetDownloadUrlMock.mockReset();
    getPresignedDownloadUrlMock.mockReset();
    requireActiveWorkspaceAccessMock.mockReset();
    getFileAssetDownloadUrlMock.mockResolvedValue({
      url: "https://objects.example.com/file-asset",
      filename: "file-asset.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });
    getPresignedDownloadUrlMock.mockResolvedValue("https://objects.example.com/legacy-document");
  });

  it("redirects an owned legacy coworker document to a presigned download URL", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    requireActiveWorkspaceAccessMock.mockResolvedValue({ workspace: { id: "workspace-1" } });
    coworkerDocumentFindFirstMock.mockResolvedValue({
      coworkerId: "cw-1",
      filename: "need-more-info.png",
      mimeType: "image/png",
      storageKey: "coworkers/user-1/cw-1/documents/need-more-info.png",
      fileAssetId: null,
    });
    coworkerFindFirstMock.mockResolvedValue({ id: "cw-1" });

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/doc-1/download"),
      "doc-1",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://objects.example.com/legacy-document");
    expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith(
      "coworkers/user-1/cw-1/documents/need-more-info.png",
      300,
      {
        filename: "need-more-info.png",
        contentType: "image/png",
      },
    );
    expect(getFileAssetDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("passes non-ascii legacy filenames to the presigner", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    requireActiveWorkspaceAccessMock.mockResolvedValue({ workspace: { id: "workspace-1" } });
    coworkerDocumentFindFirstMock.mockResolvedValue({
      coworkerId: "cw-1",
      filename: "rapport-été.pdf",
      mimeType: "application/pdf",
      storageKey: "coworkers/user-1/cw-1/documents/rapport-ete.pdf",
      fileAssetId: null,
    });
    coworkerFindFirstMock.mockResolvedValue({ id: "cw-1" });

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/doc-1/download"),
      "doc-1",
    );

    expect(response.status).toBe(302);
    expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith(
      "coworkers/user-1/cw-1/documents/rapport-ete.pdf",
      300,
      {
        filename: "rapport-été.pdf",
        contentType: "application/pdf",
      },
    );
  });

  it("redirects File Asset coworker documents through the File Asset download URL", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    requireActiveWorkspaceAccessMock.mockResolvedValue({ workspace: { id: "workspace-1" } });
    coworkerDocumentFindFirstMock.mockResolvedValue({
      coworkerId: "cw-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      storageKey: "file-assets/workspace-1/server/asset-1",
      fileAssetId: "asset-1",
    });
    coworkerFindFirstMock.mockResolvedValue({ id: "cw-1" });

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/doc-1/download"),
      "doc-1",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://objects.example.com/file-asset");
    expect(getFileAssetDownloadUrlMock).toHaveBeenCalledWith({
      database: expect.anything(),
      workspaceId: "workspace-1",
      fileAssetId: "asset-1",
    });
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/doc-1/download"),
      "doc-1",
    );

    expect(response.status).toBe(401);
    expect(getFileAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("does not download documents for coworkers outside the active workspace", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    requireActiveWorkspaceAccessMock.mockResolvedValue({ workspace: { id: "workspace-1" } });
    coworkerDocumentFindFirstMock.mockResolvedValue({
      coworkerId: "cw-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      storageKey: "coworkers/user-1/cw-1/documents/brief.pdf",
      fileAssetId: null,
    });
    coworkerFindFirstMock.mockResolvedValue(null);

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/doc-1/download"),
      "doc-1",
    );

    expect(response.status).toBe(404);
    expect(getFileAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the document does not exist", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    coworkerDocumentFindFirstMock.mockResolvedValue(undefined);

    const response = await downloadCoworkerDocument(
      new Request("https://heybap.com/api/coworkers/documents/missing/download"),
      "missing",
    );

    expect(response.status).toBe(404);
    expect(requireActiveWorkspaceAccessMock).not.toHaveBeenCalled();
    expect(getFileAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });
});
