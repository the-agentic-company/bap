import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@bap/core/lib/email-forwarding";
import { describe, expect, it } from "vitest";
import { usesAutomationOwner } from "./coworker-automation-trigger";

describe("usesAutomationOwner", () => {
  it.each([
    ["manual", false],
    [EMAIL_FORWARDED_TRIGGER_TYPE, false],
    ["schedule", true],
    ["gmail.new_email", true],
  ])("returns %s => %s", (triggerType, expected) => {
    expect(usesAutomationOwner(triggerType)).toBe(expected);
  });
});
