import type { IntegrationType } from "../oauth/config";
import {
  getValidConnectedAccountTokensForUser,
  type ValidConnectedAccountToken,
} from "./token-refresh";

export type ConnectedAccountResolutionErrorCode =
  | "auth_required"
  | "account_label_required"
  | "account_label_not_found"
  | "account_label_not_connected"
  | "account_not_allowed"
  | "account_reauth_required"
  | "transient_auth_error";

export class ConnectedAccountResolutionError extends Error {
  constructor(
    public readonly code: ConnectedAccountResolutionErrorCode,
    message: string,
    public readonly availableAccountLabels: readonly string[] = [],
  ) {
    super(message);
    this.name = "ConnectedAccountResolutionError";
  }
}

export type ResolveConnectedAccountInput = {
  userId: string;
  integrationType: IntegrationType;
  accountLabel?: string | null;
  allowedIntegrationTypes?: readonly IntegrationType[] | null;
};

export type ResolvedConnectedAccountCredential = {
  integrationType: IntegrationType;
  accessToken: string;
  connectedAccountId: string;
  connectedIdentityId: string | null;
  accountLabel: string | null;
  displayName: string | null;
  metadata: Record<string, unknown> | null;
  availableAccountLabels: string[];
};

function requestedAccountMatches(
  credential: ValidConnectedAccountToken,
  requestedLabel: string,
): boolean {
  const candidates = [
    credential.accountLabel,
    credential.displayName,
    typeof credential.metadata?.email === "string" ? credential.metadata.email : null,
    typeof credential.metadata?.userEmail === "string" ? credential.metadata.userEmail : null,
  ];
  return candidates.some((candidate) => candidate?.trim().toLowerCase() === requestedLabel);
}

function labelsFor(tokens: readonly ValidConnectedAccountToken[]): string[] {
  return tokens
    .map((token) => token.accountLabel)
    .filter((label): label is string => Boolean(label))
    .sort();
}

export async function resolveConnectedAccountCredential(
  input: ResolveConnectedAccountInput,
): Promise<ResolvedConnectedAccountCredential> {
  if (
    input.allowedIntegrationTypes &&
    !input.allowedIntegrationTypes.includes(input.integrationType)
  ) {
    throw new ConnectedAccountResolutionError(
      "account_not_allowed",
      `Integration Type ${input.integrationType} is not allowed by this runtime grant.`,
    );
  }

  let credentials: ValidConnectedAccountToken[];
  try {
    credentials = await getValidConnectedAccountTokensForUser(input.userId, [input.integrationType]);
  } catch (error) {
    throw new ConnectedAccountResolutionError(
      "transient_auth_error",
      error instanceof Error ? error.message : "Failed to resolve Connected Account credential.",
    );
  }

  return selectConnectedAccountCredential(input, credentials);
}

export function selectConnectedAccountCredential(
  input: Omit<ResolveConnectedAccountInput, "userId" | "allowedIntegrationTypes">,
  credentials: readonly ValidConnectedAccountToken[],
): ResolvedConnectedAccountCredential {
  const availableAccountLabels = labelsFor(credentials);
  if (credentials.length === 0) {
    throw new ConnectedAccountResolutionError(
      "auth_required",
      `No Connected Account is available for ${input.integrationType}.`,
      availableAccountLabels,
    );
  }

  const requestedLabel = input.accountLabel?.trim().toLowerCase() || null;
  if (requestedLabel) {
    const matching = credentials.find((credential) =>
      requestedAccountMatches(credential, requestedLabel),
    );
    if (matching) {
      return { ...matching, availableAccountLabels };
    }

    const labelExistsForAnotherType = availableAccountLabels.includes(requestedLabel);
    throw new ConnectedAccountResolutionError(
      labelExistsForAnotherType ? "account_label_not_connected" : "account_label_not_found",
      `Account Label "${requestedLabel}" is not connected for ${input.integrationType}. Available account labels: ${availableAccountLabels.join(", ") || "(none)"}.`,
      availableAccountLabels,
    );
  }

  if (credentials.length === 1) {
    return { ...credentials[0], availableAccountLabels };
  }

  throw new ConnectedAccountResolutionError(
    "account_label_required",
    `Multiple Account Labels are available for ${input.integrationType}. Available account labels: ${availableAccountLabels.join(", ")}.`,
    availableAccountLabels,
  );
}
