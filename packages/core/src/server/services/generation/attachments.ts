import type { QueuedMessageAttachment } from "@bap/db/schema";

export type UserFileAttachment = QueuedMessageAttachment;

export type FileAssetUserAttachment = Extract<
  QueuedMessageAttachment,
  { fileAssetId: string }
>;

export function isFileAssetUserAttachment(
  value: unknown,
): value is FileAssetUserAttachment {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { fileAssetId?: unknown }).fileAssetId === "string"
  );
}

export function isUserFileAttachment(value: unknown): value is UserFileAttachment {
  return isFileAssetUserAttachment(value);
}
