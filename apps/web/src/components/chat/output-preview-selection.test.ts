import { describe, expect, it } from "vitest";
import type { Message } from "./message-list";
import { findLatestOutputHtmlFile } from "./output-preview-selection";

function assistantMessage(id: string, filenames: string[]): Message {
  return {
    id,
    role: "assistant",
    content: "Done",
    sandboxFiles: filenames.map((filename, index) => ({
      fileId: `${id}-file-${index}`,
      path: `/app/${filename}`,
      filename,
      mimeType: filename === "output.html" ? "text/html" : "application/octet-stream",
      sizeBytes: 10,
    })),
  };
}

describe("findLatestOutputHtmlFile", () => {
  it("returns null when no sandbox file is named exactly output.html", () => {
    expect(
      findLatestOutputHtmlFile([
        assistantMessage("msg-1", ["my-output.html"]),
        assistantMessage("msg-2", ["output.htm", "output.HTML"]),
      ]),
    ).toBeNull();
  });

  it("selects the newest output.html across messages", () => {
    const first = assistantMessage("msg-1", ["output.html"]);
    const second = assistantMessage("msg-2", ["report.pdf", "output.html"]);

    expect(findLatestOutputHtmlFile([first, second])).toEqual(second.sandboxFiles?.[1]);
  });

  it("selects the latest output.html within the latest matching message", () => {
    const message = assistantMessage("msg-1", ["output.html", "report.pdf", "output.html"]);

    expect(findLatestOutputHtmlFile([message])).toEqual(message.sandboxFiles?.[2]);
  });
});
