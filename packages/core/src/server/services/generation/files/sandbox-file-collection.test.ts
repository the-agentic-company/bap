import { describe, expect, it } from "vitest";
import { selectAutoCollectedFilesForExposure } from "./sandbox-file-collection";

describe("selectAutoCollectedFilesForExposure", () => {
  it("keeps files mentioned in the final answer", () => {
    const mentioned = {
      path: "/app/report.pdf",
      content: Buffer.from("pdf"),
    };

    expect(
      selectAutoCollectedFilesForExposure({
        files: [mentioned, { path: "/app/hidden.json", content: Buffer.from("{}") }],
        finalAnswerText: "Download report.pdf when ready.",
      }),
    ).toEqual([mentioned]);
  });

  it("adds exact output.html even when the final answer does not mention it", () => {
    const outputHtml = {
      path: "/app/output.html",
      content: Buffer.from("<!doctype html>"),
    };

    expect(
      selectAutoCollectedFilesForExposure({
        files: [
          { path: "/app/report.json", content: Buffer.from("{}") },
          outputHtml,
          { path: "/app/output.HTML", content: Buffer.from("wrong-case") },
        ],
        finalAnswerText: "Done.",
      }),
    ).toEqual([outputHtml]);
  });

  it("prefers /app/output.html when multiple exact output.html files exist", () => {
    const root = {
      path: "/app/output.html",
      content: Buffer.from("root"),
    };

    expect(
      selectAutoCollectedFilesForExposure({
        files: [
          { path: "/app/dist/output.html", content: Buffer.from("dist") },
          root,
        ],
        finalAnswerText: "Done.",
      }),
    ).toEqual([root]);
  });

  it("uses deterministic path ordering when no root output.html exists", () => {
    const chosen = {
      path: "/app/a/output.html",
      content: Buffer.from("a"),
    };

    expect(
      selectAutoCollectedFilesForExposure({
        files: [
          { path: "/app/z/output.html", content: Buffer.from("z") },
          chosen,
        ],
        finalAnswerText: "Done.",
      }),
    ).toEqual([chosen]);
  });
});
