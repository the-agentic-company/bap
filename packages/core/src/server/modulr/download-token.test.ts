import { describe, expect, it } from "vitest";
import {
  signModulrDocumentDownloadToken,
  verifyModulrDocumentDownloadToken,
} from "./download-token";

const secret = "test-secret";
const future = 2_000_000_000;

describe("Modulr document download tokens", () => {
  it("verifies a token scoped to the claimed workspace", () => {
    const token = signModulrDocumentDownloadToken(
      {
        storageKey: "modulr-documents/workspace-1/42/file.pdf",
        filename: "file.pdf",
        mimeType: "application/pdf",
        workspaceId: "workspace-1",
        documentId: "42",
        sizeBytes: 123,
        exp: future,
      },
      secret,
    );

    expect(verifyModulrDocumentDownloadToken(token, secret, future - 1)).toMatchObject({
      storageKey: "modulr-documents/workspace-1/42/file.pdf",
      workspaceId: "workspace-1",
      documentId: "42",
    });
  });

  it("rejects a signed token whose storage key is outside the claimed workspace", () => {
    const token = signModulrDocumentDownloadToken(
      {
        storageKey: "modulr-documents/workspace-2/42/file.pdf",
        filename: "file.pdf",
        mimeType: "application/pdf",
        workspaceId: "workspace-1",
        documentId: "42",
        sizeBytes: 123,
        exp: future,
      },
      secret,
    );

    expect(() => verifyModulrDocumentDownloadToken(token, secret, future - 1)).toThrow(
      /storage key does not match workspace/i,
    );
  });
});
