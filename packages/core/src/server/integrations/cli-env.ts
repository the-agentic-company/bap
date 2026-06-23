import { eq, and } from "drizzle-orm";
import { buildIntegrationCliInstructions } from "@bap/prompts";
import type { IntegrationType } from "../oauth/config";
import { env } from "../../env";
import { resolvePublicCallbackBaseUrl } from "../../lib/worktree-routing";
import { isSelfHostedEdition } from "../edition";
import { db } from "@bap/db/client";
import { connectedIdentity, integration, customIntegrationCredential } from "@bap/db/schema";
import { decrypt } from "../lib/encryption";
import {
  getDelegatedRuntimeCredentials,
  listCloudManagedIntegrations,
} from "../control-plane/client";
import { getValidTokensForUser, getValidCustomTokens } from "./token-refresh";
import { backfillConnectedIdentities } from "./backfill-connected-identities";

// Token-based integrations map to their access token env var
type TokenEnvIntegrationType = Exclude<IntegrationType, "linkedin" | "linear">;

const TOKEN_ENV_VAR_MAP: Record<TokenEnvIntegrationType, string> = {
  google_gmail: "GMAIL_ACCESS_TOKEN",
  outlook: "OUTLOOK_ACCESS_TOKEN",
  outlook_calendar: "OUTLOOK_CALENDAR_ACCESS_TOKEN",
  google_calendar: "GOOGLE_CALENDAR_ACCESS_TOKEN",
  google_docs: "GOOGLE_DOCS_ACCESS_TOKEN",
  google_sheets: "GOOGLE_SHEETS_ACCESS_TOKEN",
  google_drive: "GOOGLE_DRIVE_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  hubspot: "HUBSPOT_ACCESS_TOKEN",
  salesforce: "SALESFORCE_ACCESS_TOKEN",
  dynamics: "DYNAMICS_ACCESS_TOKEN",
};

function isTokenEnvIntegrationType(type: string): type is TokenEnvIntegrationType {
  return type in TOKEN_ENV_VAR_MAP;
}

export function getTokenEnvVarForIntegrationType(type: string): string | null {
  return isTokenEnvIntegrationType(type) ? TOKEN_ENV_VAR_MAP[type] : null;
}

const CLI_ENV_INTEGRATION_MAP: Record<string, IntegrationType> = {
  ...Object.fromEntries(
    Object.entries(TOKEN_ENV_VAR_MAP).map(([integrationType, envVar]) => [envVar, integrationType]),
  ),
  SALESFORCE_INSTANCE_URL: "salesforce",
  DYNAMICS_INSTANCE_URL: "dynamics",
  LINKEDIN_ACCOUNT_ID: "linkedin",
  UNIPILE_API_KEY: "linkedin",
  UNIPILE_DSN: "linkedin",
};

export function filterCliEnvToAllowedIntegrations(
  cliEnv: Record<string, string>,
  allowedIntegrations?: IntegrationType[],
): Record<string, string> {
  if (!allowedIntegrations) {
    return { ...cliEnv };
  }

  return Object.fromEntries(
    Object.entries(cliEnv).filter(([key]) => {
      const integrationType = CLI_ENV_INTEGRATION_MAP[key];
      return integrationType ? allowedIntegrations.includes(integrationType) : true;
    }),
  );
}

export async function getCliEnvForUser(userId: string): Promise<Record<string, string>> {
  if (isSelfHostedEdition()) {
    const delegated = await getDelegatedRuntimeCredentials(userId, { integrationTypes: [] });
    return delegated.cliEnv;
  }

  const cliEnv: Record<string, string> = {};
  await backfillConnectedIdentities(db, userId);
  // Get valid tokens, refreshing any that are expired or about to expire
  // This already filters by enabled integrations
  const tokens = await getValidTokensForUser(userId);

  for (const [type, accessToken] of tokens) {
    if (!isTokenEnvIntegrationType(type)) {
      continue;
    }
    const envVar = TOKEN_ENV_VAR_MAP[type];
    if (envVar) {
      cliEnv[envVar] = accessToken;
    }
  }

  // LinkedIn special case - uses Unipile account_id instead of OAuth tokens
  const linkedinIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "linkedin"),
      eq(integration.enabled, true),
    ),
  });

  if (linkedinIntegration && linkedinIntegration.providerAccountId) {
    cliEnv.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
    if (env.UNIPILE_API_KEY) {
      cliEnv.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
    }
    if (env.UNIPILE_DSN) {
      cliEnv.UNIPILE_DSN = env.UNIPILE_DSN;
    }
  }

  // Salesforce special case - needs instance URL from metadata
  const salesforceIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "salesforce"),
      eq(integration.enabled, true),
    ),
  });

  if (salesforceIntegration && salesforceIntegration.metadata) {
    const metadata = salesforceIntegration.metadata as Record<string, unknown>;
    if (metadata.instanceUrl) {
      cliEnv.SALESFORCE_INSTANCE_URL = metadata.instanceUrl as string;
    }
  }

  // Dynamics special case - needs selected Dataverse instance URL from metadata
  const dynamicsIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "dynamics"),
      eq(integration.enabled, true),
    ),
  });

  if (dynamicsIntegration && dynamicsIntegration.metadata) {
    const metadata = dynamicsIntegration.metadata as Record<string, unknown>;
    if (metadata.instanceUrl) {
      cliEnv.DYNAMICS_INSTANCE_URL = metadata.instanceUrl as string;
    }
  }

  // Discord bot token - server-level, not per-user OAuth
  if (env.DISCORD_BOT_TOKEN) {
    cliEnv.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  }

  // Slack bot relay config (keeps SLACK_BOT_TOKEN server-side only)
  const slackRelaySecret = env.SLACK_BOT_RELAY_SECRET ?? env.APP_SERVER_SECRET;
  if (slackRelaySecret) {
    cliEnv.SLACK_BOT_RELAY_SECRET = slackRelaySecret;
  }
  const relayBaseUrl = resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    viteAppUrl: env.VITE_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (relayBaseUrl) {
    cliEnv.SLACK_BOT_RELAY_URL = `${relayBaseUrl}/api/internal/slack/post-as-bot`;
  }

  // Custom integrations
  try {
    const customCreds = await db.query.customIntegrationCredential.findMany({
      where: and(
        eq(customIntegrationCredential.userId, userId),
        eq(customIntegrationCredential.enabled, true),
      ),
      with: {
        customIntegration: true,
      },
    });

    // Refresh OAuth tokens for custom integrations
    const refreshedTokens = await getValidCustomTokens(userId);

    for (const cred of customCreds) {
      const slug = cred.customIntegration.slug.toUpperCase().replace(/-/g, "_");
      const integ = cred.customIntegration;

      // Set base URL
      cliEnv[`${slug}_BASE_URL`] = integ.baseUrl;

      if (integ.authType === "api_key" && cred.apiKey) {
        try {
          cliEnv[`${slug}_API_KEY`] = decrypt(cred.apiKey);
          if (integ.apiKeyConfig) {
            cliEnv[`${slug}_API_KEY_METHOD`] = integ.apiKeyConfig.method;
            if (integ.apiKeyConfig.headerName) {
              cliEnv[`${slug}_API_KEY_HEADER`] = integ.apiKeyConfig.headerName;
            }
            if (integ.apiKeyConfig.queryParam) {
              cliEnv[`${slug}_API_KEY_PARAM`] = integ.apiKeyConfig.queryParam;
            }
          }
        } catch (e) {
          console.error(`Failed to decrypt API key for custom integration ${integ.slug}:`, e);
        }
      } else if (integ.authType === "bearer_token" && cred.apiKey) {
        try {
          cliEnv[`${slug}_ACCESS_TOKEN`] = decrypt(cred.apiKey);
        } catch (e) {
          console.error(`Failed to decrypt bearer token for custom integration ${integ.slug}:`, e);
        }
      } else if (integ.authType === "oauth2") {
        // Use refreshed token if available, otherwise use stored token
        const refreshedToken = refreshedTokens.get(cred.id);
        if (refreshedToken) {
          cliEnv[`${slug}_ACCESS_TOKEN`] = refreshedToken;
        } else if (cred.accessToken) {
          cliEnv[`${slug}_ACCESS_TOKEN`] = cred.accessToken;
        }
      }
    }
  } catch (e) {
    console.error("Failed to load custom integration credentials:", e);
  }

  return cliEnv;
}

export async function getCliInstructionsWithCustom(
  connectedIntegrations: IntegrationType[],
  userId: string,
): Promise<string> {
  const labelsByType = await getAccountLabelsByIntegrationType(userId);

  try {
    const customCreds = await db.query.customIntegrationCredential.findMany({
      where: and(
        eq(customIntegrationCredential.userId, userId),
        eq(customIntegrationCredential.enabled, true),
      ),
      with: {
        customIntegration: true,
      },
    });

    if (customCreds.length === 0) {
      return buildIntegrationCliInstructions({ connectedIntegrations, labelsByType });
    }

    return buildIntegrationCliInstructions({
      connectedIntegrations,
      labelsByType,
      customIntegrations: customCreds.map((cred) => ({
        name: cred.customIntegration.name,
        cliInstructions: cred.customIntegration.cliInstructions,
      })),
    });
  } catch {
    return buildIntegrationCliInstructions({ connectedIntegrations, labelsByType });
  }
}

export async function getAccountLabelsByIntegrationType(
  userId: string,
): Promise<Map<IntegrationType, string[]>> {
  if (isSelfHostedEdition()) {
    return new Map();
  }

  await backfillConnectedIdentities(db, userId);

  const rows = await db
    .select({
      type: integration.type,
      label: connectedIdentity.label,
    })
    .from(integration)
    .innerJoin(connectedIdentity, eq(integration.connectedIdentityId, connectedIdentity.id))
    .where(and(eq(integration.userId, userId), eq(integration.enabled, true)));

  const labelsByType = new Map<IntegrationType, string[]>();
  for (const row of rows) {
    const labels = labelsByType.get(row.type) ?? [];
    labels.push(row.label);
    labelsByType.set(row.type, labels);
  }

  for (const [type, labels] of labelsByType) {
    labelsByType.set(type, [...new Set(labels)].sort());
  }

  return labelsByType;
}

export async function getEnabledIntegrationTypes(userId: string): Promise<IntegrationType[]> {
  if (isSelfHostedEdition()) {
    const integrations = await listCloudManagedIntegrations(userId);
    return integrations
      .filter((item) => item.enabled)
      .map((item) => item.type) as IntegrationType[];
  }

  const results = await db
    .select({ type: integration.type })
    .from(integration)
    .where(and(eq(integration.userId, userId), eq(integration.enabled, true)));

  return results.map((r) => r.type);
}

/**
 * Get tokens for specific integrations (used for mid-conversation auth)
 * Returns a map of environment variable name -> access token
 */
export async function getTokensForIntegrations(
  userId: string,
  integrationTypes: string[],
): Promise<Record<string, string>> {
  if (isSelfHostedEdition()) {
    const delegated = await getDelegatedRuntimeCredentials(userId, { integrationTypes });
    return delegated.tokens;
  }

  const tokens: Record<string, string> = {};
  const requestedTokenIntegrations = integrationTypes.filter(
    (type): type is TokenEnvIntegrationType => isTokenEnvIntegrationType(type),
  );

  // Get valid tokens only for requested token-based integrations
  const allTokens = await getValidTokensForUser(userId, requestedTokenIntegrations);

  for (const [type, accessToken] of allTokens) {
    if (integrationTypes.includes(type)) {
      if (!isTokenEnvIntegrationType(type)) {
        continue;
      }
      const envVar = TOKEN_ENV_VAR_MAP[type];
      if (envVar) {
        tokens[envVar] = accessToken;
      }
    }
  }

  // LinkedIn special case
  if (integrationTypes.includes("linkedin")) {
    const linkedinIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, userId),
        eq(integration.type, "linkedin"),
        eq(integration.enabled, true),
      ),
    });

    if (linkedinIntegration && linkedinIntegration.providerAccountId) {
      tokens.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
      if (env.UNIPILE_API_KEY) {
        tokens.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
      }
      if (env.UNIPILE_DSN) {
        tokens.UNIPILE_DSN = env.UNIPILE_DSN;
      }
    }
  }

  // Salesforce special case - needs instance URL from metadata
  if (integrationTypes.includes("salesforce")) {
    const salesforceIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, userId),
        eq(integration.type, "salesforce"),
        eq(integration.enabled, true),
      ),
    });

    if (salesforceIntegration && salesforceIntegration.metadata) {
      const metadata = salesforceIntegration.metadata as Record<string, unknown>;
      if (metadata.instanceUrl) {
        tokens.SALESFORCE_INSTANCE_URL = metadata.instanceUrl as string;
      }
    }
  }

  // Dynamics special case - needs selected Dataverse instance URL from metadata
  if (integrationTypes.includes("dynamics")) {
    const dynamicsIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, userId),
        eq(integration.type, "dynamics"),
        eq(integration.enabled, true),
      ),
    });

    if (dynamicsIntegration && dynamicsIntegration.metadata) {
      const metadata = dynamicsIntegration.metadata as Record<string, unknown>;
      if (metadata.instanceUrl) {
        tokens.DYNAMICS_INSTANCE_URL = metadata.instanceUrl as string;
      }
    }
  }

  return tokens;
}
