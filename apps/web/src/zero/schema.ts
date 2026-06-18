import {
  boolean,
  createBuilder,
  createSchema,
  json,
  number,
  relationships,
  string,
  table,
  type QueryRowType,
  type ReadonlyJSONValue,
} from "@rocicorp/zero";

type JsonObject = Record<string, ReadonlyJSONValue>;
type JsonArray = ReadonlyJSONValue[];

export const conversationTable = table("conversation")
  .columns({
    id: string(),
    userId: string().from("user_id").optional(),
    workspaceId: string().from("workspace_id").optional(),
    type: string<"chat" | "coworker">(),
    title: string().optional(),
    model: string().optional(),
    authSource: string<"user" | "shared">().from("auth_source").optional(),
    generationStatus: string().from("generation_status"),
    currentGenerationId: string().from("current_generation_id").optional(),
    autoApprove: boolean().from("auto_approve"),
    seenMessageCount: number().from("seen_message_count"),
    isPinned: boolean().from("is_pinned"),
    isShared: boolean().from("is_shared"),
    sharedAt: number().from("shared_at").optional(),
    syntheticKind: string().from("synthetic_kind").optional(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    archivedAt: number().from("archived_at").optional(),
  })
  .primaryKey("id");

export const messageTable = table("message")
  .columns({
    id: string(),
    conversationId: string().from("conversation_id"),
    role: string<"user" | "assistant" | "system" | "tool">(),
    content: string(),
    contentParts: json<JsonArray>().from("content_parts").optional(),
    timing: json<JsonObject>().optional(),
    parentMessageId: string().from("parent_message_id").optional(),
    opencodeMessageId: string().from("opencode_message_id").optional(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

export const sandboxFileTable = table("sandboxFile")
  .from("sandbox_file")
  .columns({
    id: string(),
    messageId: string().from("message_id").optional(),
    conversationId: string().from("conversation_id"),
    path: string(),
    filename: string(),
    mimeType: string().from("mime_type"),
    sizeBytes: number().from("size_bytes").optional(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

export const workspaceMemberTable = table("workspaceMember")
  .from("workspace_member")
  .columns({
    id: string(),
    workspaceId: string().from("workspace_id"),
    userId: string().from("user_id"),
    role: string<"owner" | "admin" | "member">(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("id");

export const coworkerFolderTable = table("coworkerFolder")
  .from("coworker_folder")
  .columns({
    id: string(),
    workspaceId: string().from("workspace_id"),
    ownerId: string().from("owner_id").optional(),
    parentId: string().from("parent_id").optional(),
    name: string(),
    visibility: string<"private" | "workspace">(),
    position: number(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("id");

export const coworkerTable = table("coworker")
  .columns({
    id: string(),
    name: string(),
    ownerId: string().from("owner_id"),
    workspaceId: string().from("workspace_id").optional(),
    folderId: string().from("folder_id").optional(),
    status: string<"on" | "off">(),
    disabledReason: string<"run_backlog_limit">().from("disabled_reason").optional(),
    disabledAt: number().from("disabled_at").optional(),
    triggerType: string().from("trigger_type"),
    model: string(),
    authSource: string<"user" | "shared">().from("auth_source").optional(),
    description: string().optional(),
    username: string().optional(),
    requiresUserInput: boolean().from("requires_user_input"),
    userInputPrompt: string().from("user_input_prompt").optional(),
    autoApprove: boolean().from("auto_approve"),
    toolAccessMode: string<"all" | "selected">().from("tool_access_mode").optional(),
    isPinned: boolean().from("is_pinned"),
    sharedAt: number().from("shared_at").optional(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("id");

export const coworkerRunTable = table("coworkerRun")
  .from("coworker_run")
  .columns({
    id: string(),
    coworkerId: string().from("coworker_id"),
    ownerId: string().from("owner_id").optional(),
    workspaceId: string().from("workspace_id").optional(),
    status: string(),
    generationId: string().from("generation_id").optional(),
    conversationId: string().from("conversation_id").optional(),
    startedAt: number().from("started_at"),
    finishedAt: number().from("finished_at").optional(),
    syntheticKind: string().from("synthetic_kind").optional(),
  })
  .primaryKey("id");

const conversationRelationships = relationships(conversationTable, ({ many }) => ({
  messages: many({
    sourceField: ["id"],
    destField: ["conversationId"],
    destSchema: messageTable,
  }),
  workspaceMembers: many({
    sourceField: ["workspaceId"],
    destField: ["workspaceId"],
    destSchema: workspaceMemberTable,
  }),
}));

const messageRelationships = relationships(messageTable, ({ many, one }) => ({
  conversation: one({
    sourceField: ["conversationId"],
    destField: ["id"],
    destSchema: conversationTable,
  }),
  sandboxFiles: many({
    sourceField: ["id"],
    destField: ["messageId"],
    destSchema: sandboxFileTable,
  }),
}));

const sandboxFileRelationships = relationships(sandboxFileTable, ({ one }) => ({
  message: one({
    sourceField: ["messageId"],
    destField: ["id"],
    destSchema: messageTable,
  }),
  conversation: one({
    sourceField: ["conversationId"],
    destField: ["id"],
    destSchema: conversationTable,
  }),
}));

const coworkerRelationships = relationships(coworkerTable, ({ many, one }) => ({
  folder: one({
    sourceField: ["folderId"],
    destField: ["id"],
    destSchema: coworkerFolderTable,
  }),
  runs: many({
    sourceField: ["id"],
    destField: ["coworkerId"],
    destSchema: coworkerRunTable,
  }),
  workspaceMembers: many({
    sourceField: ["workspaceId"],
    destField: ["workspaceId"],
    destSchema: workspaceMemberTable,
  }),
}));

const coworkerRunRelationships = relationships(coworkerRunTable, ({ many, one }) => ({
  coworker: one({
    sourceField: ["coworkerId"],
    destField: ["id"],
    destSchema: coworkerTable,
  }),
  workspaceMembers: many({
    sourceField: ["workspaceId"],
    destField: ["workspaceId"],
    destSchema: workspaceMemberTable,
  }),
}));

const coworkerFolderRelationships = relationships(coworkerFolderTable, ({ many }) => ({
  workspaceMembers: many({
    sourceField: ["workspaceId"],
    destField: ["workspaceId"],
    destSchema: workspaceMemberTable,
  }),
}));

export const schema = createSchema({
  tables: [
    conversationTable,
    messageTable,
    sandboxFileTable,
    workspaceMemberTable,
    coworkerFolderTable,
    coworkerTable,
    coworkerRunTable,
  ],
  relationships: [
    conversationRelationships,
    messageRelationships,
    sandboxFileRelationships,
    coworkerRelationships,
    coworkerRunRelationships,
    coworkerFolderRelationships,
  ],
});

export const zql = createBuilder(schema);

export type ZeroSchema = typeof schema;
export type ZeroConversationRow = QueryRowType<typeof zql.conversation>;
export type ZeroMessageRow = QueryRowType<typeof zql.message>;
export type ZeroSandboxFileRow = QueryRowType<typeof zql.sandboxFile>;
export type ZeroCoworkerRow = QueryRowType<typeof zql.coworker>;
export type ZeroCoworkerRunRow = QueryRowType<typeof zql.coworkerRun>;
export type ZeroCoworkerFolderRow = QueryRowType<typeof zql.coworkerFolder>;
