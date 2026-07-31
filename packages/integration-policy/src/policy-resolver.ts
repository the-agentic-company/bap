export const WORKSPACE_INTEGRATION_POLICY_MODES = [
  "auto_approved",
  "requires_approval",
  "denied",
  "personalized",
] as const;

export type WorkspaceIntegrationPolicyMode = (typeof WORKSPACE_INTEGRATION_POLICY_MODES)[number];

export const WORKSPACE_INTEGRATION_OPERATION_RESTRICTIONS = [
  "requires_approval",
  "denied",
] as const;

export type WorkspaceIntegrationOperationRestriction =
  (typeof WORKSPACE_INTEGRATION_OPERATION_RESTRICTIONS)[number];

export type WorkspaceIntegrationPolicyDecision =
  | {
      decision: "auto_approved";
      source:
        | "implicit_default"
        | "parent_auto_approved"
        | "personalized_default"
        | "generation_auto_approve";
    }
  | {
      decision: "requires_approval";
      source: "parent_requires_approval" | "operation_requires_approval";
    }
  | {
      decision: "denied";
      source: "parent_denied" | "operation_denied";
    };

export type ResolveWorkspaceIntegrationPolicyInput = {
  parentMode?: WorkspaceIntegrationPolicyMode | null;
  operationRestriction?: WorkspaceIntegrationOperationRestriction | null;
  generationAutoApprove: boolean;
};

export function resolveWorkspaceIntegrationPolicy(
  input: ResolveWorkspaceIntegrationPolicyInput,
): WorkspaceIntegrationPolicyDecision {
  const parentMode = input.parentMode ?? "auto_approved";

  if (parentMode === "denied") {
    return { decision: "denied", source: "parent_denied" };
  }

  const restriction = parentMode === "personalized" ? (input.operationRestriction ?? null) : null;

  if (restriction === "denied") {
    return { decision: "denied", source: "operation_denied" };
  }

  const requiresApproval =
    parentMode === "requires_approval" || restriction === "requires_approval";

  if (requiresApproval && input.generationAutoApprove) {
    return { decision: "auto_approved", source: "generation_auto_approve" };
  }

  if (parentMode === "requires_approval") {
    return { decision: "requires_approval", source: "parent_requires_approval" };
  }

  if (restriction === "requires_approval") {
    return { decision: "requires_approval", source: "operation_requires_approval" };
  }

  if (!input.parentMode) {
    return { decision: "auto_approved", source: "implicit_default" };
  }

  if (parentMode === "personalized") {
    return { decision: "auto_approved", source: "personalized_default" };
  }

  return { decision: "auto_approved", source: "parent_auto_approved" };
}

export function acceptsOperationRestrictions(
  mode: WorkspaceIntegrationPolicyMode,
): mode is "personalized" {
  return mode === "personalized";
}
