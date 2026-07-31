import { describe, expect, it } from "vitest";
import { resolveBackfillCoworkerVisibility } from "./canonical-coworker-backfill";

const folders = [
  { id: "workspace-root", parentId: null, visibility: "workspace" as const },
  {
    id: "workspace-child",
    parentId: "workspace-root",
    visibility: "private" as const,
  },
  { id: "private-root", parentId: null, visibility: "private" as const },
];

describe("resolveBackfillCoworkerVisibility", () => {
  it("preserves legacy top-level shares as canonical Workspace Coworkers", () => {
    expect(
      resolveBackfillCoworkerVisibility({
        explicitVisibility: "private",
        sharedAt: new Date(),
        folderId: null,
        folders,
      }),
    ).toBe("workspace");
  });

  it("inherits visibility from the top-level folder", () => {
    expect(
      resolveBackfillCoworkerVisibility({
        explicitVisibility: "private",
        sharedAt: null,
        folderId: "workspace-child",
        folders,
      }),
    ).toBe("workspace");
  });

  it("does not infer a relationship between independent private copies", () => {
    expect(
      resolveBackfillCoworkerVisibility({
        explicitVisibility: "private",
        sharedAt: null,
        folderId: "private-root",
        folders,
      }),
    ).toBe("private");
  });
});
