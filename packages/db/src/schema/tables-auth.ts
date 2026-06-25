import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  integer,
  date,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { magicLinkRequestStatusEnum, workspaceMembershipRoleEnum } from "./enums";

function revocableTimestampColumns() {
  return {
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  };
}

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  phoneNumber: text("phone_number"),
  timezone: text("timezone"),
  taskDonePushEnabled: boolean("task_done_push_enabled").default(false).notNull(),
  defaultForwardedCoworkerId: text("default_forwarded_coworker_id"),
  activeWorkspaceId: text("active_workspace_id"),
  billingPlanId: text("billing_plan_id").default("free").notNull(),
  autumnCustomerId: text("autumn_customer_id"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  onboardedAt: timestamp("onboarded_at"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const hostedMcpOauthClient = pgTable(
  "hosted_mcp_oauth_client",
  {
    clientId: text("client_id").primaryKey(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").default("none").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    grantTypes: text("grant_types")
      .array()
      .notNull()
      .default(["authorization_code", "refresh_token"]),
    responseTypes: text("response_types").array().notNull().default(["code"]),
    clientName: text("client_name"),
    clientUri: text("client_uri"),
    logoUri: text("logo_uri"),
    contacts: text("contacts").array(),
    policyUri: text("policy_uri"),
    tosUri: text("tos_uri"),
    scope: text("scope"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("hosted_mcp_oauth_client_created_at_idx").on(table.createdAt)],
);

export const hostedMcpOauthGrant = pgTable(
  "hosted_mcp_oauth_grant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clientId: text("client_id")
      .notNull()
      .references(() => hostedMcpOauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    scopes: text("scopes").array().notNull(),
    allowedWorkspaceIds: text("allowed_workspace_ids").array().notNull().default([]),
    allowAllWorkspaces: boolean("allow_all_workspaces").default(false).notNull(),
    ...revocableTimestampColumns(),
  },
  (table) => [
    index("hosted_mcp_oauth_grant_client_idx").on(table.clientId),
    index("hosted_mcp_oauth_grant_user_workspace_idx").on(table.userId, table.workspaceId),
    index("hosted_mcp_oauth_grant_revoked_at_idx").on(table.revokedAt),
  ],
);

export const hostedMcpOauthAuthorizationCode = pgTable(
  "hosted_mcp_oauth_authorization_code",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    codeHash: text("code_hash").notNull().unique(),
    grantId: text("grant_id")
      .notNull()
      .references(() => hostedMcpOauthGrant.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("hosted_mcp_oauth_authorization_code_grant_idx").on(table.grantId),
    index("hosted_mcp_oauth_authorization_code_expires_at_idx").on(table.expiresAt),
  ],
);

export const hostedMcpOauthRefreshToken = pgTable(
  "hosted_mcp_oauth_refresh_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tokenHash: text("token_hash").notNull().unique(),
    grantId: text("grant_id")
      .notNull()
      .references(() => hostedMcpOauthGrant.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => hostedMcpOauthClient.clientId, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    ...revocableTimestampColumns(),
  },
  (table) => [
    index("hosted_mcp_oauth_refresh_token_grant_idx").on(table.grantId),
    index("hosted_mcp_oauth_refresh_token_expires_at_idx").on(table.expiresAt),
    index("hosted_mcp_oauth_refresh_token_revoked_at_idx").on(table.revokedAt),
  ],
);

export const magicLinkRequestState = pgTable(
  "magic_link_request_state",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    callbackUrl: text("callback_url"),
    newUserCallbackUrl: text("new_user_callback_url"),
    errorCallbackUrl: text("error_callback_url"),
    status: magicLinkRequestStatusEnum("status").default("pending").notNull(),
    consumedAt: timestamp("consumed_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("magic_link_request_state_expires_at_idx").on(table.expiresAt)],
);

export const workspace = pgTable(
  "workspace",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug"),
    imageStorageKey: text("image_storage_key"),
    imageMimeType: text("image_mime_type"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    billingPlanId: text("billing_plan_id").default("free").notNull(),
    autumnCustomerId: text("autumn_customer_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("workspace_slug_idx").on(table.slug)],
);

export const workspaceMember = pgTable(
  "workspace_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceMembershipRoleEnum("role").default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_member_workspace_user_idx").on(table.workspaceId, table.userId),
    index("workspace_member_user_idx").on(table.userId),
  ],
);

export const userDailyActivity = pgTable(
  "user_daily_activity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activityDate: date("activity_date").notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    source: text("source").default("web").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_daily_activity_user_date_idx").on(table.userId, table.activityDate),
    index("user_daily_activity_date_idx").on(table.activityDate),
  ],
);

export const webPushSubscription = pgTable(
  "web_push_subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    expirationTime: timestamp("expiration_time"),
    auth: text("auth").notNull(),
    p256dh: text("p256dh").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("web_push_subscription_endpoint_idx").on(table.endpoint),
    index("web_push_subscription_user_id_idx").on(table.userId),
  ],
);

export const googleIntegrationAccessAllowlist = pgTable(
  "google_integration_access_allowlist",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("google_integration_access_allowlist_email_idx").on(table.email)],
);

export const galienWorkspaceAccess = pgTable(
  "galien_workspace_access",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    targetEnv: text("target_env").$type<"prod" | "preprod">().default("prod").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("galien_workspace_access_workspace_idx").on(table.workspaceId),
    uniqueIndex("galien_workspace_access_workspace_email_idx").on(table.workspaceId, table.email),
  ],
);

export const modulrWorkspaceAccess = pgTable(
  "modulr_workspace_access",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("modulr_workspace_access_workspace_idx").on(table.workspaceId),
    uniqueIndex("modulr_workspace_access_workspace_email_idx").on(table.workspaceId, table.email),
  ],
);

export const galienCredential = pgTable(
  "galien_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    password: text("password").notNull(),
    targetEnv: text("target_env").$type<"prod" | "preprod">().default("prod").notNull(),
    galienUserId: integer("galien_user_id"),
    displayName: text("display_name"),
    validatedAt: timestamp("validated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("galien_credential_user_target_env_idx").on(table.userId, table.targetEnv),
    index("galien_credential_galien_user_idx").on(table.galienUserId),
  ],
);

export const approvedLoginEmailAllowlist = pgTable(
  "approved_login_email_allowlist",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("approved_login_email_allowlist_email_idx").on(table.email)],
);

// ========== CHAT SCHEMA ==========

export const providerAuth = pgTable(
  "provider_auth",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "openai" | "google" | "kimi"
    accessToken: text("access_token").notNull(), // encrypted
    refreshToken: text("refresh_token").notNull(), // encrypted
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("provider_auth_user_provider_idx").on(table.provider, table.userId),
    index("provider_auth_user_id_idx").on(table.userId),
  ],
);

export const sharedProviderAuth = pgTable(
  "shared_provider_auth",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    managedByUserId: text("managed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("shared_provider_auth_provider_idx").on(table.provider),
    index("shared_provider_auth_managed_by_user_id_idx").on(table.managedByUserId),
  ],
);

export const cloudAccountLink = pgTable(
  "cloud_account_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cloudUserId: text("cloud_user_id").notNull(),
    status: text("status").default("linked").notNull(),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("cloud_account_link_user_id_idx").on(table.userId),
    index("cloud_account_link_cloud_user_id_idx").on(table.cloudUserId),
  ],
);

export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  clientId: text("client_id"),
  scope: text("scope"),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ========== DEVICE CONNECTION SCHEMA ==========

export const device = pgTable(
  "device",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    isOnline: boolean("is_online").default(false).notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    capabilities: jsonb("capabilities").$type<{
      sandbox: boolean;
      llmProxy: boolean;
      localModels?: string[];
      platform: string;
      arch: string;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("device_user_id_idx").on(table.userId)],
);

export const authSchema = {
  user,
  session,
  account,
  verification,
  deviceCode,
};
