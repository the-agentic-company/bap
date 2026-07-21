import { describe, expect, it } from "vitest";
import { getCoworkerBackHref } from "./coworker-routes";

describe("getCoworkerBackHref", () => {
  it("links back to the coworker's folder when a folderId exists", () => {
    expect(getCoworkerBackHref("folder-123")).toBe("/agents/folders/folder-123");
  });

  it("links back to the coworkers root when the coworker is not in a folder", () => {
    expect(getCoworkerBackHref(null)).toBe("/agents");
  });
});
