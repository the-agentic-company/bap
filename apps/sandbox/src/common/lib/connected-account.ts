type ResolveCredentialResponse =
  | {
      credential: {
        accessToken: string;
        accountLabel: string | null;
        connectedAccountId: string;
        connectedIdentityId: string | null;
        integrationType: string;
        availableAccountLabels: string[];
      };
    }
  | {
      code: string;
      message: string;
      availableAccountLabels?: string[];
    };

export type ConnectedAccountCliOptions = {
  integrationType: string;
  accountLabel?: string | null;
  fallbackEnvVar: string;
};

export function formatAccountLabelError(message: string, availableLabels?: readonly string[]) {
  if (!availableLabels?.length || message.includes("Available account labels")) {
    return message;
  }
  return `${message} Available account labels: ${availableLabels.join(", ")}.`;
}

function runtimeCredentialRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bearer =
    process.env.CMDCLAW_RUNTIME_CREDENTIAL_GRANT ??
    process.env.CMDCLAW_SERVER_SECRET ??
    process.env.SLACK_BOT_RELAY_SECRET;
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  return headers;
}

export async function resolveConnectedAccountAccessToken(
  options: ConnectedAccountCliOptions,
): Promise<string> {
  const accountLabel = options.accountLabel?.trim() || null;
  const runtimeUrl = process.env.CMDCLAW_RUNTIME_CREDENTIALS_URL;
  const userId = process.env.CMDCLAW_USER_ID;

  if (runtimeUrl && userId) {
    const response = await fetch(runtimeUrl, {
      method: "POST",
      headers: runtimeCredentialRequestHeaders(),
      body: JSON.stringify({
        userId,
        resolve: {
          integrationType: options.integrationType,
          accountLabel,
          allowedIntegrationTypes: [options.integrationType],
        },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as ResolveCredentialResponse;
    if (response.ok && "credential" in data) {
      return data.credential.accessToken;
    }
    if ("message" in data) {
      throw new Error(formatAccountLabelError(data.message, data.availableAccountLabels));
    }
    throw new Error(`Failed to resolve Account Label credential: HTTP ${response.status}`);
  }

  const fallback = process.env[options.fallbackEnvVar];
  if (!fallback) {
    throw new Error(`${options.fallbackEnvVar} environment variable required for this command`);
  }
  if (accountLabel) {
    const labels = process.env.CMDCLAW_AVAILABLE_ACCOUNT_LABELS;
    const labelSuffix = labels ? ` Available account labels: ${labels}.` : "";
    throw new Error(
      `--account requires CMDCLAW_RUNTIME_CREDENTIALS_URL for ${options.integrationType}.${labelSuffix}`,
    );
  }
  return fallback;
}
