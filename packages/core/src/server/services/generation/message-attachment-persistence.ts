import { db } from "@bap/db/client";
import { conversation, messageAttachment } from "@bap/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  assertMessageAttachmentLimits,
  assertReadyFileAssetsForWorkspace,
  FILE_ASSET_LIMITS,
  FileAssetError,
  markFileAssetReference,
  type ReadyFileAsset,
} from "../file-asset-service";
import { isFileAssetUserAttachment, type UserFileAttachment } from "./attachments";

function assertReadyMessageAttachmentLimits(assets: ReadyFileAsset[]): void {
  if (assets.length > FILE_ASSET_LIMITS.maxMessageAttachmentCount) {
    throw new FileAssetError("invalid_file", "Too many message attachments");
  }
  const totalSize = assets.reduce((sum, asset) => {
    if (asset.sizeBytes > FILE_ASSET_LIMITS.maxFileSizeBytes) {
      throw new FileAssetError("file_too_large", "File size exceeds maximum");
    }
    return sum + asset.sizeBytes;
  }, 0);
  if (totalSize > FILE_ASSET_LIMITS.maxMessageAttachmentTotalBytes) {
    throw new FileAssetError("file_too_large", "Message attachments exceed total size limit");
  }
}

/**
 * Record Message Attachment product rows for user-supplied files. Browser-created
 * attachments must already be Ready File Assets.
 */
export async function persistMessageAttachments(params: {
  conversationId: string;
  messageId: string;
  attachments?: UserFileAttachment[];
}): Promise<void> {
  const attachments = params.attachments;
  if (!attachments || attachments.length === 0) {
    return;
  }

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, params.conversationId),
    columns: {
      id: true,
      userId: true,
      workspaceId: true,
    },
  });
  if (!conv?.workspaceId || !conv.userId) {
    throw new FileAssetError("file_asset_not_found", "Conversation workspace not found");
  }

  const fileAssetAttachmentIds = attachments
    .filter(isFileAssetUserAttachment)
    .map((attachment) => attachment.fileAssetId);
  if (fileAssetAttachmentIds.length !== attachments.length) {
    throw new FileAssetError("invalid_file", "Message attachments must reference File Assets");
  }

  const readyAssets =
    fileAssetAttachmentIds.length > 0
      ? await assertReadyFileAssetsForWorkspace({
          database: db,
          workspaceId: conv.workspaceId,
          fileAssetIds: fileAssetAttachmentIds,
        })
      : [];

  assertReadyMessageAttachmentLimits(readyAssets);
  assertMessageAttachmentLimits(readyAssets);

  const existingAttachments = await db.query.messageAttachment.findMany({
    where: and(
      eq(messageAttachment.messageId, params.messageId),
      inArray(messageAttachment.fileAssetId, fileAssetAttachmentIds),
    ),
    columns: {
      fileAssetId: true,
    },
  });
  const existingFileAssetIds = new Set(
    existingAttachments
      .map((attachment) => attachment.fileAssetId)
      .filter((fileAssetId): fileAssetId is string => typeof fileAssetId === "string"),
  );

  for (const asset of readyAssets) {
    if (existingFileAssetIds.has(asset.id)) {
      continue;
    }

    const [created] = await db
      .insert(messageAttachment)
      .values({
        messageId: params.messageId,
        fileAssetId: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        storageKey: asset.storageKey,
      })
      .returning({ id: messageAttachment.id });

    if (created) {
      await markFileAssetReference({
        database: db,
        fileAssetId: asset.id,
        kind: "message_attachment",
        referenceId: created.id,
      });
    }
  }
}
