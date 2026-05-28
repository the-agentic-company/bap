import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signModulrDocumentDownloadToken } from "@cmdclaw/core/server/modulr/download-token";

const { downloadFromS3Mock } = vi.hoisted(() => ({
  downloadFromS3Mock: vi.fn(),
}));

vi.mock("@cmdclaw/core/env", () => ({
  env: {
    CMDCLAW_SERVER_SECRET: "test-server-secret",
  },
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
}));

import { GET } from "./route";

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

describe("GET /api/modulr/documents/download", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    downloadFromS3Mock.mockReset();
  });

  it("streams a Modulr document through the web app from a valid token", async () => {
    downloadFromS3Mock.mockResolvedValue(Buffer.from("pdf-bytes"));
    const token = signToken();

    const response = await GET(
      new NextRequest(`https://cmdclaw.ai/api/modulr/documents/download?token=${token}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"policy.pdf\"; filename*=UTF-8''policy.pdf",
    );
    expect(response.headers.get("Content-Length")).toBe("9");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("pdf-bytes");
    expect(downloadFromS3Mock).toHaveBeenCalledWith("modulr-documents/workspace-1/42/policy.pdf");
  });

  it("rejects requests without a token", async () => {
    const response = await GET(new NextRequest("https://cmdclaw.ai/api/modulr/documents/download"));

    expect(response.status).toBe(400);
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });

  it("rejects signed tokens scoped to another workspace storage prefix", async () => {
    const token = signToken({
      storageKey: "modulr-documents/workspace-2/42/policy.pdf",
    });

    const response = await GET(
      new NextRequest(`https://cmdclaw.ai/api/modulr/documents/download?token=${token}`),
    );

    expect(response.status).toBe(401);
    expect(downloadFromS3Mock).not.toHaveBeenCalled();
  });
});
