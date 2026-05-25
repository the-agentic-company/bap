import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  integer,
  date,
  vector,
  pgEnum,
  unique,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type {
  TemplateCatalogConnectedApp,
  TemplateCatalogSummaryBlock,
  TemplateIntegrationType,
  TemplateTriggerType,
} from "./template-catalog";

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
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
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
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("hosted_mcp_oauth_refresh_token_grant_idx").on(table.grantId),
    index("hosted_mcp_oauth_refresh_token_expires_at_idx").on(table.expiresAt),
    index("hosted_mcp_oauth_refresh_token_revoked_at_idx").on(table.revokedAt),
  ],
);

export const magicLinkRequestStatusEnum = pgEnum("magic_link_request_status", [
  "pending",
  "consumed",
]);

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

export const workspaceMembershipRoleEnum = pgEnum("workspace_membership_role", [
  "owner",
  "admin",
  "member",
]);

export const billingOwnerTypeEnum = pgEnum("billing_owner_type", ["user", "workspace"]);
export const providerAuthSourceEnum = pgEnum("provider_auth_source", ["user", "shared"]);
export const executorSourceKindEnum = pgEnum("executor_source_kind", ["mcp", "openapi"]);
export const executorSourceAuthTypeEnum = pgEnum("executor_source_auth_type", [
  "none",
  "api_key",
  "bearer",
  "oauth2",
]);
export const inboxItemKindEnum = pgEnum("inbox_item_kind", ["coworker", "chat"]);

export const workspace = pgTable(
  "workspace",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug"),
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

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  dailyActivities: many(userDailyActivity),
  webPushSubscriptions: many(webPushSubscription),
  workspacesCreated: many(workspace),
  workspaceMemberships: many(workspaceMember),
  conversations: many(conversation),
  billingLedgers: many(billingLedger),
  integrations: many(integration),
  skills: many(skill),
  memoryFiles: many(memoryFile),
  memoryEntries: many(memoryEntry),
  memoryChunks: many(memoryChunk),
  memorySettings: many(memorySettings),
  coworkers: many(coworker),
  providerAuths: many(providerAuth),
  sharedProviderAuthsManaged: many(sharedProviderAuth),
  cloudAccountLinks: many(cloudAccountLink),
  devices: many(device),
  customIntegrations: many(customIntegration),
  customIntegrationCredentials: many(customIntegrationCredential),
  executorSourcesCreated: many(workspaceExecutorSource, {
    relationName: "workspaceExecutorSourceCreatedByUser",
  }),
  executorSourcesUpdated: many(workspaceExecutorSource, {
    relationName: "workspaceExecutorSourceUpdatedByUser",
  }),
  executorSourceCredentials: many(workspaceExecutorSourceCredential),
  integrationSkillsCreated: many(integrationSkill),
  integrationSkillPreferences: many(integrationSkillPreference),
  whatsappLinks: many(whatsappUserLink),
  whatsappConversations: many(whatsappConversation),
  whatsappLinkCodes: many(whatsappLinkCode),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  createdByUser: one(user, {
    fields: [workspace.createdByUserId],
    references: [user.id],
  }),
  members: many(workspaceMember),
  conversations: many(conversation),
  billingLedgers: many(billingLedger),
  billingTopUps: many(billingTopUp),
  skills: many(skill),
  executorSources: many(workspaceExecutorSource),
  executorPackages: many(workspaceExecutorPackage),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceMember.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceMember.userId],
    references: [user.id],
  }),
}));

export const userDailyActivityRelations = relations(userDailyActivity, ({ one }) => ({
  user: one(user, {
    fields: [userDailyActivity.userId],
    references: [user.id],
  }),
}));

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

export const webPushSubscriptionRelations = relations(webPushSubscription, ({ one }) => ({
  user: one(user, {
    fields: [webPushSubscription.userId],
    references: [user.id],
  }),
}));

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
    uniqueIndex("galien_credential_user_idx").on(table.userId),
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

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

export const generationStatusEnum = pgEnum("generation_status", [
  "idle",
  "generating",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "complete",
  "error",
]);

export const generationRecordStatusEnum = pgEnum("generation_record_status", [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "completed",
  "cancelled",
  "error",
]);

export const generationInterruptKindEnum = pgEnum("generation_interrupt_kind", [
  "plugin_write",
  "runtime_permission",
  "runtime_question",
  "auth",
]);

export const generationInterruptStatusEnum = pgEnum("generation_interrupt_status", [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
]);

export const conversationRuntimeStatusEnum = pgEnum("conversation_runtime_status", [
  "active",
  "recycled",
  "dead",
]);

export const conversationTypeEnum = pgEnum("conversation_type", ["chat", "coworker"]);
export type SyntheticTrafficKind = "slo_replay";

export const conversation = pgTable(
  "conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),
    type: conversationTypeEnum("type").default("chat").notNull(),
    title: text("title").default("New conversation"),
    sandboxLastUserVisibleActionAt: timestamp("sandbox_last_user_visible_action_at"),
    // Last resolved sandbox provider used for this conversation
    lastSandboxProvider: text("last_sandbox_provider"),
    // Last resolved runtime harness used for this conversation
    lastRuntimeHarness: text("last_runtime_harness"),
    model: text("model").default("claude-sonnet-4-6"),
    authSource: providerAuthSourceEnum("auth_source"),
    // Generation tracking
    generationStatus: generationStatusEnum("generation_status").default("idle").notNull(),
    currentGenerationId: text("current_generation_id"),
    // Auto-approve sensitive operations without user confirmation
    autoApprove: boolean("auto_approve").default(false).notNull(),
    // Number of messages this user has acknowledged in the sidebar
    seenMessageCount: integer("seen_message_count").default(0).notNull(),
    // Conversation-level usage counters persisted for direct querying.
    usageInputTokens: integer("usage_input_tokens").default(0).notNull(),
    usageOutputTokens: integer("usage_output_tokens").default(0).notNull(),
    usageTotalTokens: integer("usage_total_tokens").default(0).notNull(),
    usageAssistantMessageCount: integer("usage_assistant_message_count").default(0).notNull(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    isShared: boolean("is_shared").default(false).notNull(),
    shareToken: text("share_token"),
    sharedAt: timestamp("shared_at"),
    syntheticKind: text("synthetic_kind").$type<SyntheticTrafficKind>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("conversation_user_id_idx").on(table.userId),
    index("conversation_workspace_id_idx").on(table.workspaceId),
    index("conversation_created_at_idx").on(table.createdAt),
    index("conversation_synthetic_kind_idx").on(table.syntheticKind),
    uniqueIndex("conversation_share_token_idx").on(table.shareToken),
  ],
);

export const conversationRuntime = pgTable(
  "conversation_runtime",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    callbackToken: text("callback_token").notNull(),
    sandboxProvider: text("sandbox_provider"),
    runtimeHarness: text("runtime_harness"),
    runtimeProtocolVersion: text("runtime_protocol_version"),
    sandboxId: text("sandbox_id"),
    sessionId: text("session_id"),
    status: conversationRuntimeStatusEnum("status").default("active").notNull(),
    activeGenerationId: text("active_generation_id").references((): AnyPgColumn => generation.id, {
      onDelete: "set null",
    }),
    activeTurnSeq: integer("active_turn_seq").default(0).notNull(),
    lastBoundAt: timestamp("last_bound_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_runtime_conversation_id_idx").on(table.conversationId),
    uniqueIndex("conversation_runtime_callback_token_idx").on(table.callbackToken),
    index("conversation_runtime_status_idx").on(table.status),
    index("conversation_runtime_active_generation_id_idx").on(table.activeGenerationId),
  ],
);

export const conversationSessionSnapshot = pgTable(
  "conversation_session_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    storageKey: text("storage_key").notNull(),
    exportedAt: timestamp("exported_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_session_snapshot_conversation_id_idx").on(table.conversationId),
    index("conversation_session_snapshot_exported_at_idx").on(table.exportedAt),
  ],
);

// Content part types for interleaved message structure
export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | {
      type: "approval";
      tool_use_id: string;
      tool_name: string;
      tool_input: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
      question_answers?: string[][];
    }
  | {
      type: "coworker_invocation";
      coworker_id: string;
      username: string;
      name: string;
      run_id: string;
      conversation_id: string;
      generation_id: string;
      status:
        | "running"
        | "awaiting_approval"
        | "awaiting_auth"
        | "completed"
        | "error"
        | "cancelled";
      attachment_names?: string[];
      message: string;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

export type MessageTiming = {
  sandboxStartupDurationMs?: number;
  sandboxStartupMode?: "created" | "reused" | "unknown";
  generationDurationMs?: number;
  phaseDurationsMs?: {
    // Time spent connecting to a reusable sandbox or creating a new sandbox.
    sandboxConnectOrCreateMs?: number;
    // Time from starting the runtime server inside sandbox to runtime readiness.
    opencodeReadyMs?: number;
    // Time to reuse/create an OpenCode session after sandbox is ready.
    sessionReadyMs?: number;
    // Total agent initialization time (sandbox + runtime + session setup).
    agentInitMs?: number;
    // Time spent in pre-prompt setup before prompt dispatch (skills/memory/instructions prep).
    prePromptSetupMs?: number;
    // Time spent syncing memory files into the sandbox before prompt dispatch.
    prePromptMemorySyncMs?: number;
    // Time spent writing runtime callback/context metadata into the sandbox.
    prePromptRuntimeContextWriteMs?: number;
    // Time spent preparing the sandbox-local executor and its source configuration.
    prePromptExecutorPrepareMs?: number;
    // Time spent loading executor bootstrap config and OAuth bootstrap sources.
    prePromptExecutorBootstrapLoadMs?: number;
    // Time spent writing executor config/state files into the sandbox.
    prePromptExecutorConfigWriteMs?: number;
    // Time spent probing whether the sandbox-local executor server is already reachable.
    prePromptExecutorServerProbeMs?: number;
    // Time spent waiting for the sandbox-local executor server to become ready.
    prePromptExecutorServerWaitReadyMs?: number;
    // Time spent validating the executor server with a live status call.
    prePromptExecutorStatusCheckMs?: number;
    // Time spent reconciling native MCP OAuth sources inside the sandbox-local executor.
    prePromptExecutorOauthReconcileMs?: number;
    // Time spent loading enabled skill metadata and custom integration credentials.
    prePromptSkillsAndCredsLoadMs?: number;
    // Time spent reading the reusable sandbox pre-prompt cache.
    prePromptCacheReadMs?: number;
    // Time spent writing custom skills into the sandbox.
    prePromptSkillsWriteMs?: number;
    // Time spent writing generated custom integration CLI files into the sandbox.
    prePromptCustomIntegrationCliWriteMs?: number;
    // Time spent configuring custom integration permissions inside the sandbox.
    prePromptCustomIntegrationPermissionsWriteMs?: number;
    // Time spent writing integration skills into the sandbox.
    prePromptIntegrationSkillsWriteMs?: number;
    // Time spent writing the reusable sandbox pre-prompt cache.
    prePromptCacheWriteMs?: number;
    // Time spent composing the final prompt spec after sandbox preparation.
    prePromptPromptSpecComposeMs?: number;
    // Time spent subscribing to runtime events before prompt dispatch.
    prePromptEventStreamSubscribeMs?: number;
    // Time spent staging coworker documents into the sandbox.
    prePromptCoworkerDocsStageMs?: number;
    // Time spent staging user attachments into the sandbox and prompt parts.
    prePromptAttachmentsStageMs?: number;
    // Time from prompt dispatch to first received generation stream event.
    waitForFirstEventMs?: number;
    // Time from prompt dispatch to first emitted assistant text token.
    promptToFirstTokenMs?: number;
    // Time from generation start to first emitted assistant text token.
    generationToFirstTokenMs?: number;
    // Time from prompt dispatch to first user-visible output (thinking or text).
    promptToFirstVisibleOutputMs?: number;
    // Time from generation start to first user-visible output (thinking or text).
    generationToFirstVisibleOutputMs?: number;
    // Time spent streaming model output after first event until session becomes idle.
    modelStreamMs?: number;
    // Time spent after model output completes (file collection, persistence, cleanup).
    postProcessingMs?: number;
  };
  phaseTimestamps?: Array<{
    phase: string;
    at: string;
    elapsedMs: number;
  }>;
};

export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // Interleaved content parts (text/tool_use/tool_result)
    contentParts: jsonb("content_parts").$type<ContentPart[]>(),
    // Optional timing metrics for assistant generations
    timing: jsonb("timing").$type<MessageTiming>(),
    // Token usage for cost tracking
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Parent message for threading tool responses
    parentMessageId: text("parent_message_id"),
    // OpenCode message ID for checkpointing
    opencodeMessageId: text("opencode_message_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_conversation_id_idx").on(table.conversationId),
    index("message_created_at_idx").on(table.createdAt),
  ],
);

// Approval state stored in generation
export type PendingApproval = {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestedAt: string;
  expiresAt?: string;
  integration: string;
  operation: string;
  command?: string;
  decision?: "allow" | "deny";
  questionAnswers?: string[][];
  opencodeRequestKind?: "permission" | "question";
  opencodeRequestId?: string;
  opencodeDefaultAnswers?: string[][];
};

// Auth state stored in generation
export type PendingAuth = {
  integrations: string[]; // Integration types needed
  connectedIntegrations: string[]; // Already connected during this request
  requestedAt: string;
  expiresAt?: string;
  reason?: string;
};

export type GenerationExecutionPolicy = {
  allowedIntegrations?: string[];
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: {
    targetEnv: "staging" | "prod";
    remoteUserId: string;
    requestedByUserId?: string;
    requestedByEmail?: string | null;
    remoteUserEmail?: string | null;
  };
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  allowSnapshotRestoreOnRun?: boolean;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  queuedFileAttachments?: Array<{
    name: string;
    mimeType: string;
    dataUrl: string;
  }>;
};

export type QueuedMessageAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type GenerationInterruptDisplay = {
  title: string;
  integration?: string;
  operation?: string;
  command?: string;
  toolInput?: Record<string, unknown>;
  runtimeTool?: {
    sessionId?: string;
    messageId: string;
    partId: string;
    callId: string;
    toolName: string;
    input: Record<string, unknown>;
  };
  questionSpec?: {
    questions: Array<{
      header: string;
      question: string;
      options: Array<{
        label: string;
        description?: string;
      }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
  };
  authSpec?: {
    integrations: string[];
    reason?: string;
  };
};

export type GenerationInterruptResponsePayload = {
  questionAnswers?: string[][];
  connectedIntegrations?: string[];
  tokens?: Record<string, string>;
  integration?: string;
};

export const generation = pgTable(
  "generation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id").references((): AnyPgColumn => conversationRuntime.id, {
      onDelete: "set null",
    }),
    // Set when message is saved on completion
    messageId: text("message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    status: generationRecordStatusEnum("status").default("running").notNull(),
    // Partial content (updated periodically during generation)
    contentParts: jsonb("content_parts").$type<ContentPart[]>(),
    // Approval state
    pendingApproval: jsonb("pending_approval").$type<PendingApproval>(),
    // Auth state
    pendingAuth: jsonb("pending_auth").$type<PendingAuth>(),
    // Execution policy snapshot for durable worker restarts
    executionPolicy: jsonb("execution_policy").$type<GenerationExecutionPolicy>(),
    // E2B state
    sandboxId: text("sandbox_id"),
    // Resolved execution metadata for deterministic resume/debugging
    sandboxProvider: text("sandbox_provider"),
    runtimeHarness: text("runtime_harness"),
    runtimeProtocolVersion: text("runtime_protocol_version"),
    isPaused: boolean("is_paused").default(false).notNull(),
    deadlineAt: timestamp("deadline_at")
      .default(sql`now() + interval '15 minutes'`)
      .notNull(),
    remainingRunMs: integer("remaining_run_ms")
      .default(15 * 60 * 1000)
      .notNull(),
    suspendedAt: timestamp("suspended_at"),
    resumeInterruptId: text("resume_interrupt_id"),
    lastRuntimeEventAt: timestamp("last_runtime_event_at").defaultNow().notNull(),
    recoveryAttempts: integer("recovery_attempts").default(0).notNull(),
    completionReason: text("completion_reason"),
    // Metadata
    errorMessage: text("error_message"),
    debugInfo: jsonb("debug_info").$type<Record<string, unknown>>(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    traceId: text("trace_id"),
    terminalCanonicalEventEmittedAt: timestamp("terminal_canonical_event_emitted_at"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("generation_conversation_id_idx").on(table.conversationId),
    index("generation_runtime_id_idx").on(table.runtimeId),
    index("generation_status_idx").on(table.status),
  ],
);

export const generationInterrupt = pgTable(
  "generation_interrupt",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    generationId: text("generation_id")
      .notNull()
      .references(() => generation.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id").references((): AnyPgColumn => conversationRuntime.id, {
      onDelete: "cascade",
    }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    kind: generationInterruptKindEnum("kind").notNull(),
    status: generationInterruptStatusEnum("status").default("pending").notNull(),
    display: jsonb("display").$type<GenerationInterruptDisplay>().notNull(),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    providerToolUseId: text("provider_tool_use_id").notNull(),
    turnSeq: integer("turn_seq"),
    responsePayload: jsonb("response_payload").$type<GenerationInterruptResponsePayload>(),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    resolvedAt: timestamp("resolved_at"),
    appliedAt: timestamp("applied_at"),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("generation_interrupt_generation_id_idx").on(table.generationId),
    index("generation_interrupt_runtime_id_idx").on(table.runtimeId),
    index("generation_interrupt_conversation_id_idx").on(table.conversationId),
    index("generation_interrupt_status_idx").on(table.status),
    uniqueIndex("generation_interrupt_provider_tool_use_id_idx").on(table.providerToolUseId),
  ],
);

export const billingLedger = pgTable(
  "billing_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    generationId: text("generation_id").references(() => generation.id, {
      onDelete: "set null",
    }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    ownerType: billingOwnerTypeEnum("owner_type").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    autumnCustomerId: text("autumn_customer_id").notNull(),
    planId: text("plan_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    sandboxRuntimeMs: integer("sandbox_runtime_ms").default(0).notNull(),
    creditsCharged: integer("credits_charged").default(0).notNull(),
    autumnTrackCode: text("autumn_track_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("billing_ledger_generation_id_idx").on(table.generationId),
    index("billing_ledger_user_id_idx").on(table.userId),
    index("billing_ledger_workspace_id_idx").on(table.workspaceId),
    index("billing_ledger_conversation_id_idx").on(table.conversationId),
  ],
);

export const billingTopUp = pgTable(
  "billing_top_up",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerType: billingOwnerTypeEnum("owner_type").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    usdAmount: integer("usd_amount").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    autumnCustomerId: text("autumn_customer_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("billing_top_up_user_id_idx").on(table.userId),
    index("billing_top_up_workspace_id_idx").on(table.workspaceId),
    index("billing_top_up_granted_by_idx").on(table.grantedByUserId),
  ],
);

export const conversationQueuedMessageStatusEnum = pgEnum("conversation_queued_message_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

export const conversationQueuedMessage = pgTable(
  "conversation_queued_message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    fileAttachments: jsonb("file_attachments").$type<QueuedMessageAttachment[]>(),
    selectedPlatformSkillSlugs: jsonb("selected_platform_skill_slugs").$type<string[]>(),
    status: conversationQueuedMessageStatusEnum("status").default("queued").notNull(),
    generationId: text("generation_id").references(() => generation.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    processingStartedAt: timestamp("processing_started_at"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("conversation_queued_message_conversation_id_idx").on(table.conversationId),
    index("conversation_queued_message_user_id_idx").on(table.userId),
    index("conversation_queued_message_status_idx").on(table.status),
    index("conversation_queued_message_created_at_idx").on(table.createdAt),
  ],
);

// ========== INTEGRATION TYPE ENUM ==========
// Defined early because coworker schema depends on it

export const integrationTypeEnum = pgEnum("integration_type", [
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

export const integrationAuthStatusEnum = pgEnum("integration_auth_status", [
  "connected",
  "reauth_required",
  "transient_error",
]);

// ========== COWORKER SCHEMA ==========

export const coworkerStatusEnum = pgEnum("coworker_status", ["on", "off"]);
export const coworkerToolAccessModeEnum = pgEnum("coworker_tool_access_mode", ["all", "selected"]);

export const coworkerRunStatusEnum = pgEnum("coworker_run_status", [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "completed",
  "error",
  "cancelled",
]);
export type SloReplayJourney =
  | "chat"
  | "coworker_builder"
  | "coworker_run"
  | "unknown_coworker_generation";
export type SloReplayStatus = "pending" | "running" | "completed" | "error" | "setup_failed";
export const coworkerEmailAliasStatusEnum = pgEnum("coworker_email_alias_status", [
  "active",
  "disabled",
  "rotated",
  "deleted",
]);

export const coworker = pgTable(
  "coworker",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),
    status: coworkerStatusEnum("status").default("on").notNull(),
    triggerType: text("trigger_type").notNull(),
    prompt: text("prompt").notNull(),
    model: text("model").default("anthropic/claude-sonnet-4-6").notNull(),
    authSource: providerAuthSourceEnum("auth_source"),
    description: text("description"),
    username: text("username"),
    promptDo: text("prompt_do"),
    promptDont: text("prompt_dont"),
    autoApprove: boolean("auto_approve").default(true).notNull(),
    toolAccessMode: coworkerToolAccessModeEnum("tool_access_mode"),
    allowedIntegrations: integrationTypeEnum("allowed_integrations").array().notNull(),
    allowedCustomIntegrations: text("allowed_custom_integrations").array().notNull().default([]),
    allowedExecutorSourceIds: text("allowed_executor_source_ids").array().notNull().default([]),
    allowedSkillSlugs: text("allowed_skill_slugs").array().notNull().default([]),
    // Schedule configuration for time-based triggers (JSON object)
    schedule: jsonb("schedule"),
    // Builder conversation for the coworker editor chat panel
    builderConversationId: text("builder_conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    isPinned: boolean("is_pinned").default(false).notNull(),
    sharedAt: timestamp("shared_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("coworker_owner_id_idx").on(table.ownerId),
    index("coworker_workspace_id_idx").on(table.workspaceId),
    index("coworker_status_idx").on(table.status),
    index("coworker_shared_at_idx").on(table.sharedAt),
    uniqueIndex("coworker_username_idx").on(table.username),
  ],
);

export const orgChartNode = pgTable(
  "org_chart_node",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "coworker" | "label"
    coworkerId: text("coworker_id").references(() => coworker.id, { onDelete: "cascade" }),
    label: text("label"),
    positionX: integer("position_x").notNull().default(0),
    positionY: integer("position_y").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("org_chart_node_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("org_chart_node_workspace_coworker_idx").on(table.workspaceId, table.coworkerId),
  ],
);

export const coworkerRun = pgTable(
  "coworker_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => coworker.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    status: coworkerRunStatusEnum("status").default("running").notNull(),
    triggerPayload: jsonb("trigger_payload").notNull(),
    generationId: text("generation_id").references(() => generation.id, {
      onDelete: "set null",
    }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    errorMessage: text("error_message"),
    debugInfo: jsonb("debug_info").$type<Record<string, unknown>>(),
    syntheticKind: text("synthetic_kind").$type<SyntheticTrafficKind>(),
  },
  (table) => [
    index("coworker_run_coworker_id_idx").on(table.coworkerId),
    index("coworker_run_owner_id_idx").on(table.ownerId),
    index("coworker_run_workspace_id_idx").on(table.workspaceId),
    index("coworker_run_status_idx").on(table.status),
    index("coworker_run_started_at_idx").on(table.startedAt),
    index("coworker_run_conversation_id_idx").on(table.conversationId),
    index("coworker_run_synthetic_kind_idx").on(table.syntheticKind),
  ],
);

export const sloReplayRun = pgTable(
  "slo_replay_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    journey: text("journey").$type<SloReplayJourney>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    configHash: text("config_hash").notNull(),
    targetEnv: text("target_env").notNull(),
    targetUserEmail: text("target_user_email").notNull(),
    targetUserId: text("target_user_id"),
    sourceGenerationIds: text("source_generation_ids")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    sourceCoworkerRunIds: text("source_coworker_run_ids")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    resultGenerationId: text("result_generation_id").references(() => generation.id, {
      onDelete: "set null",
    }),
    resultCoworkerRunId: text("result_coworker_run_id").references(() => coworkerRun.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<SloReplayStatus>().default("pending").notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("slo_replay_run_dedupe_config_idx").on(table.dedupeKey, table.configHash),
    index("slo_replay_run_status_idx").on(table.status),
    index("slo_replay_run_target_env_idx").on(table.targetEnv),
    index("slo_replay_run_journey_idx").on(table.journey),
    index("slo_replay_run_result_generation_idx").on(table.resultGenerationId),
    index("slo_replay_run_result_coworker_run_idx").on(table.resultCoworkerRunId),
  ],
);

export const coworkerDocument = pgTable(
  "coworker_document",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => coworker.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("coworker_document_coworker_id_idx").on(table.coworkerId)],
);

export const coworkerEmailAlias = pgTable(
  "coworker_email_alias",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => coworker.id, { onDelete: "cascade" }),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    status: coworkerEmailAliasStatusEnum("status").default("active").notNull(),
    replacedByAliasId: text("replaced_by_alias_id"),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    disabledAt: timestamp("disabled_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("coworker_email_alias_coworker_id_idx").on(table.coworkerId),
    index("coworker_email_alias_status_idx").on(table.status),
    uniqueIndex("coworker_email_alias_address_idx").on(table.localPart, table.domain),
  ],
);

export const coworkerRunEvent = pgTable(
  "coworker_run_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coworkerRunId: text("coworker_run_id")
      .notNull()
      .references(() => coworkerRun.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("coworker_run_event_run_id_idx").on(table.coworkerRunId)],
);

// ========== COWORKER TAGS & VIEWS ==========

export const coworkerTag = pgTable(
  "coworker_tag",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("coworker_tag_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("coworker_tag_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export type FailureAlertKind = "chat" | "coworker";
export type FailureAlertStatus = "open" | "resolved" | "ignored";

export const failureAlertGroup = pgTable(
  "failure_alert_group",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    signatureHash: text("signature_hash").notNull(),
    environment: text("environment").notNull(),
    kind: text("kind").$type<FailureAlertKind>().notNull(),
    journey: text("journey").notNull(),
    completionReason: text("completion_reason"),
    normalizedError: text("normalized_error").notNull(),
    title: text("title").notNull(),
    model: text("model"),
    runtimeHarness: text("runtime_harness"),
    sandboxProvider: text("sandbox_provider"),
    status: text("status").$type<FailureAlertStatus>().default("open").notNull(),
    occurrenceCount: integer("occurrence_count").default(0).notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    linearIssueId: text("linear_issue_id"),
    linearIssueIdentifier: text("linear_issue_identifier"),
    linearIssueUrl: text("linear_issue_url"),
    linearLastSyncedAt: timestamp("linear_last_synced_at"),
    lastCommentedOccurrenceCount: integer("last_commented_occurrence_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("failure_alert_group_signature_hash_idx").on(table.signatureHash),
    index("failure_alert_group_environment_status_idx").on(table.environment, table.status),
    index("failure_alert_group_last_seen_at_idx").on(table.lastSeenAt),
    index("failure_alert_group_linear_issue_id_idx").on(table.linearIssueId),
  ],
);

export const failureAlertOccurrence = pgTable(
  "failure_alert_occurrence",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => failureAlertGroup.id, { onDelete: "cascade" }),
    generationId: text("generation_id")
      .notNull()
      .references(() => generation.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    coworkerRunId: text("coworker_run_id").references(() => coworkerRun.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    userEmail: text("user_email"),
    rawError: text("raw_error").notNull(),
    normalizedError: text("normalized_error").notNull(),
    completionReason: text("completion_reason"),
    traceId: text("trace_id"),
    model: text("model"),
    runtimeHarness: text("runtime_harness"),
    sandboxProvider: text("sandbox_provider"),
    startedAt: timestamp("started_at").notNull(),
    failedAt: timestamp("failed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("failure_alert_occurrence_generation_id_idx").on(table.generationId),
    index("failure_alert_occurrence_group_failed_at_idx").on(table.groupId, table.failedAt),
    index("failure_alert_occurrence_conversation_id_idx").on(table.conversationId),
    index("failure_alert_occurrence_coworker_run_id_idx").on(table.coworkerRunId),
  ],
);

export const coworkerTagAssignment = pgTable(
  "coworker_tag_assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coworkerId: text("coworker_id")
      .notNull()
      .references(() => coworker.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => coworkerTag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("coworker_tag_assignment_unique_idx").on(table.coworkerId, table.tagId),
    index("coworker_tag_assignment_coworker_idx").on(table.coworkerId),
    index("coworker_tag_assignment_tag_idx").on(table.tagId),
  ],
);

export const coworkerView = pgTable(
  "coworker_view",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("coworker_view_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("coworker_view_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const inboxReadState = pgTable(
  "inbox_read_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    itemKind: inboxItemKindEnum("item_kind").notNull(),
    itemId: text("item_id").notNull(),
    readAt: timestamp("read_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("inbox_read_state_user_workspace_item_idx").on(
      table.userId,
      table.workspaceId,
      table.itemKind,
      table.itemId,
    ),
    index("inbox_read_state_user_workspace_idx").on(table.userId, table.workspaceId),
    index("inbox_read_state_read_at_idx").on(table.readAt),
  ],
);

// ========== INTEGRATION SCHEMA ==========

export const connectedIdentity = pgTable(
  "connected_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    emailIdentity: text("email_identity"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("connected_identity_user_id_idx").on(table.userId),
    uniqueIndex("connected_identity_user_label_idx").on(table.userId, table.label),
  ],
);

export const integration = pgTable(
  "integration",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectedIdentityId: text("connected_identity_id").references(() => connectedIdentity.id, {
      onDelete: "set null",
    }),
    type: integrationTypeEnum("type").notNull(),
    // OAuth account identifier from the provider
    providerAccountId: text("provider_account_id"),
    // Display name (e.g., email address, workspace name)
    displayName: text("display_name"),
    enabled: boolean("enabled").default(true).notNull(),
    authStatus: integrationAuthStatusEnum("auth_status").default("connected").notNull(),
    authErrorCode: text("auth_error_code"),
    authErrorAt: timestamp("auth_error_at"),
    authErrorDetail: text("auth_error_detail"),
    // Scopes granted by user
    scopes: text("scopes").array(),
    // Provider-specific metadata (e.g., workspace ID for Notion)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_user_id_idx").on(table.userId),
    index("integration_connected_identity_id_idx").on(table.connectedIdentityId),
    index("integration_type_idx").on(table.type),
    uniqueIndex("integration_connected_identity_type_idx").on(
      table.connectedIdentityId,
      table.type,
    ),
    uniqueIndex("integration_user_type_provider_idx").on(
      table.userId,
      table.type,
      table.providerAccountId,
    ),
  ],
);

export const integrationToken = pgTable(
  "integration_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integration.id, { onDelete: "cascade" }),
    // Tokens (should encrypt in production)
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenType: text("token_type").default("Bearer"),
    expiresAt: timestamp("expires_at"),
    // ID token for OIDC providers
    idToken: text("id_token"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("integration_token_integration_id_idx").on(table.integrationId)],
);

// ========== RELATIONS ==========

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  user: one(user, { fields: [conversation.userId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [conversation.workspaceId],
    references: [workspace.id],
  }),
  messages: many(message),
  generations: many(generation),
  runtime: one(conversationRuntime, {
    fields: [conversation.id],
    references: [conversationRuntime.conversationId],
  }),
  sessionSnapshot: one(conversationSessionSnapshot, {
    fields: [conversation.id],
    references: [conversationSessionSnapshot.conversationId],
  }),
  billingLedgers: many(billingLedger),
  queuedMessages: many(conversationQueuedMessage),
  coworkerRuns: many(coworkerRun),
}));

export const conversationRuntimeRelations = relations(conversationRuntime, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [conversationRuntime.conversationId],
    references: [conversation.id],
  }),
  activeGeneration: one(generation, {
    fields: [conversationRuntime.activeGenerationId],
    references: [generation.id],
  }),
  generations: many(generation),
  interrupts: many(generationInterrupt),
}));

export const conversationSessionSnapshotRelations = relations(
  conversationSessionSnapshot,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationSessionSnapshot.conversationId],
      references: [conversation.id],
    }),
  }),
);

export const messageAttachment = pgTable(
  "message_attachment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("message_attachment_message_id_idx").on(table.messageId)],
);

// Sandbox files created by the AI agent that are surfaced to users
export const sandboxFile = pgTable(
  "sandbox_file",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text("message_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    path: text("path").notNull(), // Original sandbox path: /app/output.pdf
    filename: text("filename").notNull(), // Just the filename: output.pdf
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key"), // S3 key for uploaded file
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sandbox_file_message_id_idx").on(table.messageId),
    index("sandbox_file_conversation_id_idx").on(table.conversationId),
  ],
);

// Periodic snapshots of live sandboxes across providers (E2B, Daytona).
// One row per live sandbox per snapshot tick (every ~5min), for usage/leak tracking.
export const sandboxUsageSnapshot = pgTable(
  "sandbox_usage_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).defaultNow().notNull(),
    provider: text("provider").notNull(), // 'e2b' | 'daytona'
    sandboxId: text("sandbox_id").notNull(),
    state: text("state"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    runtimeSeconds: integer("runtime_seconds").notNull().default(0),
    credits: doublePrecision("credits").notNull().default(0),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("sandbox_usage_snapshot_at_idx").on(table.snapshotAt),
    index("sandbox_usage_snapshot_provider_at_idx").on(table.provider, table.snapshotAt),
    index("sandbox_usage_snapshot_sandbox_id_at_idx").on(table.sandboxId, table.snapshotAt),
  ],
);

export const messageRelations = relations(message, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  parentMessage: one(message, {
    fields: [message.parentMessageId],
    references: [message.id],
    relationName: "parentMessage",
  }),
  attachments: many(messageAttachment),
  sandboxFiles: many(sandboxFile),
}));

export const messageAttachmentRelations = relations(messageAttachment, ({ one }) => ({
  message: one(message, {
    fields: [messageAttachment.messageId],
    references: [message.id],
  }),
}));

export const sandboxFileRelations = relations(sandboxFile, ({ one }) => ({
  message: one(message, {
    fields: [sandboxFile.messageId],
    references: [message.id],
  }),
  conversation: one(conversation, {
    fields: [sandboxFile.conversationId],
    references: [conversation.id],
  }),
}));

export const generationRelations = relations(generation, ({ one }) => ({
  conversation: one(conversation, {
    fields: [generation.conversationId],
    references: [conversation.id],
  }),
  runtime: one(conversationRuntime, {
    fields: [generation.runtimeId],
    references: [conversationRuntime.id],
  }),
  message: one(message, {
    fields: [generation.messageId],
    references: [message.id],
  }),
}));

export const billingLedgerRelations = relations(billingLedger, ({ one }) => ({
  generation: one(generation, {
    fields: [billingLedger.generationId],
    references: [generation.id],
  }),
  conversation: one(conversation, {
    fields: [billingLedger.conversationId],
    references: [conversation.id],
  }),
  user: one(user, {
    fields: [billingLedger.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [billingLedger.workspaceId],
    references: [workspace.id],
  }),
}));

export const billingTopUpRelations = relations(billingTopUp, ({ one }) => ({
  user: one(user, {
    fields: [billingTopUp.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [billingTopUp.workspaceId],
    references: [workspace.id],
  }),
  grantedByUser: one(user, {
    fields: [billingTopUp.grantedByUserId],
    references: [user.id],
    relationName: "billingTopUpGrantedByUser",
  }),
}));

export const conversationQueuedMessageRelations = relations(
  conversationQueuedMessage,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationQueuedMessage.conversationId],
      references: [conversation.id],
    }),
    generation: one(generation, {
      fields: [conversationQueuedMessage.generationId],
      references: [generation.id],
    }),
    user: one(user, {
      fields: [conversationQueuedMessage.userId],
      references: [user.id],
    }),
  }),
);

export const coworkerRelations = relations(coworker, ({ one, many }) => ({
  owner: one(user, { fields: [coworker.ownerId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [coworker.workspaceId],
    references: [workspace.id],
  }),
  runs: many(coworkerRun),
  documents: many(coworkerDocument),
  emailAliases: many(coworkerEmailAlias),
  tagAssignments: many(coworkerTagAssignment),
}));

export const orgChartNodeRelations = relations(orgChartNode, ({ one }) => ({
  workspace: one(workspace, {
    fields: [orgChartNode.workspaceId],
    references: [workspace.id],
  }),
  coworker: one(coworker, {
    fields: [orgChartNode.coworkerId],
    references: [coworker.id],
  }),
}));

export const coworkerRunRelations = relations(coworkerRun, ({ one, many }) => ({
  coworker: one(coworker, {
    fields: [coworkerRun.coworkerId],
    references: [coworker.id],
  }),
  owner: one(user, {
    fields: [coworkerRun.ownerId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [coworkerRun.workspaceId],
    references: [workspace.id],
  }),
  generation: one(generation, {
    fields: [coworkerRun.generationId],
    references: [generation.id],
  }),
  conversation: one(conversation, {
    fields: [coworkerRun.conversationId],
    references: [conversation.id],
  }),
  events: many(coworkerRunEvent),
}));

export const coworkerDocumentRelations = relations(coworkerDocument, ({ one }) => ({
  coworker: one(coworker, {
    fields: [coworkerDocument.coworkerId],
    references: [coworker.id],
  }),
}));

export const coworkerRunEventRelations = relations(coworkerRunEvent, ({ one }) => ({
  run: one(coworkerRun, {
    fields: [coworkerRunEvent.coworkerRunId],
    references: [coworkerRun.id],
  }),
}));

export const coworkerEmailAliasRelations = relations(coworkerEmailAlias, ({ one }) => ({
  coworker: one(coworker, {
    fields: [coworkerEmailAlias.coworkerId],
    references: [coworker.id],
  }),
  replacedByAlias: one(coworkerEmailAlias, {
    fields: [coworkerEmailAlias.replacedByAliasId],
    references: [coworkerEmailAlias.id],
    relationName: "replacedByAlias",
  }),
}));

export const coworkerTagRelations = relations(coworkerTag, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [coworkerTag.workspaceId],
    references: [workspace.id],
  }),
  assignments: many(coworkerTagAssignment),
}));

export const coworkerTagAssignmentRelations = relations(coworkerTagAssignment, ({ one }) => ({
  coworker: one(coworker, {
    fields: [coworkerTagAssignment.coworkerId],
    references: [coworker.id],
  }),
  tag: one(coworkerTag, {
    fields: [coworkerTagAssignment.tagId],
    references: [coworkerTag.id],
  }),
}));

export const coworkerViewRelations = relations(coworkerView, ({ one }) => ({
  workspace: one(workspace, {
    fields: [coworkerView.workspaceId],
    references: [workspace.id],
  }),
}));

export const integrationRelations = relations(integration, ({ one, many }) => ({
  user: one(user, { fields: [integration.userId], references: [user.id] }),
  connectedIdentity: one(connectedIdentity, {
    fields: [integration.connectedIdentityId],
    references: [connectedIdentity.id],
  }),
  tokens: many(integrationToken),
}));

export const connectedIdentityRelations = relations(connectedIdentity, ({ one, many }) => ({
  user: one(user, { fields: [connectedIdentity.userId], references: [user.id] }),
  integrations: many(integration),
}));

export const integrationTokenRelations = relations(integrationToken, ({ one }) => ({
  integration: one(integration, {
    fields: [integrationToken.integrationId],
    references: [integration.id],
  }),
}));

// ========== SKILL SCHEMA ==========

export const skillVisibilityEnum = pgEnum("skill_visibility", ["private", "public"]);

export const skill = pgTable(
  "skill",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    // Skill slug (lowercase, numbers, hyphens only)
    name: text("name").notNull(),
    // Human-readable display name
    displayName: text("display_name").notNull(),
    // Description from SKILL.md frontmatter
    description: text("description").notNull(),
    // Icon: emoji (e.g., "🚀") or Lucide icon name (e.g., "lucide:rocket")
    icon: text("icon"),
    visibility: skillVisibilityEnum("visibility").default("private").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("skill_user_id_idx").on(table.userId),
    index("skill_workspace_id_idx").on(table.workspaceId),
    index("skill_visibility_idx").on(table.visibility),
    unique("skill_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const skillFile = pgTable(
  "skill_file",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    // File path within skill directory (e.g., "SKILL.md", "reference.md", "scripts/helper.py")
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("skill_file_skill_id_idx").on(table.skillId)],
);

export const skillDocument = pgTable(
  "skill_document",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    // Original filename uploaded by user
    filename: text("filename").notNull(),
    // Relative path within the skill directory
    path: text("path").notNull(),
    // MIME type (e.g., "application/pdf", "image/png")
    mimeType: text("mime_type").notNull(),
    // File size in bytes
    sizeBytes: integer("size_bytes").notNull(),
    // S3/MinIO object key (path in bucket)
    storageKey: text("storage_key").notNull(),
    // Optional description/notes about the document
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("skill_document_skill_id_idx").on(table.skillId)],
);

export const skillRelations = relations(skill, ({ one, many }) => ({
  user: one(user, { fields: [skill.userId], references: [user.id] }),
  workspace: one(workspace, { fields: [skill.workspaceId], references: [workspace.id] }),
  files: many(skillFile),
  documents: many(skillDocument),
}));

export const skillFileRelations = relations(skillFile, ({ one }) => ({
  skill: one(skill, {
    fields: [skillFile.skillId],
    references: [skill.id],
  }),
}));

export const skillDocumentRelations = relations(skillDocument, ({ one }) => ({
  skill: one(skill, {
    fields: [skillDocument.skillId],
    references: [skill.id],
  }),
}));

export const templateCatalog = pgTable(
  "template_catalog",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    triggerType: text("trigger_type").$type<TemplateTriggerType>().notNull(),
    industry: text("industry").notNull(),
    useCase: text("use_case").notNull(),
    integrations: jsonb("integrations").$type<TemplateIntegrationType[]>().notNull(),
    triggerTitle: text("trigger_title").notNull(),
    triggerDescription: text("trigger_description").notNull(),
    agentInstructions: jsonb("agent_instructions").$type<string[]>().notNull(),
    heroCta: text("hero_cta").notNull(),
    summaryBlocks: jsonb("summary_blocks").$type<TemplateCatalogSummaryBlock[]>().notNull(),
    mermaid: text("mermaid").notNull(),
    connectedApps: jsonb("connected_apps").$type<TemplateCatalogConnectedApp[]>().notNull(),
    featured: boolean("featured").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("template_catalog_featured_idx").on(table.featured),
    index("template_catalog_created_at_idx").on(table.createdAt),
    index("template_catalog_title_idx").on(table.title),
  ],
);

// ========== MEMORY SCHEMA ==========

export const memoryFileTypeEnum = pgEnum("memory_file_type", ["longterm", "daily"]);

export const memoryFile = pgTable(
  "memory_file",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: memoryFileTypeEnum("type").notNull(),
    date: date("date", { mode: "date" }),
    title: text("title"),
    tags: jsonb("tags").$type<string[]>(),
    hash: text("hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("memory_file_user_id_idx").on(table.userId),
    unique("memory_file_user_type_date_idx").on(table.userId, table.type, table.date),
  ],
);

export const memoryEntry = pgTable(
  "memory_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => memoryFile.id, { onDelete: "cascade" }),
    title: text("title"),
    tags: jsonb("tags").$type<string[]>(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("memory_entry_user_id_idx").on(table.userId),
    index("memory_entry_file_id_idx").on(table.fileId),
  ],
);

export const memoryChunk = pgTable(
  "memory_chunk",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => memoryFile.id, { onDelete: "cascade" }),
    entryId: text("entry_id").references(() => memoryEntry.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("memory_chunk_user_id_idx").on(table.userId),
    index("memory_chunk_file_id_idx").on(table.fileId),
    index("memory_chunk_entry_id_idx").on(table.entryId),
    index("memory_chunk_hash_idx").on(table.contentHash),
  ],
);

export const memorySettings = pgTable(
  "memory_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").default("openai").notNull(),
    model: text("model").default("text-embedding-3-small").notNull(),
    dimensions: integer("dimensions").default(1536).notNull(),
    chunkTokens: integer("chunk_tokens").default(400).notNull(),
    chunkOverlap: integer("chunk_overlap").default(80).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [unique("memory_settings_user_id_idx").on(table.userId)],
);

export const memoryFileRelations = relations(memoryFile, ({ one, many }) => ({
  user: one(user, { fields: [memoryFile.userId], references: [user.id] }),
  entries: many(memoryEntry),
  chunks: many(memoryChunk),
}));

export const memoryEntryRelations = relations(memoryEntry, ({ one, many }) => ({
  user: one(user, { fields: [memoryEntry.userId], references: [user.id] }),
  file: one(memoryFile, {
    fields: [memoryEntry.fileId],
    references: [memoryFile.id],
  }),
  chunks: many(memoryChunk),
}));

export const memoryChunkRelations = relations(memoryChunk, ({ one }) => ({
  user: one(user, { fields: [memoryChunk.userId], references: [user.id] }),
  file: one(memoryFile, {
    fields: [memoryChunk.fileId],
    references: [memoryFile.id],
  }),
  entry: one(memoryEntry, {
    fields: [memoryChunk.entryId],
    references: [memoryEntry.id],
  }),
}));

export const memorySettingsRelations = relations(memorySettings, ({ one }) => ({
  user: one(user, { fields: [memorySettings.userId], references: [user.id] }),
}));

// ========== SESSION TRANSCRIPTS ==========

export const sessionTranscript = pgTable(
  "session_transcript",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id"),
    title: text("title"),
    slug: text("slug"),
    path: text("path").notNull(),
    date: date("date", { mode: "date" }),
    source: text("source"),
    messageCount: integer("message_count"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("session_transcript_user_id_idx").on(table.userId),
    index("session_transcript_conversation_id_idx").on(table.conversationId),
    unique("session_transcript_user_path_idx").on(table.path, table.userId),
  ],
);

export const sessionTranscriptChunk = pgTable(
  "session_transcript_chunk",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id")
      .notNull()
      .references(() => sessionTranscript.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("session_transcript_chunk_user_id_idx").on(table.userId),
    index("session_transcript_chunk_transcript_id_idx").on(table.transcriptId),
    index("session_transcript_chunk_hash_idx").on(table.contentHash),
  ],
);

export const sessionTranscriptRelations = relations(sessionTranscript, ({ one, many }) => ({
  user: one(user, {
    fields: [sessionTranscript.userId],
    references: [user.id],
  }),
  conversation: one(conversation, {
    fields: [sessionTranscript.conversationId],
    references: [conversation.id],
  }),
  chunks: many(sessionTranscriptChunk),
}));

export const sessionTranscriptChunkRelations = relations(sessionTranscriptChunk, ({ one }) => ({
  user: one(user, {
    fields: [sessionTranscriptChunk.userId],
    references: [user.id],
  }),
  transcript: one(sessionTranscript, {
    fields: [sessionTranscriptChunk.transcriptId],
    references: [sessionTranscript.id],
  }),
}));

// ========== PROVIDER AUTH SCHEMA ==========
// Stores encrypted provider credentials for subscription providers (ChatGPT, Gemini, Kimi)

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

export const providerAuthRelations = relations(providerAuth, ({ one }) => ({
  user: one(user, {
    fields: [providerAuth.userId],
    references: [user.id],
  }),
}));

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

export const sharedProviderAuthRelations = relations(sharedProviderAuth, ({ one }) => ({
  managedByUser: one(user, {
    fields: [sharedProviderAuth.managedByUserId],
    references: [user.id],
  }),
}));

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

export const cloudAccountLinkRelations = relations(cloudAccountLink, ({ one }) => ({
  user: one(user, {
    fields: [cloudAccountLink.userId],
    references: [user.id],
  }),
}));

// ========== DEVICE CODE (Better Auth plugin) ==========

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

export const deviceRelations = relations(device, ({ one }) => ({
  user: one(user, { fields: [device.userId], references: [user.id] }),
}));

// ─── Custom Integrations ─────────────────────────────────────

export const customIntegration = pgTable(
  "custom_integration",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    iconUrl: text("icon_url"),
    baseUrl: text("base_url").notNull(),
    authType: text("auth_type").notNull(), // oauth2, api_key, bearer_token
    oauthConfig: jsonb("oauth_config").$type<{
      authUrl: string;
      tokenUrl: string;
      scopes: string[];
      pkce?: boolean;
      authStyle?: "header" | "params";
      extraAuthParams?: Record<string, string>;
    }>(),
    apiKeyConfig: jsonb("api_key_config").$type<{
      method: "header" | "query";
      headerName?: string;
      queryParam?: string;
    }>(),
    cliCode: text("cli_code").notNull(),
    cliInstructions: text("cli_instructions").notNull(),
    permissions: jsonb("permissions")
      .$type<{
        readOps: string[];
        writeOps: string[];
      }>()
      .notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    communityPrUrl: text("community_pr_url"),
    communityStatus: text("community_status"), // pending, approved, rejected
    isBuiltIn: boolean("is_built_in").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_integration_slug_idx").on(table.slug),
    index("custom_integration_created_by_idx").on(table.createdByUserId),
  ],
);

export const customIntegrationCredential = pgTable(
  "custom_integration_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customIntegrationId: text("custom_integration_id")
      .notNull()
      .references(() => customIntegration.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    clientSecret: text("client_secret"),
    apiKey: text("api_key"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").default(true).notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_cred_user_id_idx").on(table.userId),
    index("custom_cred_integration_id_idx").on(table.customIntegrationId),
    unique("custom_cred_user_integration_idx").on(table.userId, table.customIntegrationId),
  ],
);

export const customIntegrationRelations = relations(customIntegration, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [customIntegration.createdByUserId],
    references: [user.id],
  }),
  credentials: many(customIntegrationCredential),
}));

export const customIntegrationCredentialRelations = relations(
  customIntegrationCredential,
  ({ one }) => ({
    user: one(user, {
      fields: [customIntegrationCredential.userId],
      references: [user.id],
    }),
    customIntegration: one(customIntegration, {
      fields: [customIntegrationCredential.customIntegrationId],
      references: [customIntegration.id],
    }),
  }),
);

export const workspaceExecutorSource = pgTable(
  "workspace_executor_source",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: executorSourceKindEnum("kind").notNull(),
    internalKey: text("internal_key"),
    name: text("name").notNull(),
    namespace: text("namespace").notNull(),
    endpoint: text("endpoint").notNull(),
    specUrl: text("spec_url"),
    transport: text("transport"),
    headers: jsonb("headers").$type<Record<string, string>>(),
    queryParams: jsonb("query_params").$type<Record<string, string>>(),
    defaultHeaders: jsonb("default_headers").$type<Record<string, string>>(),
    authType: executorSourceAuthTypeEnum("auth_type").default("none").notNull(),
    authHeaderName: text("auth_header_name"),
    authQueryParam: text("auth_query_param"),
    authPrefix: text("auth_prefix"),
    enabled: boolean("enabled").default(true).notNull(),
    revisionHash: text("revision_hash").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workspace_executor_source_workspace_idx").on(table.workspaceId),
    index("workspace_executor_source_created_by_idx").on(table.createdByUserId),
    uniqueIndex("workspace_executor_source_workspace_namespace_idx").on(
      table.workspaceId,
      table.namespace,
    ),
  ],
);

export const workspaceExecutorSourceCredential = pgTable(
  "workspace_executor_source_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceExecutorSourceId: text("workspace_executor_source_id")
      .notNull()
      .references(() => workspaceExecutorSource.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    oauthMetadata: jsonb("oauth_metadata").$type<{
      tokenType: string;
      scope: string | null;
      redirectUri: string;
      resourceMetadataUrl: string | null;
      authorizationServerUrl: string | null;
      resourceMetadata: Record<string, unknown> | null;
      authorizationServerMetadata: Record<string, unknown> | null;
      clientInformation: Record<string, unknown> | null;
    }>(),
    enabled: boolean("enabled").default(true).notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workspace_executor_source_credential_user_idx").on(table.userId),
    index("workspace_executor_source_credential_source_idx").on(table.workspaceExecutorSourceId),
    unique("workspace_executor_source_credential_user_source_idx").on(
      table.userId,
      table.workspaceExecutorSourceId,
    ),
  ],
);

export const workspaceExecutorPackage = pgTable(
  "workspace_executor_package",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    revisionHash: text("revision_hash").notNull(),
    configJson: text("config_json").notNull(),
    workspaceStateJson: text("workspace_state_json").notNull(),
    builtAt: timestamp("built_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("workspace_executor_package_revision_idx").on(table.revisionHash)],
);

export const workspaceExecutorSourceRelations = relations(
  workspaceExecutorSource,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [workspaceExecutorSource.workspaceId],
      references: [workspace.id],
    }),
    createdByUser: one(user, {
      relationName: "workspaceExecutorSourceCreatedByUser",
      fields: [workspaceExecutorSource.createdByUserId],
      references: [user.id],
    }),
    updatedByUser: one(user, {
      relationName: "workspaceExecutorSourceUpdatedByUser",
      fields: [workspaceExecutorSource.updatedByUserId],
      references: [user.id],
    }),
    credentials: many(workspaceExecutorSourceCredential),
  }),
);

export const workspaceExecutorSourceCredentialRelations = relations(
  workspaceExecutorSourceCredential,
  ({ one }) => ({
    user: one(user, {
      fields: [workspaceExecutorSourceCredential.userId],
      references: [user.id],
    }),
    workspaceExecutorSource: one(workspaceExecutorSource, {
      fields: [workspaceExecutorSourceCredential.workspaceExecutorSourceId],
      references: [workspaceExecutorSource.id],
    }),
  }),
);

export const workspaceExecutorPackageRelations = relations(workspaceExecutorPackage, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceExecutorPackage.workspaceId],
    references: [workspace.id],
  }),
}));

export const integrationSkillSourceEnum = pgEnum("integration_skill_source", [
  "official",
  "community",
]);

export const integrationSkillVisibilityEnum = pgEnum("integration_skill_visibility", ["public"]);

export const integrationSkill = pgTable(
  "integration_skill",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    source: integrationSkillSourceEnum("source").notNull(),
    visibility: integrationSkillVisibilityEnum("visibility").default("public").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_skill_slug_idx").on(table.slug),
    index("integration_skill_created_by_idx").on(table.createdByUserId),
    index("integration_skill_source_idx").on(table.source),
  ],
);

export const integrationSkillFile = pgTable(
  "integration_skill_file",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    integrationSkillId: text("integration_skill_id")
      .notNull()
      .references(() => integrationSkill.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("integration_skill_file_skill_id_idx").on(table.integrationSkillId)],
);

export const integrationSkillPreference = pgTable(
  "integration_skill_preference",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    preferredSource: integrationSkillSourceEnum("preferred_source").notNull(),
    preferredSkillId: text("preferred_skill_id").references(() => integrationSkill.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_skill_pref_user_id_idx").on(table.userId),
    index("integration_skill_pref_slug_idx").on(table.slug),
    unique("integration_skill_pref_user_slug_idx").on(table.userId, table.slug),
  ],
);

export const integrationSkillRelations = relations(integrationSkill, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [integrationSkill.createdByUserId],
    references: [user.id],
  }),
  files: many(integrationSkillFile),
}));

export const integrationSkillFileRelations = relations(integrationSkillFile, ({ one }) => ({
  integrationSkill: one(integrationSkill, {
    fields: [integrationSkillFile.integrationSkillId],
    references: [integrationSkill.id],
  }),
}));

export const integrationSkillPreferenceRelations = relations(
  integrationSkillPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [integrationSkillPreference.userId],
      references: [user.id],
    }),
    preferredSkill: one(integrationSkill, {
      fields: [integrationSkillPreference.preferredSkillId],
      references: [integrationSkill.id],
    }),
  }),
);

// ─── WhatsApp ───────────────────────────────────────────────

export const whatsappAuthState = pgTable(
  "whatsapp_auth_state",
  {
    id: text("id").primaryKey(),
    data: text("data").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("whatsapp_auth_state_updated_at_idx").on(table.updatedAt)],
);

export const providerOauthState = pgTable(
  "provider_oauth_state",
  {
    state: text("state").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("provider_oauth_state_created_at_idx").on(table.createdAt)],
);

export const cloudAccountLinkState = pgTable(
  "cloud_account_link_state",
  {
    state: text("state").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedIntegrationType: text("requested_integration_type"),
    returnPath: text("return_path"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("cloud_account_link_state_created_at_idx").on(table.createdAt)],
);

export const controlPlaneAuthState = pgTable(
  "control_plane_auth_state",
  {
    state: text("state").primaryKey(),
    returnPath: text("return_path"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("control_plane_auth_state_created_at_idx").on(table.createdAt)],
);

export const controlPlaneLinkRequest = pgTable(
  "control_plane_link_request",
  {
    code: text("code").primaryKey(),
    localState: text("local_state").notNull(),
    returnUrl: text("return_url").notNull(),
    requestedIntegrationType: text("requested_integration_type"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("control_plane_link_request_created_at_idx").on(table.createdAt)],
);

export const controlPlaneAuthRequest = pgTable(
  "control_plane_auth_request",
  {
    code: text("code").primaryKey(),
    localState: text("local_state").notNull(),
    returnUrl: text("return_url").notNull(),
    returnPath: text("return_path"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("control_plane_auth_request_created_at_idx").on(table.createdAt)],
);

export const whatsappUserLink = pgTable(
  "whatsapp_user_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    waJid: text("wa_jid").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_user_link_wa_jid_idx").on(table.waJid),
    uniqueIndex("whatsapp_user_link_user_id_idx").on(table.userId),
  ],
);

export const whatsappUserLinkRelations = relations(whatsappUserLink, ({ one }) => ({
  user: one(user, {
    fields: [whatsappUserLink.userId],
    references: [user.id],
  }),
}));

export const whatsappLinkCode = pgTable(
  "whatsapp_link_code",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_link_code_code_idx").on(table.code),
    index("whatsapp_link_code_user_id_idx").on(table.userId),
  ],
);

export const whatsappLinkCodeRelations = relations(whatsappLinkCode, ({ one }) => ({
  user: one(user, {
    fields: [whatsappLinkCode.userId],
    references: [user.id],
  }),
}));

export const whatsappConversation = pgTable(
  "whatsapp_conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    waJid: text("wa_jid").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_conversation_wa_jid_idx").on(table.waJid),
    index("whatsapp_conversation_conversation_id_idx").on(table.conversationId),
    index("whatsapp_conversation_user_id_idx").on(table.userId),
  ],
);

export const whatsappConversationRelations = relations(whatsappConversation, ({ one }) => ({
  conversation: one(conversation, {
    fields: [whatsappConversation.conversationId],
    references: [conversation.id],
  }),
  user: one(user, {
    fields: [whatsappConversation.userId],
    references: [user.id],
  }),
}));

// ─── Slack Bot ───────────────────────────────────────────────

export const slackUserLink = pgTable(
  "slack_user_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slackTeamId: text("slack_team_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("slack_user_link_team_user_idx").on(table.slackTeamId, table.slackUserId),
    index("slack_user_link_user_id_idx").on(table.userId),
  ],
);

export const slackUserLinkRelations = relations(slackUserLink, ({ one }) => ({
  user: one(user, {
    fields: [slackUserLink.userId],
    references: [user.id],
  }),
}));

export const slackConversation = pgTable(
  "slack_conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("slack_conversation_thread_idx").on(table.teamId, table.channelId, table.threadTs),
    index("slack_conversation_conversation_id_idx").on(table.conversationId),
  ],
);

export const slackConversationRelations = relations(slackConversation, ({ one }) => ({
  conversation: one(conversation, {
    fields: [slackConversation.conversationId],
    references: [conversation.id],
  }),
  user: one(user, {
    fields: [slackConversation.userId],
    references: [user.id],
  }),
}));

export const slackProcessedEvent = pgTable(
  "slack_processed_event",
  {
    eventId: text("event_id").primaryKey(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [index("slack_processed_event_received_at_idx").on(table.receivedAt)],
);

// Aggregated schema used by better-auth's drizzle adapter.
export const authSchema = {
  user,
  session,
  account,
  verification,
  deviceCode,
};
