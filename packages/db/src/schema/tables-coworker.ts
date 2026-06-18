import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  coworkerEmailAliasStatusEnum,
  coworkerRunStatusEnum,
  coworkerStatusEnum,
  coworkerToolAccessModeEnum,
  inboxItemKindEnum,
  integrationTypeEnum,
  providerAuthSourceEnum,
} from "./enums";
import type {
  FailureAlertKind,
  FailureAlertStatus,
  SloReplayJourney,
  SloReplayStatus,
  SyntheticTrafficKind,
  CoworkerDisabledReason,
} from "./enums";
import {
  conversation,
  generation,
  user,
  workspace,
} from "./tables";

export const coworkerFolder = pgTable(
  "coworker_folder",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => coworkerFolder.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("coworker_folder_workspace_id_idx").on(table.workspaceId),
    index("coworker_folder_parent_id_idx").on(table.parentId),
    uniqueIndex("coworker_folder_workspace_parent_name_idx").on(
      table.workspaceId,
      table.parentId,
      table.name,
    ),
  ],
);

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
    folderId: text("folder_id").references(() => coworkerFolder.id, { onDelete: "set null" }),
    status: coworkerStatusEnum("status").default("on").notNull(),
    disabledReason: text("disabled_reason").$type<CoworkerDisabledReason>(),
    disabledAt: timestamp("disabled_at"),
    triggerType: text("trigger_type").notNull(),
    prompt: text("prompt").notNull(),
    model: text("model").default("anthropic/claude-sonnet-4-6").notNull(),
    authSource: providerAuthSourceEnum("auth_source"),
    description: text("description"),
    username: text("username"),
    requiresUserInput: boolean("requires_user_input").default(false).notNull(),
    userInputPrompt: text("user_input_prompt"),
    autoApprove: boolean("auto_approve").default(true).notNull(),
    toolAccessMode: coworkerToolAccessModeEnum("tool_access_mode"),
    allowedIntegrations: integrationTypeEnum("allowed_integrations").array().notNull(),
    allowedCustomIntegrations: text("allowed_custom_integrations").array().notNull().default([]),
    allowedWorkspaceMcpServerIds: text("allowed_workspace_mcp_server_ids").array().notNull().default([]),
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
    index("coworker_folder_id_idx").on(table.folderId),
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
    // Spawn Depth: runtime-originated hops from a human/external trigger (0 = direct)
    spawnDepth: integer("spawn_depth").default(0).notNull(),
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
    sloEmittedAt: timestamp("slo_emitted_at"),
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
