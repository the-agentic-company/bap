import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { sandboxFileFindFirstMock, downloadFromS3Mock } = vi.hoisted(() => ({
  sandboxFileFindFirstMock: vi.fn<VitestProcedure>(),
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      sandboxFile: {
        findFirst: sandboxFileFindFirstMock,
      },
    },
  },
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

import { buildSandboxFileDownloadUrl, downloadSandboxFile } from "./download";

describe("sandbox file download API", () => {
  beforeEach(() => {
    sandboxFileFindFirstMock.mockReset();
    downloadFromS3Mock.mockReset();
    process.env.APP_URL = "https://app.example.com";
    process.env.APP_SERVER_SECRET = "test-download-secret";
  });

  it("streams a valid signed sandbox file download through the app", async () => {
    sandboxFileFindFirstMock.mockResolvedValue({
      filename: "hello.txt",
      mimeType: "text/plain",
      storageKey: "sandbox-files/conv-1/hello.txt",
    });
    const bytes = Buffer.from("hello");
    downloadFromS3Mock.mockResolvedValue(bytes);

    const response = await downloadSandboxFile(
      new Request(buildSandboxFileDownloadUrl("file-1")),
      "file-1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"hello.txt\"; filename*=UTF-8''hello.txt",
    );
    expect(response.headers.get("Content-Length")).toBe(bytes.byteLength.toString());
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("hello");
    expect(downloadFromS3Mock).toHaveBeenCalledWith("sandbox-files/conv-1/hello.txt");
  });

  it("rejects tampered download tokens", async () => {
    const url = new URL(buildSandboxFileDownloadUrl("file-1"));
    url.searchParams.set("token", "tampered");

    const response = await downloadSandboxFile(new Request(url), "file-1");

    expect(response.status).toBe(401);
    expect(sandboxFileFindFirstMock).not.toHaveBeenCalled();
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects expired download tokens", async () => {
    const url = new URL(buildSandboxFileDownloadUrl("file-1"));
    url.searchParams.set("expiresAt", "1");

    const response = await downloadSandboxFile(new Request(url), "file-1");

    expect(response.status).toBe(401);
    expect(sandboxFileFindFirstMock).not.toHaveBeenCalled();
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });
});
