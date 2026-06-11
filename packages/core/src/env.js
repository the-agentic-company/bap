import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  /**
   * Client-exposed environment variables keep the `NEXT_PUBLIC_` prefix in v1 of the
   * TanStack Start migration. Vite is configured to expose only `VITE_*` and
   * `NEXT_PUBLIC_*` prefixes to the client bundle (see apps/web/vite.config.ts), so this
   * prefix stays valid without renaming public env vars.
   */
  clientPrefix: "NEXT_PUBLIC_",
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET: z.string(),
    APP_URL: z.url().optional(),
    CMDCLAW_DEV_AUTO_LOGIN: z.enum(["0", "1"]).default("0"),
    CMDCLAW_DEV_AUTO_LOGIN_EMAIL: z.email().optional(),
    CMDCLAW_DEFAULT_USER_EMAIL: z.email().optional(),
    CMDCLAW_ADMIN_EMAILS: z.string().optional(),
    CMDCLAW_MCP_BASE_URL: z.url().optional(),
    CMDCLAW_EDITION: z.enum(["cloud", "selfhost"]).default("cloud"),
    CMDCLAW_CLOUD_API_BASE_URL: z.url().optional(),
    CMDCLAW_CLOUD_INSTANCE_API_KEY: z.string().optional(),
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
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    TWITTER_CLIENT_ID: z.string().optional(),
    TWITTER_CLIENT_SECRET: z.string().optional(),
    DISCORD_BOT_TOKEN: z.string().optional(),
    // Unipile (LinkedIn integration)
    UNIPILE_API_KEY: z.string().optional(),
    UNIPILE_DSN: z.string().optional(),
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
    CMDCLAW_SERVER_SECRET: z.string(),
    // Public callback URL for sandbox -> app internal routes (approval/auth)
    E2B_CALLBACK_BASE_URL: z.url().optional(),
    // Dedicated WebSocket server port
    WS_PORT: z.string().default("4097"),
    // S3/MinIO Configuration (AWS SDK generic naming)
    AWS_ENDPOINT_URL: z.url(),
    AWS_DEFAULT_REGION: z.string().default("us-east-1"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_S3_BUCKET_NAME: z.string().default("cmdclaw-documents"),
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
    COMMUNITY_REPO_OWNER: z.string().default("cmdclaw-community"),
    COMMUNITY_REPO_NAME: z.string().default("cmdclaw-community-integrations"),
    WEB_PUSH_VAPID_SUBJECT: z.string().optional(),
    WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
    WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.url().optional(),
    NEXT_PUBLIC_CMDCLAW_EDITION: z.enum(["cloud", "selfhost"]).optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
    NEXT_PUBLIC_ZERO_CACHE_URL: z.url().optional(),
    NEXT_PUBLIC_ZERO_QUERY_URL: z.url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    CMDCLAW_DEV_AUTO_LOGIN: process.env.CMDCLAW_DEV_AUTO_LOGIN,
    CMDCLAW_DEV_AUTO_LOGIN_EMAIL: process.env.CMDCLAW_DEV_AUTO_LOGIN_EMAIL,
    CMDCLAW_DEFAULT_USER_EMAIL: process.env.CMDCLAW_DEFAULT_USER_EMAIL,
    CMDCLAW_ADMIN_EMAILS: process.env.CMDCLAW_ADMIN_EMAILS,
    CMDCLAW_MCP_BASE_URL: process.env.CMDCLAW_MCP_BASE_URL,
    CMDCLAW_EDITION: process.env.CMDCLAW_EDITION,
    CMDCLAW_CLOUD_API_BASE_URL: process.env.CMDCLAW_CLOUD_API_BASE_URL,
    CMDCLAW_CLOUD_INSTANCE_API_KEY: process.env.CMDCLAW_CLOUD_INSTANCE_API_KEY,
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
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID,
    TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    UNIPILE_API_KEY: process.env.UNIPILE_API_KEY,
    UNIPILE_DSN: process.env.UNIPILE_DSN,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
    APPLE_APP_BUNDLE_IDENTIFIER: process.env.APPLE_APP_BUNDLE_IDENTIFIER,
    FAL_KEY: process.env.FAL_KEY,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    CMDCLAW_SERVER_SECRET: process.env.CMDCLAW_SERVER_SECRET ?? process.env.BAP_SERVER_SECRET,
    E2B_CALLBACK_BASE_URL: process.env.E2B_CALLBACK_BASE_URL,
    WS_PORT: process.env.WS_PORT,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
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
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CMDCLAW_EDITION:
      process.env.NEXT_PUBLIC_CMDCLAW_EDITION ?? process.env.CMDCLAW_EDITION,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_ZERO_CACHE_URL: process.env.NEXT_PUBLIC_ZERO_CACHE_URL,
    NEXT_PUBLIC_ZERO_QUERY_URL: process.env.NEXT_PUBLIC_ZERO_QUERY_URL,
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
