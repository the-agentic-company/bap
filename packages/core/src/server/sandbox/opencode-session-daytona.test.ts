import { describe, expect, it } from "vitest";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";
import { getDaytonaSandboxLifecycleIntervals } from "./opencode-session-daytona";

describe("Daytona OpenCode session lifecycle", () => {
  it("aligns sandbox auto-stop with the Generation run deadline and deletes five minutes later", () => {
    const runDeadlineMinutes = Math.ceil(generationLifecyclePolicy.runDeadlineMs / 60_000);

    expect(getDaytonaSandboxLifecycleIntervals()).toEqual({
      autoStopInterval: runDeadlineMinutes,
      autoDeleteInterval: runDeadlineMinutes + 5,
    });
  });
});
