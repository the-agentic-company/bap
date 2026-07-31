import { describe, expect, it } from "vitest";
import { isCoworkerRunForUser, selectDefaultCoworkerRunId } from "./coworker-info-run-selection";

const runs = [
  {
    id: "run-other-newest",
    executionUserId: "user-2",
    initiatedByUserId: "user-2",
    runner: { id: "user-2" },
  },
  {
    id: "run-mine",
    executionUserId: "user-1",
    initiatedByUserId: "user-1",
    runner: { id: "user-1" },
  },
];

describe("Coworker info run selection", () => {
  it("opens the current user's newest run by default", () => {
    expect(selectDefaultCoworkerRunId(runs, null, "user-1")).toBe("run-mine");
  });

  it("keeps an explicitly selected workspace run", () => {
    expect(selectDefaultCoworkerRunId(runs, "run-other-newest", "user-1")).toBe("run-other-newest");
  });

  it("shows the first-run state when the current user has no runs", () => {
    expect(selectDefaultCoworkerRunId(runs, null, "user-3")).toBeUndefined();
  });

  it("recognizes legacy runs from their initiator or runner attribution", () => {
    expect(isCoworkerRunForUser({ id: "legacy", initiatedByUserId: "user-1" }, "user-1")).toBe(
      true,
    );
    expect(isCoworkerRunForUser({ id: "legacy", runner: { id: "user-1" } }, "user-1")).toBe(true);
  });
});
