import { describe, expect, it } from "vitest";
import { decideCoworkerAccess, type CoworkerAction } from "./coworker-access-policy";

const collaborativeActions = [
  "read",
  "edit",
  "run_manual",
  "read_run_metadata",
  "restore_revision",
  "organize",
] as const satisfies readonly CoworkerAction[];

describe("coworker access policy", () => {
  it.each(collaborativeActions)(
    "allows an active member to %s a workspace coworker",
    (action) => {
      expect(
        decideCoworkerAccess({
          action,
          actorUserId: "member-1",
          workspaceRole: "member",
          isActiveWorkspaceMember: true,
          visibility: "workspace",
          createdByUserId: "creator-1",
        }),
      ).toEqual({ allowed: true });
    },
  );

  it.each(collaborativeActions)("denies a non-member attempting to %s", (action) => {
    expect(
      decideCoworkerAccess({
        action,
        actorUserId: "outsider",
        workspaceRole: null,
        isActiveWorkspaceMember: false,
        visibility: "workspace",
        createdByUserId: "creator-1",
      }),
    ).toEqual({ allowed: false, reason: "workspace_membership_required" });
  });

  it("keeps private coworkers private from workspace admins", () => {
    expect(
      decideCoworkerAccess({
        action: "read",
        actorUserId: "admin-1",
        workspaceRole: "admin",
        isActiveWorkspaceMember: true,
        visibility: "private",
        createdByUserId: "creator-1",
      }),
    ).toEqual({ allowed: false, reason: "private_coworker" });
  });

  it("allows the creator to use a private coworker", () => {
    expect(
      decideCoworkerAccess({
        action: "edit",
        actorUserId: "creator-1",
        workspaceRole: "member",
        isActiveWorkspaceMember: true,
        visibility: "private",
        createdByUserId: "creator-1",
      }),
    ).toEqual({ allowed: true });
  });

  it.each(["change_visibility", "delete", "propose_automation_owner"] as const)(
    "limits %s to the creator or a workspace admin",
    (action) => {
      const base = {
        action,
        visibility: "workspace" as const,
        createdByUserId: "creator-1",
        isActiveWorkspaceMember: true,
      };

      expect(
        decideCoworkerAccess({
          ...base,
          actorUserId: "member-1",
          workspaceRole: "member",
        }),
      ).toEqual({ allowed: false, reason: "creator_or_workspace_admin_required" });
      expect(
        decideCoworkerAccess({
          ...base,
          actorUserId: "creator-1",
          workspaceRole: "member",
        }),
      ).toEqual({ allowed: true });
      expect(
        decideCoworkerAccess({
          ...base,
          actorUserId: "admin-1",
          workspaceRole: "admin",
        }),
      ).toEqual({ allowed: true });
      expect(
        decideCoworkerAccess({
          ...base,
          actorUserId: "owner-1",
          workspaceRole: "owner",
        }),
      ).toEqual({ allowed: true });
    },
  );

  it("requires the proposed user to accept automation ownership", () => {
    expect(
      decideCoworkerAccess({
        action: "accept_automation_owner",
        actorUserId: "member-1",
        workspaceRole: "member",
        isActiveWorkspaceMember: true,
        visibility: "workspace",
        createdByUserId: "creator-1",
        proposedAutomationOwnerUserId: "member-2",
      }),
    ).toEqual({ allowed: false, reason: "proposed_automation_owner_required" });

    expect(
      decideCoworkerAccess({
        action: "accept_automation_owner",
        actorUserId: "member-2",
        workspaceRole: "member",
        isActiveWorkspaceMember: true,
        visibility: "workspace",
        createdByUserId: "creator-1",
        proposedAutomationOwnerUserId: "member-2",
      }),
    ).toEqual({ allowed: true });
  });
});
