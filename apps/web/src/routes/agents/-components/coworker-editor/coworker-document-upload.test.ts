import { describe, expect, it } from "vitest";
import {
  getCoworkerDocumentUploadLimitError,
  uploadCoworkerDocumentFiles,
} from "./coworker-document-upload";

describe("uploadCoworkerDocumentFiles", () => {
  it("attaches files sequentially so Runtime Volume reconciliations cannot race", async () => {
    const files = Array.from({ length: 17 }, (_, index) => ({
      name: `document-${index}.xlsx`,
    })) as File[];
    let inFlight = 0;
    let maxInFlight = 0;

    const uploadedFilenames = await uploadCoworkerDocumentFiles(files, async (file) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return file.name;
    });

    expect(uploadedFilenames).toEqual(files.map((file) => file.name));
    expect(new Set(uploadedFilenames)).toHaveLength(17);
    expect(maxInFlight).toBe(1);
  });

  it("explains the remaining capacity before starting an oversized batch", () => {
    expect(getCoworkerDocumentUploadLimitError(17, 4)).toBe(
      "You can add up to 20 documents. This Coworker already has 17, so you can upload 3 more.",
    );
    expect(getCoworkerDocumentUploadLimitError(17, 3)).toBeNull();
  });

  it("explains how to recover when the document limit is reached", () => {
    expect(getCoworkerDocumentUploadLimitError(20, 1)).toBe(
      "This Coworker already has 20 documents, the maximum allowed. Remove a document before uploading another.",
    );
  });
});
