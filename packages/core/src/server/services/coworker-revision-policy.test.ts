import { describe, expect, it } from "vitest";
import {
  findCoworkerRevisionConflicts,
  listChangedCoworkerFields,
  mergeCoworkerConfigurationPatch,
} from "./coworker-revision-policy";

describe("coworker revision policy", () => {
  it("lists only fields whose values changed", () => {
    expect(
      listChangedCoworkerFields(
        { name: "Research", prompt: "Old", schedule: null },
        { name: "Research", prompt: "New", schedule: null },
      ),
    ).toEqual(["prompt"]);
  });

  it("detects stale same-field changes while allowing independent fields", () => {
    expect(
      findCoworkerRevisionConflicts({
        patchFields: ["prompt", "description"],
        interveningRevisions: [
          { changedFields: ["model"] },
          { changedFields: ["prompt", "allowedSkillSlugs"] },
        ],
      }),
    ).toEqual(["prompt"]);
  });

  it("merges a patch without mutating the current configuration", () => {
    const current = {
      name: "Research",
      prompt: "Current prompt",
      description: "Old description",
    };
    expect(
      mergeCoworkerConfigurationPatch(current, {
        description: "New description",
      }),
    ).toEqual({
      name: "Research",
      prompt: "Current prompt",
      description: "New description",
    });
    expect(current.description).toBe("Old description");
  });

  it("compares arrays and objects structurally", () => {
    expect(
      listChangedCoworkerFields(
        { allowedSkillSlugs: ["a"], schedule: { type: "daily", hour: 9 } },
        { allowedSkillSlugs: ["a"], schedule: { type: "daily", hour: 10 } },
      ),
    ).toEqual(["schedule"]);
  });
});
