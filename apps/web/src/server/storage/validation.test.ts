import { describe, expect, it } from "vitest";
import { MAX_DOCUMENTS_PER_COWORKER, validateFileUpload } from "./validation";

describe("validateFileUpload", () => {
  it("allows HTML documents as text files", () => {
    expect(() => validateFileUpload("output.html", "text/html", 1024, 0)).not.toThrow();
  });

  it("allows HTML documents with MIME parameters", () => {
    expect(() =>
      validateFileUpload("output.html", "text/html; charset=utf-8", 1024, 0),
    ).not.toThrow();
  });

  it("rejects unsupported MIME types", () => {
    expect(() => validateFileUpload("data.json", "application/json", 1024, 0)).toThrow(
      /not allowed/,
    );
  });

  it("supports a separate Coworker document limit", () => {
    expect(() =>
      validateFileUpload("report.pdf", "application/pdf", 1024, 16, {
        maxDocumentCount: MAX_DOCUMENTS_PER_COWORKER,
        documentCollectionLabel: "Coworker",
      }),
    ).not.toThrow();

    expect(() =>
      validateFileUpload("report.pdf", "application/pdf", 1024, MAX_DOCUMENTS_PER_COWORKER, {
        maxDocumentCount: MAX_DOCUMENTS_PER_COWORKER,
        documentCollectionLabel: "Coworker",
      }),
    ).toThrow(/Maximum of 20 documents per Coworker/);
  });
});
