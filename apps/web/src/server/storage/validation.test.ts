import { describe, expect, it } from "vitest";
import { validateFileUpload } from "./validation";

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
});
