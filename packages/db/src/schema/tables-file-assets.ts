import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import {
  fileAssetReferenceKindEnum,
  fileAssetStatusEnum,
  uploadSessionStatusEnum,
} from "./enums";
import { user, workspace } from "./tables";

export const fileAsset = pgTable(
  "file_asset",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    status: fileAssetStatusEnum("status").default("ready").notNull(),
    checksumSha256: text("checksum_sha256"),
    storageEtag: text("storage_etag"),
    cleanupEligibleAt: timestamp("cleanup_eligible_at"),
    deletedAt: timestamp("deleted_at"),
    purgedAt: timestamp("purged_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("file_asset_workspace_id_idx").on(table.workspaceId),
    index("file_asset_created_by_user_id_idx").on(table.createdByUserId),
    index("file_asset_status_idx").on(table.status),
    index("file_asset_cleanup_eligible_at_idx").on(table.cleanupEligibleAt),
    uniqueIndex("file_asset_storage_key_idx").on(table.storageKey),
  ],
);

export const uploadSession = pgTable(
  "upload_session",
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
    fileAssetId: text("file_asset_id").references(() => fileAsset.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    declaredSizeBytes: integer("declared_size_bytes").notNull(),
    actualSizeBytes: integer("actual_size_bytes"),
    storageKey: text("storage_key").notNull(),
    status: uploadSessionStatusEnum("status").default("pending").notNull(),
    storageEtag: text("storage_etag"),
    expiresAt: timestamp("expires_at").notNull(),
    completedAt: timestamp("completed_at"),
    failedAt: timestamp("failed_at"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("upload_session_workspace_id_idx").on(table.workspaceId),
    index("upload_session_user_id_idx").on(table.userId),
    index("upload_session_status_idx").on(table.status),
    index("upload_session_expires_at_idx").on(table.expiresAt),
    uniqueIndex("upload_session_storage_key_idx").on(table.storageKey),
  ],
);

export const fileAssetReference = pgTable(
  "file_asset_reference",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    fileAssetId: text("file_asset_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    kind: fileAssetReferenceKindEnum("kind").notNull(),
    referenceId: text("reference_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("file_asset_reference_file_asset_id_idx").on(table.fileAssetId),
    index("file_asset_reference_kind_reference_idx").on(table.kind, table.referenceId),
    uniqueIndex("file_asset_reference_unique_idx").on(
      table.fileAssetId,
      table.kind,
      table.referenceId,
    ),
  ],
);
