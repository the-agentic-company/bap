import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { signModulrDocumentDownloadToken } from "@cmdclaw/core/server/modulr/download-token";

const { downloadFromS3Mock } = vi.hoisted(() => ({
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
}));

vi.mock("@cmdclaw/core/env", () => ({
  env: {
    APP_SERVER_SECRET: "test-server-secret",
  },
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

import { downloadModulrDocument } from "./document-download";

const future = 2_000_000_000;

function signToken(overrides: Partial<Parameters<typeof signModulrDocumentDownloadToken>[0]> = {}) {
  return signModulrDocumentDownloadToken(
    {
      storageKey: "modulr-documents/workspace-1/42/policy.pdf",
      filename: "policy.pdf",
      mimeType: "application/pdf",
      workspaceId: "workspace-1",
      documentId: "42",
      sizeBytes: 9,
      exp: future,
      ...overrides,
    },
    "test-server-secret",
  );
}

describe("downloadModulrDocument (GET /api/modulr/documents/download)", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    downloadFromS3Mock.mockReset();
  });

  it("streams a Modulr document through the web app from a valid token", async () => {
    const bytes = Buffer.from("pdf-bytes");
    downloadFromS3Mock.mockResolvedValue(bytes);
    const token = signToken();

    const response = await downloadModulrDocument(
      new Request(`https://cmdclaw.ai/api/modulr/documents/download?token=${token}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"policy.pdf\"; filename*=UTF-8''policy.pdf",
    );
    expect(response.headers.get("Content-Length")).toBe("9");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // Preserve exact binary bytes.
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(downloadFromS3Mock).toHaveBeenCalledWith("modulr-documents/workspace-1/42/policy.pdf");
  });

  it("builds an RFC 6266 content-disposition for non-ascii filenames", async () => {
    downloadFromS3Mock.mockResolvedValue(Buffer.from("pdf"));
    const token = signToken({
      storageKey: "modulr-documents/workspace-1/42/rapport-ete.pdf",
      filename: "rapport-été.pdf",
    });

    const response = await downloadModulrDocument(
      new Request(`https://cmdclaw.ai/api/modulr/documents/download?token=${token}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"rapport-ete.pdf\"; filename*=UTF-8''rapport-%C3%A9t%C3%A9.pdf",
    );
  });

  it("rejects requests without a token", async () => {
    const response = await downloadModulrDocument(
      new Request("https://cmdclaw.ai/api/modulr/documents/download"),
    );

    expect(response.status).toBe(400);
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects invalid or tampered tokens", async () => {
    const response = await downloadModulrDocument(
      new Request("https://cmdclaw.ai/api/modulr/documents/download?token=not-a-valid-token"),
    );

    expect(response.status).toBe(401);
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects signed tokens scoped to another workspace storage prefix", async () => {
    const token = signToken({
      storageKey: "modulr-documents/workspace-2/42/policy.pdf",
    });

    const response = await downloadModulrDocument(
      new Request(`https://cmdclaw.ai/api/modulr/documents/download?token=${token}`),
    );

    expect(response.status).toBe(401);
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });
});
