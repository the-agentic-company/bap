import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { runtimeVolumeKindEnum } from "./enums";
import {
  coworker,
  generation,
  user,
  workspace,
} from "./tables";

export type RuntimeVolumeManifestEntry = {
  path: string;
  kind: "file";
  sizeBytes: number;
  etag?: string;
  lastModifiedAt?: string;
};

export const runtimeVolume = pgTable(
  "runtime_volume",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: runtimeVolumeKindEnum("kind").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    coworkerId: text("coworker_id").references(() => coworker.id, { onDelete: "cascade" }),
    storageBackend: text("storage_backend").default("s3").notNull(),
    storagePrefix: text("storage_prefix").notNull(),
    mountPath: text("mount_path").notNull(),
    readOnly: boolean("read_only").default(false).notNull(),
    manifestHash: text("manifest_hash"),
    manifest: jsonb("manifest")
      .$type<RuntimeVolumeManifestEntry[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    lastReconciledAt: timestamp("last_reconciled_at"),
    lastReconciledGenerationId: text("last_reconciled_generation_id").references(
      () => generation.id,
      { onDelete: "set null" },
    ),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("runtime_volume_workspace_id_idx").on(table.workspaceId),
    index("runtime_volume_kind_idx").on(table.kind),
    index("runtime_volume_owner_user_id_idx").on(table.ownerUserId),
    index("runtime_volume_coworker_id_idx").on(table.coworkerId),
    uniqueIndex("runtime_volume_storage_prefix_idx").on(table.storagePrefix),
  ],
);
