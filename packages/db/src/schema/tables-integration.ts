import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  integer,
  date,
  vector,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  TemplateCatalogConnectedApp,
  TemplateCatalogSummaryBlock,
  TemplateIntegrationType,
  TemplateTriggerType,
} from "../template-catalog";
import {
  integrationAuthStatusEnum,
  integrationSkillSourceEnum,
  integrationSkillVisibilityEnum,
  integrationTypeEnum,
  memoryFileTypeEnum,
  skillVisibilityEnum,
  workspaceMcpServerAuthTypeEnum,
  workspaceMcpServerKindEnum,
} from "./enums";
import {
  conversation,
  fileAsset,
  user,
  workspace,
} from "./tables";

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
    fileAssetId: text("file_asset_id").references(() => fileAsset.id, { onDelete: "set null" }),
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
  (table) => [
    index("skill_document_skill_id_idx").on(table.skillId),
    index("skill_document_file_asset_id_idx").on(table.fileAssetId),
  ],
);

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

export const workspaceMcpServer = pgTable(
  "workspace_mcp_server",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: workspaceMcpServerKindEnum("kind").notNull(),
    internalKey: text("internal_key"),
    name: text("name").notNull(),
    namespace: text("namespace").notNull(),
    endpoint: text("endpoint").notNull(),
    specUrl: text("spec_url"),
    transport: text("transport"),
    headers: jsonb("headers").$type<Record<string, string>>(),
    queryParams: jsonb("query_params").$type<Record<string, string>>(),
    defaultHeaders: jsonb("default_headers").$type<Record<string, string>>(),
    authType: workspaceMcpServerAuthTypeEnum("auth_type").default("none").notNull(),
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
    index("workspace_mcp_server_workspace_idx").on(table.workspaceId),
    index("workspace_mcp_server_created_by_idx").on(table.createdByUserId),
    uniqueIndex("workspace_mcp_server_workspace_namespace_idx").on(
      table.workspaceId,
      table.namespace,
    ),
  ],
);

export const workspaceMcpAuthorization = pgTable(
  "workspace_mcp_authorization",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceMcpServerId: text("workspace_mcp_server_id")
      .notNull()
      .references(() => workspaceMcpServer.id, { onDelete: "cascade" }),
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
    index("workspace_mcp_authorization_user_idx").on(table.userId),
    index("workspace_mcp_authorization_server_idx").on(table.workspaceMcpServerId),
    unique("workspace_mcp_authorization_user_server_idx").on(
      table.userId,
      table.workspaceMcpServerId,
    ),
  ],
);

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

export const slackProcessedEvent = pgTable(
  "slack_processed_event",
  {
    eventId: text("event_id").primaryKey(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [index("slack_processed_event_received_at_idx").on(table.receivedAt)],
);

// Aggregated schema used by better-auth's drizzle adapter.
