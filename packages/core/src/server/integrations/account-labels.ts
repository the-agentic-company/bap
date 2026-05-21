import type { IntegrationType } from "../oauth/config";

export type AccountLabelInput = {
  userId: string;
  integrationType: IntegrationType;
  providerIdentityId: string | null;
  reliableEmail: string | null;
  displayName: string | null;
  workspaceOrTenantName: string | null;
};

export type ExistingConnectedIdentity = {
  id: string;
  label: string;
  emailIdentity: string | null;
  integrationTypes: readonly IntegrationType[];
};

export type ConnectedIdentityAssignment =
  | {
      kind: "existing";
      connectedIdentityId: string;
      accountLabel: string;
    }
  | {
      kind: "create";
      accountLabel: string;
      emailIdentity: string | null;
      metadata: Record<string, unknown>;
    };

const VALID_LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeAccountLabel(input: string): string {
  const label = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!label || !VALID_LABEL.test(label)) {
    throw new Error("Account Label must be a lowercase ASCII slug using letters, numbers, and dashes.");
  }

  return label;
}

export function isValidAccountLabel(input: string): boolean {
  return VALID_LABEL.test(input);
}

export function normalizeEmailIdentity(input: string | null | undefined): string | null {
  const email = input?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return null;
  }
  return email;
}

function labelBaseFromInput(input: AccountLabelInput): string {
  const email = normalizeEmailIdentity(input.reliableEmail);
  if (email) {
    return normalizeAccountLabel(email.split("@")[0] ?? email);
  }

  const fromDisplayName = input.displayName?.trim();
  if (fromDisplayName) {
    return normalizeAccountLabel(fromDisplayName);
  }

  const fromProviderIdentity = input.providerIdentityId?.trim();
  if (fromProviderIdentity) {
    return normalizeAccountLabel(fromProviderIdentity);
  }

  return normalizeAccountLabel(input.integrationType.replace(/_/g, "-"));
}

function contextualSuffix(input: AccountLabelInput): string | null {
  const workspace = input.workspaceOrTenantName?.trim();
  if (workspace) {
    return normalizeAccountLabel(workspace);
  }
  return normalizeAccountLabel(input.integrationType.replace(/_/g, "-"));
}

export function nextAvailableAccountLabel(
  preferredLabel: string,
  existingLabels: readonly string[],
): string {
  const used = new Set(existingLabels);
  if (!used.has(preferredLabel)) {
    return preferredLabel;
  }

  for (let counter = 2; ; counter += 1) {
    const candidate = `${preferredLabel}-${counter}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function suggestAccountLabel(
  input: AccountLabelInput,
  existingLabels: readonly string[],
): string {
  return nextAvailableAccountLabel(labelBaseFromInput(input), existingLabels);
}

export function planConnectedIdentityAssignment(input: {
  newAccount: AccountLabelInput;
  existingIdentities: readonly ExistingConnectedIdentity[];
  requestedAccountLabel?: string | null;
}): ConnectedIdentityAssignment {
  const emailIdentity = normalizeEmailIdentity(input.newAccount.reliableEmail);
  const existingLabels = input.existingIdentities.map((identity) => identity.label);

  if (input.requestedAccountLabel) {
    const requestedLabel = normalizeAccountLabel(input.requestedAccountLabel);
    const requestedIdentity = input.existingIdentities.find(
      (identity) => identity.label === requestedLabel,
    );
    if (requestedIdentity) {
      assertCanAttachIntegrationType(requestedIdentity, input.newAccount.integrationType);
      return {
        kind: "existing",
        connectedIdentityId: requestedIdentity.id,
        accountLabel: requestedIdentity.label,
      };
    }

    return {
      kind: "create",
      accountLabel: nextAvailableAccountLabel(requestedLabel, existingLabels),
      emailIdentity,
      metadata: buildAssignmentMetadata(input.newAccount, "requested-label"),
    };
  }

  if (emailIdentity) {
    const matchingIdentity = input.existingIdentities.find(
      (identity) =>
        identity.emailIdentity === emailIdentity &&
        !identity.integrationTypes.includes(input.newAccount.integrationType),
    );
    if (matchingIdentity) {
      return {
        kind: "existing",
        connectedIdentityId: matchingIdentity.id,
        accountLabel: matchingIdentity.label,
      };
    }
  }

  const preferredBase = labelBaseFromInput(input.newAccount);
  const hasSameEmailCollision = Boolean(
    emailIdentity &&
      input.existingIdentities.some(
        (identity) =>
          identity.emailIdentity === emailIdentity &&
          identity.integrationTypes.includes(input.newAccount.integrationType),
      ),
  );
  const suffix = hasSameEmailCollision ? contextualSuffix(input.newAccount) : null;
  const preferredLabel =
    suffix && suffix !== preferredBase ? `${preferredBase}-${suffix}` : preferredBase;

  return {
    kind: "create",
    accountLabel: nextAvailableAccountLabel(preferredLabel, existingLabels),
    emailIdentity,
    metadata: buildAssignmentMetadata(
      input.newAccount,
      hasSameEmailCollision ? "same-integration-type-collision" : "default",
    ),
  };
}

export function assertCanAttachIntegrationType(
  identity: ExistingConnectedIdentity,
  integrationType: IntegrationType,
): void {
  if (identity.integrationTypes.includes(integrationType)) {
    throw new Error(
      `Account Label "${identity.label}" already has a Connected Account for ${integrationType}.`,
    );
  }
}

export function buildAssignmentMetadata(
  input: AccountLabelInput,
  reason: string,
): Record<string, unknown> {
  return {
    groupingReason: reason,
    integrationType: input.integrationType,
    providerIdentityId: input.providerIdentityId,
    displayName: input.displayName,
    workspaceOrTenantName: input.workspaceOrTenantName,
  };
}

export function getReliableEmailFromMetadata(
  displayName: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const candidates = [
    metadata?.email,
    metadata?.userEmail,
    metadata?.preferred_username,
    metadata?.upn,
    displayName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const email = normalizeEmailIdentity(candidate);
    if (email) {
      return email;
    }
  }
  return null;
}

export function getWorkspaceOrTenantNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const candidates = [
    metadata?.workspaceName,
    metadata?.workspace,
    metadata?.teamName,
    metadata?.team,
    metadata?.tenantName,
    metadata?.instanceName,
    metadata?.organization,
    metadata?.org,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}
