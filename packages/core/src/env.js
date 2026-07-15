import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  /**
   * Client-exposed environment variables use the `VITE_` prefix. Vite is configured to
   * expose only this prefix to the client bundle (see apps/web/vite.config.ts).
   */
  clientPrefix: "VITE_",
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET: z.string(),
    APP_URL: z.url().optional(),
    APP_DEV_AUTO_LOGIN: z.enum(["0", "1"]).default("0"),
    APP_DEV_AUTO_LOGIN_EMAIL: z.email().optional(),
    APP_DEFAULT_USER_EMAIL: z.email().optional(),
    APP_ADMIN_EMAILS: z.string().optional(),
    APP_MCP_BASE_URL: z.url().optional(),
    APP_EDITION: z.enum(["cloud", "selfhost"]).default("cloud"),
    APP_CLOUD_API_BASE_URL: z.url().optional(),
    APP_CLOUD_INSTANCE_API_KEY: z.string().optional(),
    REMOTE_INTEGRATION_STAGING_BASE_URL: z.url().optional(),
    REMOTE_INTEGRATION_PROD_BASE_URL: z.url().optional(),
    DATABASE_URL: z.url(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    RESEND_RECEIVING_DOMAIN: z.string().optional(),
    EMAIL_FROM: z.email().optional(),
    REDIS_URL: z.url(),
    OPENAI_API_KEY: z.string(),
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().optional(),
    // Anthropic
    ANTHROPIC_API_KEY: z.string().optional(),
    // E2B Sandbox
    E2B_API_KEY: z.string().optional(),
    E2B_DAYTONA_SANDBOX_NAME: z.string().optional(),
    SANDBOX_DEFAULT: z.enum(["daytona", "e2b", "docker"]),
    DAYTONA_API_KEY: z.string().optional(),
    DAYTONA_API_URL: z.url().optional(),
    DAYTONA_TARGET: z.string().optional(),
    ANVIL_API_KEY: z.string().optional(),
    // OAuth credentials
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    NOTION_CLIENT_ID: z.string().optional(),
    NOTION_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    AIRTABLE_CLIENT_ID: z.string().optional(),
    AIRTABLE_CLIENT_SECRET: z.string().optional(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    HUBSPOT_CLIENT_ID: z.string().optional(),
    HUBSPOT_CLIENT_SECRET: z.string().optional(),
    SALESFORCE_CLIENT_ID: z.string().optional(),
    SALESFORCE_CLIENT_SECRET: z.string().optional(),
    DISCORD_BOT_TOKEN: z.string().optional(),
    // Unipile (LinkedIn integration)
    UNIPILE_API_KEY: z.string().optional(),
    UNIPILE_DSN: z.string().optional(),
    // Agentic Audit scrapers (optional; mock fallback when unset)
    FIRECRAWL_API_KEY: z.string().optional(),
    APIFY_API_TOKEN: z.string().optional(),
    // Apple Sign In
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_SECRET: z.string().optional(),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),
    // Fal.ai
    FAL_KEY: z.string().optional(),
    // Deepgram
    DEEPGRAM_API_KEY: z.string().optional(),
    // Gemini (title generation)
    GEMINI_API_KEY: z.string().optional(),
    // Encryption key for provider OAuth tokens (32-byte hex string)
    ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    // OpenCode plugin callback secret
    APP_SERVER_SECRET: z.string(),
    // Public callback URL for sandbox -> app internal routes (approval/auth)
    E2B_CALLBACK_BASE_URL: z.url().optional(),
    // Dedicated WebSocket server port
    WS_PORT: z.string().default("4097"),
    // S3/MinIO Configuration (AWS SDK generic naming)
    AWS_ENDPOINT_URL: z.url(),
    AWS_INTERNAL_ENDPOINT_URL: z.url().optional(),
    AWS_DEFAULT_REGION: z.string().default("us-east-1"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_S3_BUCKET_NAME: z.string().default("bap-documents"),
    AWS_S3_FORCE_PATH_STYLE: z
      .string()
      .transform((v) => v === "true")
      .default("true"),
    // Autumn (Billing)
    AUTUMN_SECRET_KEY: z.string().optional(),
    // Slack Bot
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_BOT_OWNER_USER_ID: z.string().optional(),
    SLACK_BOT_RELAY_SECRET: z.string().optional(),
    SLACK_BOT_RELAY_ALLOWED_CHANNELS: z.string().optional(),
    // Linear operational failure alerts
    LINEAR_API_KEY: z.string().optional(),
    LINEAR_TEAM_KEY: z.string().optional(),
    LINEAR_PROJECT_ID: z.string().optional(),
    LINEAR_PROJECT_NAME: z.string().optional(),
    LINEAR_ASSIGNEE_ID: z.string().optional(),
    LINEAR_ASSIGNEE_EMAIL: z.email().optional(),
    LINEAR_FAILURE_ALERT_ENV: z.string().optional(),
    LINEAR_FAILURE_ALERT_LABELS: z.string().optional(),
    // Community Integration Repo
    COMMUNITY_REPO_GITHUB_TOKEN: z.string().optional(),
    COMMUNITY_REPO_OWNER: z.string().default("bap-community"),
    COMMUNITY_REPO_NAME: z.string().default("bap-community-integrations"),
    WEB_PUSH_VAPID_SUBJECT: z.string().optional(),
    WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
    WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `VITE_`.
   */
  client: {
    VITE_APP_URL: z.url().optional(),
    VITE_APP_EDITION: z.enum(["cloud", "selfhost"]).optional(),
    VITE_POSTHOG_KEY: z.string().optional(),
    VITE_POSTHOG_HOST: z.string().optional(),
    VITE_ZERO_CACHE_URL: z.url().optional(),
    VITE_ZERO_QUERY_URL: z.url().optional(),
  },

  /**
   * Keep runtime env access explicit so client-side bundles never receive unvalidated server
   * values.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    APP_DEV_AUTO_LOGIN: process.env.APP_DEV_AUTO_LOGIN,
    APP_DEV_AUTO_LOGIN_EMAIL: process.env.APP_DEV_AUTO_LOGIN_EMAIL,
    APP_DEFAULT_USER_EMAIL: process.env.APP_DEFAULT_USER_EMAIL,
    APP_ADMIN_EMAILS: process.env.APP_ADMIN_EMAILS,
    APP_MCP_BASE_URL: process.env.APP_MCP_BASE_URL,
    APP_EDITION: process.env.APP_EDITION,
    APP_CLOUD_API_BASE_URL: process.env.APP_CLOUD_API_BASE_URL,
    APP_CLOUD_INSTANCE_API_KEY: process.env.APP_CLOUD_INSTANCE_API_KEY,
    REMOTE_INTEGRATION_STAGING_BASE_URL: process.env.REMOTE_INTEGRATION_STAGING_BASE_URL,
    REMOTE_INTEGRATION_PROD_BASE_URL: process.env.REMOTE_INTEGRATION_PROD_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    RESEND_RECEIVING_DOMAIN: process.env.RESEND_RECEIVING_DOMAIN,
    EMAIL_FROM: process.env.EMAIL_FROM,
    REDIS_URL: process.env.REDIS_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    E2B_API_KEY: process.env.E2B_API_KEY,
    E2B_DAYTONA_SANDBOX_NAME: process.env.E2B_DAYTONA_SANDBOX_NAME,
    SANDBOX_DEFAULT: process.env.SANDBOX_DEFAULT,
    DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
    DAYTONA_API_URL: process.env.DAYTONA_API_URL,
    DAYTONA_TARGET: process.env.DAYTONA_TARGET,
    ANVIL_API_KEY: process.env.ANVIL_API_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    AIRTABLE_CLIENT_ID: process.env.AIRTABLE_CLIENT_ID,
    AIRTABLE_CLIENT_SECRET: process.env.AIRTABLE_CLIENT_SECRET,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET,
    SALESFORCE_CLIENT_ID: process.env.SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET: process.env.SALESFORCE_CLIENT_SECRET,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    UNIPILE_API_KEY: process.env.UNIPILE_API_KEY,
    UNIPILE_DSN: process.env.UNIPILE_DSN,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
    APPLE_APP_BUNDLE_IDENTIFIER: process.env.APPLE_APP_BUNDLE_IDENTIFIER,
    FAL_KEY: process.env.FAL_KEY,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    APP_SERVER_SECRET: process.env.APP_SERVER_SECRET,
    E2B_CALLBACK_BASE_URL: process.env.E2B_CALLBACK_BASE_URL,
    WS_PORT: process.env.WS_PORT,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
    AWS_INTERNAL_ENDPOINT_URL: process.env.AWS_INTERNAL_ENDPOINT_URL,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
    AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE,
    AUTUMN_SECRET_KEY: process.env.AUTUMN_SECRET_KEY,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_BOT_OWNER_USER_ID: process.env.SLACK_BOT_OWNER_USER_ID,
    SLACK_BOT_RELAY_SECRET: process.env.SLACK_BOT_RELAY_SECRET,
    SLACK_BOT_RELAY_ALLOWED_CHANNELS: process.env.SLACK_BOT_RELAY_ALLOWED_CHANNELS,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    LINEAR_TEAM_KEY: process.env.LINEAR_TEAM_KEY,
    LINEAR_PROJECT_ID: process.env.LINEAR_PROJECT_ID,
    LINEAR_PROJECT_NAME: process.env.LINEAR_PROJECT_NAME,
    LINEAR_ASSIGNEE_ID: process.env.LINEAR_ASSIGNEE_ID,
    LINEAR_ASSIGNEE_EMAIL: process.env.LINEAR_ASSIGNEE_EMAIL,
    LINEAR_FAILURE_ALERT_ENV: process.env.LINEAR_FAILURE_ALERT_ENV,
    LINEAR_FAILURE_ALERT_LABELS: process.env.LINEAR_FAILURE_ALERT_LABELS,
    COMMUNITY_REPO_GITHUB_TOKEN: process.env.COMMUNITY_REPO_GITHUB_TOKEN,
    COMMUNITY_REPO_OWNER: process.env.COMMUNITY_REPO_OWNER,
    COMMUNITY_REPO_NAME: process.env.COMMUNITY_REPO_NAME,
    WEB_PUSH_VAPID_SUBJECT: process.env.WEB_PUSH_VAPID_SUBJECT,
    WEB_PUSH_VAPID_PUBLIC_KEY: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    WEB_PUSH_VAPID_PRIVATE_KEY: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    VITE_APP_URL: process.env.VITE_APP_URL,
    VITE_APP_EDITION: process.env.VITE_APP_EDITION ?? process.env.APP_EDITION,
    VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY,
    VITE_POSTHOG_HOST: process.env.VITE_POSTHOG_HOST,
    VITE_ZERO_CACHE_URL: process.env.VITE_ZERO_CACHE_URL,
    VITE_ZERO_QUERY_URL: process.env.VITE_ZERO_QUERY_URL,
  },
  onValidationError: (issues) => {
    const formattedIssues = issues.map((issue) => {
      const path = Array.isArray(issue.path)
        ? issue.path
            .map((segment) => {
              if (typeof segment === "string" || typeof segment === "number") {
                return String(segment);
              }

              const key = segment?.key;
              return typeof key === "string" || typeof key === "number" ? String(key) : null;
            })
            .filter(Boolean)
            .join(".")
        : "";

      const label = path || "unknown";
      return `${label}: ${issue.message}`;
    });

    console.error("❌ Invalid environment variables:", formattedIssues);
    throw new Error(`Invalid environment variables: ${formattedIssues.join("; ")}`);
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
