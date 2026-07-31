import { describe, expect, it } from "vitest";
import { isAutomationRegistrationMigrationCandidate } from "./coworker-automation-registration-backfill";

describe("Coworker Automation Registration backfill", () => {
  const valid = {
    triggerType: "schedule",
    workspaceId: "workspace-1",
    automationOwnerUserId: "user-1",
    automationOwnerConsentedAt: new Date("2026-07-31T09:00:00Z"),
    hasActiveMembership: true,
  };

  it("migrates only active consenting owners of scheduled Coworkers", () => {
    expect(isAutomationRegistrationMigrationCandidate(valid)).toBe(true);
    expect(
      isAutomationRegistrationMigrationCandidate({ ...valid, triggerType: "email.forwarded" }),
    ).toBe(false);
    expect(
      isAutomationRegistrationMigrationCandidate({ ...valid, hasActiveMembership: false }),
    ).toBe(false);
    expect(
      isAutomationRegistrationMigrationCandidate({
        ...valid,
        automationOwnerConsentedAt: null,
      }),
    ).toBe(false);
  });
});
