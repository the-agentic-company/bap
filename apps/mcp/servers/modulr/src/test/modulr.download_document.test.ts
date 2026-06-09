import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyModulrDocumentDownloadToken } from "@cmdclaw/core/server/modulr/download-token";

const mocks = vi.hoisted(() => ({
  env: {
    APP_URL: "https://cmdclaw.ai",
    NEXT_PUBLIC_APP_URL: undefined,
    E2B_CALLBACK_BASE_URL: undefined,
    CMDCLAW_MCP_BASE_URL: "https://cmdclaw-mcp-prod.onrender.com",
    CMDCLAW_SERVER_SECRET: "test-server-secret",
    NODE_ENV: "production",
  },
  ensureBucketMock: vi.fn(),
  uploadToS3Mock: vi.fn(),
  getManagedModulrClaimsMock: vi.fn(),
  createManagedModulrClientMock: vi.fn(),
}));

vi.mock("@cmdclaw/core/env", () => ({
  env: mocks.env,
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  ensureBucket: mocks.ensureBucketMock,
  uploadToS3: mocks.uploadToS3Mock,
}));

vi.mock("../lib/modulr-auth", () => ({
  getManagedModulrClaims: mocks.getManagedModulrClaimsMock,
  createManagedModulrClient: mocks.createManagedModulrClientMock,
}));

import downloadDocument from "../tools/modulr.download_document";

describe("modulr.download_document", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mocks.ensureBucketMock.mockReset();
    mocks.uploadToS3Mock.mockReset();
    mocks.getManagedModulrClaimsMock.mockReset();
    mocks.createManagedModulrClientMock.mockReset();
    mocks.getManagedModulrClaimsMock.mockReturnValue({
      userId: "user-1",
      workspaceId: "workspace-1",
      audience: "modulr",
    });
    mocks.createManagedModulrClientMock.mockResolvedValue({
      getDocument: vi.fn().mockResolvedValue({
        id: "42",
        title: "Policy",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        resourceUri: "modulr://documents/42",
        blob: Buffer.from("pdf-bytes").toString("base64"),
      }),
    });
  });

  it("returns a web-app download URL and keeps the storage key inside the signed token", async () => {
    const result = await downloadDocument({ documentId: "42" });
    const structured = result.structuredContent;

    expect(structured.downloadUrl).toMatch(
      /^https:\/\/cmdclaw\.ai\/api\/modulr\/documents\/download\?token=/,
    );
    expect(structured.downloadUrl).not.toContain("cmdclaw-mcp-prod");
    expect(structured).not.toHaveProperty("storageKey");

    const token = new URL(structured.downloadUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    const claims = verifyModulrDocumentDownloadToken(token!, "test-server-secret");
    expect(claims).toMatchObject({
      storageKey: "modulr-documents/workspace-1/42/1767225600000-policy.pdf",
      filename: "policy.pdf",
      mimeType: "application/pdf",
      workspaceId: "workspace-1",
      documentId: "42",
      sizeBytes: 9,
    });

    expect(mocks.uploadToS3Mock).toHaveBeenCalledWith(
      "modulr-documents/workspace-1/42/1767225600000-policy.pdf",
      Buffer.from("pdf-bytes"),
      "application/pdf",
    );
  });
});
