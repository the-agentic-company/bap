import {
  assertReadyFileAssetsForWorkspace,
  createFileAssetFromBuffer,
  type ReadyFileAsset,
} from "@bap/core/server/services/file-asset-service";
import {
  buildCoworkerDocumentsRuntimeVolumePrefix,
  buildRuntimeVolumeObjectKey,
  deleteRuntimeVolumeFile,
  readRuntimeVolumeFile,
  writeRuntimeVolumeFile,
} from "@bap/core/server/services/runtime-volume-service";
import { downloadFromS3 } from "@bap/core/server/storage/s3-client";
import { db } from "@bap/db/client";
import { coworker, coworkerDocument } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { validateFileUpload } from "@/server/storage/validation";

type Database = typeof db;

export async function uploadCoworkerDocument(params: {
  database: Database;
  userId: string;
  coworkerId: string;
  filename: string;
  mimeType: string;
  contentBase64?: string;
  fileAssetId?: string;
  description?: string | undefined;
}): Promise<{
  id: string;
  fileAssetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const existingCoworker = await params.database.query.coworker.findFirst({
    where: and(eq(coworker.id, params.coworkerId), eq(coworker.ownerId, params.userId)),
    columns: {
      id: true,
      workspaceId: true,
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }
  if (!existingCoworker.workspaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Coworker workspace not found" });
  }

  const [{ value: documentCount }] = await params.database
    .select({ value: count() })
    .from(coworkerDocument)
    .where(eq(coworkerDocument.coworkerId, params.coworkerId));

  const asset = await resolveCoworkerDocumentAsset({
    database: params.database,
    userId: params.userId,
    workspaceId: existingCoworker.workspaceId,
    filename: params.filename,
    mimeType: params.mimeType,
    contentBase64: params.contentBase64,
    fileAssetId: params.fileAssetId,
  });
  validateFileUpload(asset.filename, asset.mimeType, asset.sizeBytes, documentCount);
  const storagePrefix = buildCoworkerDocumentsRuntimeVolumePrefix({
    workspaceId: existingCoworker.workspaceId,
    coworkerId: params.coworkerId,
  });
  await writeRuntimeVolumeFile({
    storagePrefix,
    relativePath: asset.filename,
    body: await downloadFromS3(asset.storageKey),
    contentType: asset.mimeType,
  });

  const [document] = await params.database
    .insert(coworkerDocument)
    .values({
      coworkerId: params.coworkerId,
      fileAssetId: null,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      storageKey: buildRuntimeVolumeObjectKey(storagePrefix, asset.filename),
      description: params.description,
    })
    .returning();

  return {
    id: document.id,
    fileAssetId: asset.id,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
  };
}

export async function updateCoworkerDocument(params: {
  database: Database;
  userId: string;
  documentId: string;
  filename?: string | undefined;
  mimeType?: string | undefined;
  contentBase64?: string | undefined;
  fileAssetId?: string | undefined;
  description?: string | null | undefined;
}): Promise<{
  id: string;
  fileAssetId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
}> {
  const hasFilename = params.filename !== undefined;
  const hasMimeType = params.mimeType !== undefined;
  const hasContent = params.contentBase64 !== undefined;
  const hasFileAssetId = params.fileAssetId !== undefined;
  const hasDescription = params.description !== undefined;
  const isFileReplacement = hasContent || hasMimeType || hasFileAssetId;

  if (!hasFilename && !hasDescription && !isFileReplacement) {
    throw new ORPCError("BAD_REQUEST", { message: "Document update must include a change" });
  }

  if (hasContent && (!params.filename || !params.mimeType || !params.contentBase64)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "File replacement requires filename, mimeType, and content",
    });
  }
  if (hasMimeType && !hasContent && !hasFileAssetId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "File replacement requires filename, mimeType, and content",
    });
  }
  if (hasFileAssetId && (hasContent || hasMimeType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "File replacement must provide either fileAssetId or base64 content",
    });
  }

  if (!isFileReplacement && hasMimeType) {
    throw new ORPCError("BAD_REQUEST", {
      message: "mimeType can only be changed when replacing file content",
    });
  }

  if (hasFilename && (!params.filename || params.filename.length > 256)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Filename is required and must be under 256 characters",
    });
  }

  const existingDocument = await params.database.query.coworkerDocument.findFirst({
    where: eq(coworkerDocument.id, params.documentId),
    columns: {
      id: true,
      coworkerId: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      description: true,
    },
  });

  if (!existingDocument) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  const existingCoworker = await params.database.query.coworker.findFirst({
    where: and(eq(coworker.id, existingDocument.coworkerId), eq(coworker.ownerId, params.userId)),
    columns: {
      id: true,
      workspaceId: true,
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }
  if ((hasFilename || isFileReplacement) && !existingCoworker.workspaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Coworker workspace not found" });
  }

  let replacementAsset: ReadyFileAsset | undefined;
  const updates: Partial<typeof coworkerDocument.$inferInsert> = {};

  if (hasFilename) {
    updates.filename = params.filename;
  }
  if (hasDescription) {
    updates.description = params.description;
  }

  if (isFileReplacement) {
    const asset = await resolveCoworkerDocumentAsset({
      database: params.database,
      userId: params.userId,
      workspaceId: existingCoworker.workspaceId!,
      filename: params.filename ?? existingDocument.filename,
      mimeType: params.mimeType ?? existingDocument.mimeType,
      contentBase64: params.contentBase64,
      fileAssetId: params.fileAssetId,
    });
    // Replacement does not increase the number of documents, so skip the count-limit branch.
    validateFileUpload(asset.filename, asset.mimeType, asset.sizeBytes, 0);

    replacementAsset = asset;
    updates.fileAssetId = null;
    updates.filename = asset.filename;
    updates.mimeType = asset.mimeType;
    updates.sizeBytes = asset.sizeBytes;
  }

  let deletePreviousRuntimeFile = false;
  if (existingCoworker.workspaceId && (hasFilename || isFileReplacement)) {
    const storagePrefix = buildCoworkerDocumentsRuntimeVolumePrefix({
      workspaceId: existingCoworker.workspaceId,
      coworkerId: existingDocument.coworkerId,
    });
    const nextFilename = updates.filename ?? existingDocument.filename;
    const nextMimeType = updates.mimeType ?? existingDocument.mimeType;
    const nextBody = replacementAsset
      ? await downloadFromS3(replacementAsset.storageKey)
      : await readRuntimeVolumeFile({
          storagePrefix,
          relativePath: existingDocument.filename,
        });
    await writeRuntimeVolumeFile({
      storagePrefix,
      relativePath: nextFilename,
      body: nextBody,
      contentType: nextMimeType,
    });
    updates.fileAssetId = null;
    updates.storageKey = buildRuntimeVolumeObjectKey(storagePrefix, nextFilename);
    deletePreviousRuntimeFile = existingDocument.filename !== nextFilename;
  }

  let updatedDocument: typeof coworkerDocument.$inferSelect | undefined;
  [updatedDocument] = await params.database
    .update(coworkerDocument)
    .set(updates)
    .where(eq(coworkerDocument.id, existingDocument.id))
    .returning();

  if (!updatedDocument) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  if (existingCoworker.workspaceId && deletePreviousRuntimeFile) {
    await deleteRuntimeVolumeFile({
      storagePrefix: buildCoworkerDocumentsRuntimeVolumePrefix({
        workspaceId: existingCoworker.workspaceId,
        coworkerId: existingDocument.coworkerId,
      }),
      relativePath: existingDocument.filename,
    }).catch(() => undefined);
  }

  return {
    id: updatedDocument.id,
    fileAssetId: updatedDocument.fileAssetId,
    filename: updatedDocument.filename,
    mimeType: updatedDocument.mimeType,
    sizeBytes: updatedDocument.sizeBytes,
    description: updatedDocument.description ?? null,
  };
}

async function resolveCoworkerDocumentAsset(params: {
  database: Database;
  userId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  contentBase64?: string;
  fileAssetId?: string;
}): Promise<ReadyFileAsset> {
  if (params.fileAssetId) {
    const [asset] = await assertReadyFileAssetsForWorkspace({
      database: params.database,
      workspaceId: params.workspaceId,
      fileAssetIds: [params.fileAssetId],
    });
    return asset;
  }
  if (!params.contentBase64) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Document upload requires fileAssetId or content",
    });
  }
  return await createFileAssetFromBuffer({
    database: params.database,
    userId: params.userId,
    workspaceId: params.workspaceId,
    filename: params.filename,
    mimeType: params.mimeType,
    content: Buffer.from(params.contentBase64, "base64"),
  });
}

export async function deleteCoworkerDocument(params: {
  database: Database;
  userId: string;
  documentId: string;
}): Promise<{ success: true; filename: string }> {
  const existingDocument = await params.database.query.coworkerDocument.findFirst({
    where: eq(coworkerDocument.id, params.documentId),
    columns: {
      id: true,
      coworkerId: true,
      filename: true,
    },
  });

  if (!existingDocument) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  const existingCoworker = await params.database.query.coworker.findFirst({
    where: and(eq(coworker.id, existingDocument.coworkerId), eq(coworker.ownerId, params.userId)),
    columns: {
      id: true,
      workspaceId: true,
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  if (existingCoworker.workspaceId) {
    await deleteRuntimeVolumeFile({
      storagePrefix: buildCoworkerDocumentsRuntimeVolumePrefix({
        workspaceId: existingCoworker.workspaceId,
        coworkerId: existingDocument.coworkerId,
      }),
      relativePath: existingDocument.filename,
    }).catch(() => undefined);
  }
  await params.database
    .delete(coworkerDocument)
    .where(eq(coworkerDocument.id, existingDocument.id));

  return {
    success: true,
    filename: existingDocument.filename,
  };
}
