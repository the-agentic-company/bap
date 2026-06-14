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
  doublePrecision,
} from "drizzle-orm/pg-core";
import {
  billingOwnerTypeEnum,
  conversationQueuedMessageStatusEnum,
  conversationRuntimeStatusEnum,
  conversationTypeEnum,
  generationInterruptKindEnum,
  generationInterruptStatusEnum,
  generationRecordStatusEnum,
  generationStatusEnum,
  messageRoleEnum,
  providerAuthSourceEnum,
} from "./enums";
import type {
  SyntheticTrafficKind,
} from "./enums";
import type {
  ContentPart,
  GenerationExecutionPolicy,
  GenerationInterruptDisplay,
  GenerationInterruptResponsePayload,
  MessageTiming,
  PendingApproval,
  PendingAuth,
  QueuedMessageAttachment,
} from "./types";
import {
  user,
  workspace,
} from "./tables";

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
    // Spawn Depth: runtime-originated hops from a human/external trigger (0 = direct)
    spawnDepth: integer("spawn_depth").default(0).notNull(),
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
export const generation = pgTable(
  "generation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    // Spawn Depth of this run (ADR-0013). Lives on the generation, not the
    // reusable conversation, so a runtime-originated turn continuing an existing
    // conversation cannot inherit (and reset to) the conversation's stale depth.
    spawnDepth: integer("spawn_depth").default(0).notNull(),
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
    lastRuntimeProgressAt: timestamp("last_runtime_progress_at").defaultNow().notNull(),
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

