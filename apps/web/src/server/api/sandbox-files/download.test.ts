import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { sandboxFileFindFirstMock, getPresignedDownloadUrlMock, getFileAssetDownloadUrlMock } =
  vi.hoisted(() => ({
    sandboxFileFindFirstMock: vi.fn<VitestProcedure>(),
    getPresignedDownloadUrlMock: vi.fn<VitestProcedure>(),
    getFileAssetDownloadUrlMock: vi.fn<VitestProcedure>(),
  }));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      sandboxFile: {
        findFirst: sandboxFileFindFirstMock,
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

import { buildSandboxFileDownloadUrl, downloadSandboxFile } from "./download";

describe("sandbox file download API", () => {
  beforeEach(() => {
    sandboxFileFindFirstMock.mockReset();
    getPresignedDownloadUrlMock.mockReset();
    getFileAssetDownloadUrlMock.mockReset();
    getPresignedDownloadUrlMock.mockResolvedValue("https://objects.example.com/hello.txt");
    process.env.APP_URL = "https://app.example.com";
    process.env.APP_SERVER_SECRET = "test-download-secret";
  });

  it("redirects a valid signed sandbox file download to object storage", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      filename: "hello.txt",
      mimeType: "text/plain",
      storageKey: "sandbox-files/conv-1/hello.txt",
      fileAssetId: null,
      conversation: { workspaceId: "ws-1" },
    });

    const response = await downloadSandboxFile(
      new Request(buildSandboxFileDownloadUrl("file-1")),
      "file-1",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://objects.example.com/hello.txt");
    expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith(
      "sandbox-files/conv-1/hello.txt",
      300,
      {
        filename: "hello.txt",
        contentType: "text/plain",
      },
    );
  });

  it("rejects tampered download tokens", async () => {
    const url = new URL(buildSandboxFileDownloadUrl("file-1"));
    url.searchParams.set("token", "tampered");

    const response = await downloadSandboxFile(new Request(url), "file-1");

    expect(response.status).toBe(401);
    expect(sandboxFileFindFirstMock).not.toHaveBeenCalled();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("rejects expired download tokens", async () => {
    const url = new URL(buildSandboxFileDownloadUrl("file-1"));
    url.searchParams.set("expiresAt", "1");

    const response = await downloadSandboxFile(new Request(url), "file-1");

    expect(response.status).toBe(401);
    expect(sandboxFileFindFirstMock).not.toHaveBeenCalled();
    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
  });
});
