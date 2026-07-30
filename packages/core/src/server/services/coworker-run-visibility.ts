import type { CoworkerVisibility } from "./coworker-access-policy";
import type { CoworkerStartKind } from "./coworker-run-policy";

export type CoworkerRunVisibilityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "workspace_membership_required"
        | "private_coworker"
        | "manual_run_initiator_required";
    };

type BaseRunAccessInput = {
  actorUserId: string;
  isActiveWorkspaceMember: boolean;
  coworkerVisibility: CoworkerVisibility;
  coworkerCreatedByUserId: string | null;
};

export function decideCoworkerRunMetadataAccess(
  input: BaseRunAccessInput,
): CoworkerRunVisibilityDecision {
  if (!input.isActiveWorkspaceMember) {
    return { allowed: false, reason: "workspace_membership_required" };
  }
  if (
    input.coworkerVisibility === "private" &&
    input.coworkerCreatedByUserId !== input.actorUserId
  ) {
    return { allowed: false, reason: "private_coworker" };
  }
  return { allowed: true };
}

export function decideCoworkerRunContentAccess(
  input: BaseRunAccessInput & {
    workspaceRole: string | null;
    startKind: CoworkerStartKind;
    initiatedByUserId: string | null;
  },
): CoworkerRunVisibilityDecision {
  const metadataDecision = decideCoworkerRunMetadataAccess(input);
  if (!metadataDecision.allowed) {
    return metadataDecision;
  }
  if (input.startKind === "user_intent" && input.initiatedByUserId !== input.actorUserId) {
    return { allowed: false, reason: "manual_run_initiator_required" };
  }
  return { allowed: true };
}
