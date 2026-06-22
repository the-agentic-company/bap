import { eq, and } from "drizzle-orm";
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
  const base = getCliInstructions(
    connectedIntegrations,
    await getAccountLabelsByIntegrationType(userId),
  );

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
      return base;
    }

    const customSections = customCreds.map((cred) => {
      const integ = cred.customIntegration;
      return `\n## ${integ.name} CLI (Custom) [✓ Connected]\n${integ.cliInstructions}\n`;
    });

    return base + "\n" + customSections.join("\n");
  } catch {
    return base;
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

function accountLabelHint(
  labelsByType: Map<IntegrationType, string[]> | undefined,
  type: IntegrationType,
): string {
  const labels = labelsByType?.get(type) ?? [];
  if (labels.length === 0) {
    return "";
  }
  return `\n- Account Labels: ${labels.join(", ")}. Use --account <label> when selecting a Connected Account.`;
}

function getCliInstructions(
  connectedIntegrations: IntegrationType[],
  labelsByType?: Map<IntegrationType, string[]>,
): string {
  // Helper to show connection status
  const statusTag = (type: IntegrationType) =>
    connectedIntegrations.includes(type) ? "✓ Connected" : "⚡ Auth Required";

  // Always include ALL integration instructions - auth will be requested on use if needed
  const instructions = `
## Google Gmail CLI [${statusTag("google_gmail")}]
- Use search whenever you have a query; use list only to browse recent mail
- google-gmail [--account <label>] list [-l limit] - List emails
- google-gmail [--account <label>] search -q <query> [-l limit] [--scope inbox|all|strict-all] - Search mailbox
- google-gmail [--account <label>] get <messageId> - Get full email content
- google-gmail [--account <label>] unread - Count unread emails
- google-gmail [--account <label>] draft --to <email> --subject <subject> --body <body>
- google-gmail [--account <label>] send --to <email> --subject <subject> --body <body>
- Email bodies accept plain text, common Markdown, or allowed safe email HTML.
- Example: google-gmail --account work search -q "from:boss" -l 5${accountLabelHint(labelsByType, "google_gmail")}

## Outlook Mail CLI [${statusTag("outlook")}]
- Use search whenever you have a query; use list only to browse recent mail
- outlook-mail [--account <label>] list [-l limit] - List emails
- outlook-mail [--account <label>] search -q <query> [-l limit] - Search mailbox
- outlook-mail [--account <label>] get <messageId> - Get full email content
- outlook-mail [--account <label>] unread - Count unread emails
- outlook-mail [--account <label>] contacts list [-l limit] [--cursor <cursor>] [--all] - List Outlook contacts; follow nextCommand when hasMore is true
- outlook-mail [--account <label>] draft --to <email> --subject <subject> --body <body> [--attachment <path>]
- outlook-mail [--account <label>] send --to <email> --subject <subject> --body <body> [--attachment <path>]
- Email bodies accept plain text, common Markdown, or allowed safe email HTML.
- Example: outlook-mail --account work search -q "invoice" -l 5${accountLabelHint(labelsByType, "outlook")}

## Outlook Calendar CLI [${statusTag("outlook_calendar")}]
- outlook-calendar list [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - List events
- outlook-calendar get <eventId> [-c calendarId] - Get event details
- outlook-calendar create --summary <title> --start <datetime> --end <datetime> [--description <text>] [--location <text>]
- outlook-calendar update <eventId> [--summary <title>] [--start <datetime>] [--end <datetime>] [--description <text>] [--location <text>]
- outlook-calendar delete <eventId> [-c calendarId] - Delete an event
- outlook-calendar calendars - List available calendars
- outlook-calendar today [-c calendarId] - List today's events
- Example: outlook-calendar list -l 10

## Google Calendar CLI [${statusTag("google_calendar")}]
- google-calendar list [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - List events
- google-calendar search [-q <text>] [--attendee <email>] [--next] [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - Search matching events
- google-calendar availability --from <datetime> --to <datetime> [--duration 30m] [--workday-start HH:MM] [--workday-end HH:MM] [-l limit] [-c calendarId] - Return free slots
- google-calendar get <eventId> [-c calendarId] - Get event details
- google-calendar create --summary <title> --start <datetime> --end <datetime> [--description <text>] [--location <text>] [--attendees <a@x.com,b@y.com>] [-c calendarId]
- google-calendar update <eventId> [--summary <title>] [--start <datetime>] [--end <datetime>] [--description <text>] [--location <text>] [-c calendarId]
- google-calendar delete <eventId> [-c calendarId] - Delete an event
- google-calendar calendars - List available calendars
- google-calendar today [-c calendarId] - List today's events
- Example: google-calendar list -l 10

## Google Docs CLI [${statusTag("google_docs")}]
- google-docs get <documentId> - Get document content
- google-docs create --title <title> [--content <text>] - Create a document
- google-docs append <documentId> --text <text> - Append text to document
- google-docs list - List recent documents
- Example: google-docs get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

## Google Sheets CLI [${statusTag("google_sheets")}]
- google-sheets get <spreadsheetId> [--range <A1:B10>] - Get spreadsheet data
- google-sheets create --title <title> - Create a spreadsheet
- google-sheets append <spreadsheetId> --range <A:B> --values '[[...]]' - Append rows
- google-sheets update <spreadsheetId> --range <A1:B2> --values '[[...]]' - Update cells
- google-sheets list - List recent spreadsheets
- Example: google-sheets get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms --range Sheet1!A1:D10

## Google Drive CLI [${statusTag("google_drive")}]
- google-drive list [-q query] [-l limit] - List files
- google-drive get <fileId> - Get file metadata
- google-drive download <fileId> [--output <path>] - Download file
- google-drive search -q <query> - Search files
- google-drive upload --file <path> [--name <name>] [--folder <folderId>] - Upload file
- Example: google-drive list -l 20

## Notion CLI [${statusTag("notion")}]
- notion search [-q query] [--type page|database] - Search pages/databases
- notion get <pageId> - Get page content
- notion create --parent <id> --title <title> [--content <text>]
- notion append <pageId> --content <text> - Append to page
- notion databases - List all databases
- notion query <databaseId> - Query database entries

## GitHub CLI [${statusTag("github")}]
- github repos - List my repositories
- github prs -o <owner> -r <repo> - List pull requests
- github pr <number> -o <owner> -r <repo> - Get PR details
- github my-prs [-f created|assigned|review] - My pull requests
- github issues -o <owner> -r <repo> - List issues
- github create-issue -o <owner> -r <repo> -t <title> [-b body]
- github search -q <query> - Search code

## Airtable CLI [${statusTag("airtable")}]
- airtable bases - List all bases
- airtable schema -b <baseId> - Get base schema
- airtable list -b <baseId> -t <table> - List records
- airtable get -b <baseId> -t <table> -r <recordId> - Get record
- airtable create -b <baseId> -t <table> --fields '{"Name":"value"}'
- airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- airtable delete -b <baseId> -t <table> -r <recordId>

## Slack CLI [${statusTag("slack")}]
- slack [--account <label>] channels - List channels
- slack [--account <label>] history -c <channelId> - Get channel messages
- slack [--account <label>] send -c <channelId> -t <text> --as <user|bot> [--thread <ts>] - Send message (explicit actor required; --account applies to --as user)
- Slack message text accepts common Markdown; the CLI converts it to Slack mrkdwn.
- slack [--account <label>] search -q <query> - Search messages
- slack [--account <label>] users - List users
- slack [--account <label>] user -u <userId> - Get user info
- slack [--account <label>] thread -c <channelId> --thread <ts> - Get thread replies
- slack [--account <label>] react -c <channelId> --ts <messageTs> -e <emoji>${accountLabelHint(labelsByType, "slack")}

## HubSpot CLI [${statusTag("hubspot")}]
- hubspot contacts list [-l limit] [-q query] - List contacts
- hubspot contacts get <id> - Get contact details
- hubspot contacts create --email <email> [--firstname] [--lastname] [--company] [--phone]
- hubspot contacts update <id> --properties '{"firstname":"John"}'
- hubspot contacts search -q <query> - Search contacts
- hubspot companies list [-l limit] - List companies
- hubspot companies get <id> - Get company details
- hubspot companies create --name <name> [--domain] [--industry]
- hubspot deals list [-l limit] - List deals
- hubspot deals get <id> - Get deal details
- hubspot deals create --name <name> --pipeline <id> --stage <id> [--amount]
- hubspot tickets list [-l limit] - List tickets
- hubspot tickets get <id> - Get ticket details
- hubspot tickets create --subject <subject> --pipeline <id> --stage <id>
- hubspot tasks list [-l limit] - List tasks
- hubspot tasks create --subject <subject> [--body] [--due]
- hubspot notes create --body <text> [--contact <id>] [--company <id>] [--deal <id>]
- hubspot pipelines deals - List deal pipelines and stages
- hubspot pipelines tickets - List ticket pipelines and stages
- hubspot owners - List owners (sales reps)

## LinkedIn CLI (via Unipile) [${statusTag("linkedin")}]
MESSAGING
- linkedin chats list [-l limit]                    List conversations
- linkedin chats get <chatId>                       Get conversation details
- linkedin messages list <chatId> [-l limit]        List messages in chat
- linkedin messages send <chatId> --text <message>  Send message
- linkedin messages start <profileId> --text <msg>  Start new conversation

PROFILES
- linkedin profile me                               Get my profile
- linkedin profile get <identifier>                 Get user profile (URL or ID)
- linkedin profile company <identifier>             Get company profile
- linkedin search -q <query> [-l limit]             Search for people

INVITATIONS & CONNECTIONS
- linkedin invite send <profileId> [--message <m>]  Send connection request
- linkedin invite list                              List pending invitations
- linkedin connections list [-l limit]              List my connections
- linkedin connections remove <profileId>           Remove connection

POSTS & CONTENT
- linkedin posts list [--profile <id>] [-l limit]   List posts
- linkedin posts get <postId>                       Get post details
- linkedin posts create --text <content>            Create a post
- linkedin posts comment <postId> --text <comment>  Comment on post
- linkedin posts react <postId> --type <LIKE|...>   React to post

COMPANY PAGES
- linkedin company posts <companyId> [-l limit]     List company posts
- linkedin company post <companyId> --text <text>   Post as company (if admin)

## Salesforce CLI [${statusTag("salesforce")}]

Query and manage Salesforce CRM records.

### Commands

**Query records (SOQL):**
\`\`\`bash
salesforce query "SELECT Id, Name, Email FROM Contact WHERE AccountId = '001xxx'"
salesforce query "SELECT Id, Name, Amount, StageName FROM Opportunity WHERE Amount > 50000"
salesforce query "SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10"
\`\`\`

**Get single record:**
\`\`\`bash
salesforce get Account 001xxxxxxxxxxxx
salesforce get Contact 003xxxxxxxxxxxx Name,Email,Phone
\`\`\`

**Create record:**
\`\`\`bash
salesforce create Contact '{"FirstName": "John", "LastName": "Doe", "Email": "john@example.com", "AccountId": "001xxx"}'
salesforce create Task '{"Subject": "Follow up", "WhoId": "003xxx", "ActivityDate": "2025-02-01"}'
salesforce create Opportunity '{"Name": "New Deal", "StageName": "Prospecting", "CloseDate": "2025-03-01", "Amount": 10000}'
\`\`\`

**Update record:**
\`\`\`bash
salesforce update Opportunity 006xxxxxxxxxxxx '{"StageName": "Negotiation", "Amount": 15000}'
salesforce update Contact 003xxxxxxxxxxxx '{"Phone": "555-1234"}'
\`\`\`

**Describe object (get fields):**
\`\`\`bash
salesforce describe Account
salesforce describe Opportunity
salesforce describe CustomObject__c
\`\`\`

**List all objects:**
\`\`\`bash
salesforce objects
\`\`\`

**Search across objects (SOSL):**
\`\`\`bash
salesforce search "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)"
\`\`\`

### Common Objects
- **Account** - Companies/organizations
- **Contact** - People at companies
- **Lead** - Potential customers
- **Opportunity** - Sales deals
- **Task** - To-do items
- **Case** - Support tickets

### SOQL Tips
- Use \`LIMIT\` to restrict results
- Date literals: \`TODAY\`, \`THIS_MONTH\`, \`LAST_N_DAYS:30\`
- Custom objects end with \`__c\` (e.g., \`Invoice__c\`)
- Custom fields end with \`__c\` (e.g., \`Custom_Field__c\`)

## Microsoft Dynamics 365 CLI [${statusTag("dynamics")}]

Native Dataverse operations for tables and rows.

### Commands
- dynamics whoami - Get current Dataverse user context
- dynamics tables list [--top 50] - List Dataverse tables
- dynamics tables get <logicalName> - Get table metadata and attributes
- dynamics rows list <table> [--select col1,col2] [--filter "..."] [--orderby "..."] [--top 25]
- dynamics rows get <table> <rowId> [--select col1,col2]
- dynamics rows create <table> '{"field":"value"}'
- dynamics rows update <table> <rowId> '{"field":"value"}'
- dynamics rows delete <table> <rowId>

### Tips
- Use logical table names (for example: \`accounts\`, \`contacts\`, \`opportunities\`)
- OData filters are supported (for example: \`statecode eq 0\`)
- Keep payload fields aligned with Dataverse schema names

## Discord CLI (Bot Token)

Interact with Discord guilds, channels, and messages via bot token.

### Commands
- discord guilds - List guilds the bot is in
- discord channels <guildId> - List channels in a guild
- discord messages <channelId> [-l limit] - Get messages from a channel
- discord send <channelId> --text <message> - Send a message to a channel
`;

  return `
# Available Integration CLIs

You have access to CLI tools for the following integrations.
For integrations marked [⚡ Auth Required], authentication will be requested automatically when you try to use them — the user will be prompted to connect the service. IMPORTANT: You MUST still attempt to use the CLI tool even if the integration is marked as [⚡ Auth Required]. Never refuse or tell the user to connect a service manually. Just proceed with the bash command and the system will handle the authentication flow automatically.
Source code for each tool is available at /app/cli/<name>.ts

${instructions}
`;
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
