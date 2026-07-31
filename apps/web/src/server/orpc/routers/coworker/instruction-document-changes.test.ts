import { describe, expect, it } from "vitest";
import { summarizeCoworkerInstructionDocumentChanges } from "./instruction-document-changes";

describe("summarizeCoworkerInstructionDocumentChanges", () => {
  it("returns the latest add or remove action for each filename", () => {
    expect(
      summarizeCoworkerInstructionDocumentChanges([
        { type: "document_added", payload: { filename: "brief.pdf" } },
        { type: "document_added", payload: { filename: "data.csv" } },
        { type: "document_removed", payload: { filename: "brief.pdf" } },
      ]),
    ).toEqual([
      { type: "removed", filename: "brief.pdf" },
      { type: "added", filename: "data.csv" },
    ]);
  });

  it("ignores unrelated events and malformed filenames", () => {
    expect(
      summarizeCoworkerInstructionDocumentChanges([
        { type: "run_started", payload: { filename: "run.txt" } },
        { type: "document_added", payload: {} },
        { type: "document_removed", payload: { filename: "" } },
      ]),
    ).toEqual([]);
  });
});
