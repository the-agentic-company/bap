export type CoworkerVisibility = "private" | "workspace";

export type CoworkerAction =
  | "read"
  | "edit"
  | "run_manual"
  | "read_run_metadata"
  | "restore_revision"
  | "organize"
  | "change_visibility"
  | "delete"
  | "propose_automation_owner"
  | "accept_automation_owner";

export type CoworkerAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "workspace_membership_required"
        | "private_coworker"
        | "creator_or_workspace_admin_required"
        | "proposed_automation_owner_required";
    };

const CREATOR_OR_ADMIN_ACTIONS = new Set<CoworkerAction>([
  "change_visibility",
  "delete",
  "propose_automation_owner",
]);

function isWorkspaceAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

export function decideCoworkerAccess(input: {
  action: CoworkerAction;
  actorUserId: string;
  workspaceRole: string | null;
  isActiveWorkspaceMember: boolean;
  visibility: CoworkerVisibility;
  createdByUserId: string | null;
  proposedAutomationOwnerUserId?: string | null;
}): CoworkerAccessDecision {
  if (!input.isActiveWorkspaceMember) {
    return { allowed: false, reason: "workspace_membership_required" };
  }

  const isCreator = input.createdByUserId === input.actorUserId;
  if (input.visibility === "private" && !isCreator) {
    return { allowed: false, reason: "private_coworker" };
  }

  if (CREATOR_OR_ADMIN_ACTIONS.has(input.action)) {
    return isCreator || isWorkspaceAdmin(input.workspaceRole)
      ? { allowed: true }
      : { allowed: false, reason: "creator_or_workspace_admin_required" };
  }

  if (input.action === "accept_automation_owner") {
    return input.proposedAutomationOwnerUserId === input.actorUserId
      ? { allowed: true }
      : { allowed: false, reason: "proposed_automation_owner_required" };
  }

  return { allowed: true };
}
