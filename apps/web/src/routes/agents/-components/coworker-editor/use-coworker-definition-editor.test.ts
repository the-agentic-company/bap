import { describe, expect, it } from "vitest";
import { getCoworkerConflict } from "./use-coworker-definition-editor";

describe("getCoworkerConflict", () => {
  it("extracts the current values and attributed actors from a structured conflict", () => {
    expect(
      getCoworkerConflict({
        data: {
          currentRevision: 8,
          conflictingFields: ["prompt"],
          currentValues: { prompt: "Latest shared instructions" },
          latestActors: {
            prompt: { userId: "user-2", name: "Ada" },
          },
        },
      }),
    ).toEqual({
      currentRevision: 8,
      conflictingFields: ["prompt"],
      currentValues: { prompt: "Latest shared instructions" },
      latestActors: {
        prompt: { userId: "user-2", name: "Ada" },
      },
    });
  });

  it("ignores errors that do not contain a complete conflict", () => {
    expect(getCoworkerConflict(new Error("network failed"))).toBeNull();
    expect(
      getCoworkerConflict({
        data: {
          conflictingFields: ["prompt"],
        },
      }),
    ).toBeNull();
  });
});
