import { describe, expect, it } from "vitest";
import {
  canManageAutomationRegistration,
  isActiveAutomationRegistration,
  pausedRegistrationStatus,
} from "./coworker-automation-registration-policy";

describe("Coworker Automation Registration policy", () => {
  it("allows only the member to register or resume themselves", () => {
    for (const action of ["register", "resume"] as const) {
      expect(
        canManageAutomationRegistration({
          action,
          actorUserId: "member-1",
          registrationUserId: "member-1",
          workspaceRole: "member",
          isActiveWorkspaceMember: true,
        }),
      ).toBe(true);
      expect(
        canManageAutomationRegistration({
          action,
          actorUserId: "admin-1",
          registrationUserId: "member-1",
          workspaceRole: "admin",
          isActiveWorkspaceMember: true,
        }),
      ).toBe(false);
    }
  });

  it("allows administrators to pause or remove but not inactive outsiders", () => {
    expect(
      canManageAutomationRegistration({
        action: "pause",
        actorUserId: "admin-1",
        registrationUserId: "member-1",
        workspaceRole: "admin",
        isActiveWorkspaceMember: true,
      }),
    ).toBe(true);
    expect(
      canManageAutomationRegistration({
        action: "remove",
        actorUserId: "admin-1",
        registrationUserId: "member-1",
        workspaceRole: "admin",
        isActiveWorkspaceMember: false,
      }),
    ).toBe(false);
  });

  it("distinguishes member and administrator pauses and active registrations", () => {
    expect(
      pausedRegistrationStatus({ actorUserId: "member-1", registrationUserId: "member-1" }),
    ).toBe("member_paused");
    expect(
      pausedRegistrationStatus({ actorUserId: "admin-1", registrationUserId: "member-1" }),
    ).toBe("admin_paused");
    expect(isActiveAutomationRegistration("active")).toBe(true);
    expect(isActiveAutomationRegistration("safety_blocked")).toBe(false);
  });
});
