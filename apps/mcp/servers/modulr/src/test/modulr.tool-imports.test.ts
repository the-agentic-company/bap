import { describe, expect, it, vi } from "vitest";

describe("Modulr tool imports", () => {
  it("does not load web app env while registering the download tool", async () => {
    vi.resetModules();
    vi.doMock("@cmdclaw/core/env", () => {
      throw new Error("download tool imported core env eagerly");
    });

    const tool = await import("../tools/modulr.download_document");

    expect(tool.metadata.name).toBe("modulr.download_document");
    vi.doUnmock("@cmdclaw/core/env");
  });

  it("does not load pdf parsing while registering the read-text tool", async () => {
    vi.resetModules();
    vi.doMock("pdf-parse", () => {
      throw new Error("read-text tool imported pdf-parse eagerly");
    });

    const tool = await import("../tools/modulr.read_document_text");

    expect(tool.metadata.name).toBe("modulr.read_document_text");
    vi.doUnmock("pdf-parse");
  });
});
