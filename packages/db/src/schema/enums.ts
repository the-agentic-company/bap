import { pgEnum } from "drizzle-orm/pg-core";

export const magicLinkRequestStatusEnum = pgEnum("magic_link_request_status", [
  "pending",
  "consumed",
]);

export const workspaceMembershipRoleEnum = pgEnum("workspace_membership_role", [
  "owner",
  "admin",
  "member",
]);

export const billingOwnerTypeEnum = pgEnum("billing_owner_type", ["user", "workspace"]);
export const providerAuthSourceEnum = pgEnum("provider_auth_source", ["user", "shared"]);
export const workspaceMcpServerKindEnum = pgEnum("workspace_mcp_server_kind", ["mcp"]);
export const workspaceMcpServerAuthTypeEnum = pgEnum("workspace_mcp_server_auth_type", [
  "none",
  "api_key",
  "bearer",
  "oauth2",
]);
export const inboxItemKindEnum = pgEnum("inbox_item_kind", ["coworker", "chat"]);

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

export const conversationQueuedMessageStatusEnum = pgEnum("conversation_queued_message_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

export const fileAssetStatusEnum = pgEnum("file_asset_status", [
  "ready",
  "cleanup_pending",
  "deleted",
  "purged",
]);

export const uploadSessionStatusEnum = pgEnum("upload_session_status", [
  "pending",
  "completed",
  "failed",
  "expired",
]);

export const fileAssetReferenceKindEnum = pgEnum("file_asset_reference_kind", [
  "message_attachment",
  "coworker_document",
  "skill_document",
  "sandbox_file",
  "generation",
]);

export const integrationTypeEnum = pgEnum("integration_type", [
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
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
  "needs_user_input",
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "cancelling",
  "completed",
  "error",
  "cancelled",
]);
export type CoworkerDisabledReason = "run_backlog_limit";
export type SloReplayJourney = "chat" | "coworker_builder" | "coworker_run";
export type SloReplayStatus = "pending" | "running" | "completed" | "error" | "setup_failed";
export const coworkerEmailAliasStatusEnum = pgEnum("coworker_email_alias_status", [
  "active",
  "disabled",
  "rotated",
  "deleted",
]);

export type FailureAlertKind = "chat" | "coworker";
export type FailureAlertStatus = "open" | "resolved" | "ignored";

export const skillVisibilityEnum = pgEnum("skill_visibility", ["private", "public"]);

export const memoryFileTypeEnum = pgEnum("memory_file_type", ["longterm", "daily"]);

export const integrationSkillSourceEnum = pgEnum("integration_skill_source", [
  "official",
  "community",
]);

export const integrationSkillVisibilityEnum = pgEnum("integration_skill_visibility", ["public"]);
