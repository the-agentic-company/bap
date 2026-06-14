import { deleteFromS3, ensureBucket, uploadToS3 } from "@bap/core/server/storage/s3-client";
import { db } from "@bap/db/client";
import { coworker, coworkerDocument } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { validateFileUpload } from "@/server/storage/validation";

type Database = typeof db;

function generateCoworkerDocumentStorageKey(
  userId: string,
  coworkerId: string,
  filename: string,
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `coworkers/${userId}/${coworkerId}/documents/${timestamp}-${sanitizedFilename}`;
}

export async function uploadCoworkerDocument(params: {
  database: Database;
  userId: string;
  coworkerId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  description?: string | undefined;
}): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const existingCoworker = await params.database.query.coworker.findFirst({
    where: and(eq(coworker.id, params.coworkerId), eq(coworker.ownerId, params.userId)),
    columns: {
      id: true,
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  const fileBuffer = Buffer.from(params.contentBase64, "base64");
  const sizeBytes = fileBuffer.length;
  const [{ value: documentCount }] = await params.database
    .select({ value: count() })
    .from(coworkerDocument)
    .where(eq(coworkerDocument.coworkerId, params.coworkerId));

  validateFileUpload(params.filename, params.mimeType, sizeBytes, documentCount);

  await ensureBucket();
  const storageKey = generateCoworkerDocumentStorageKey(
    params.userId,
    params.coworkerId,
    params.filename,
  );
  await uploadToS3(storageKey, fileBuffer, params.mimeType);

  const [document] = await params.database
    .insert(coworkerDocument)
    .values({
      coworkerId: params.coworkerId,
      filename: params.filename,
      mimeType: params.mimeType,
      sizeBytes,
      storageKey,
      description: params.description,
    })
    .returning();

  return {
    id: document.id,
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
  description?: string | null | undefined;
}): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
}> {
  const hasFilename = params.filename !== undefined;
  const hasMimeType = params.mimeType !== undefined;
  const hasContent = params.contentBase64 !== undefined;
  const hasDescription = params.description !== undefined;
  const isFileReplacement = hasContent || hasMimeType;

  if (!hasFilename && !hasDescription && !isFileReplacement) {
    throw new ORPCError("BAD_REQUEST", { message: "Document update must include a change" });
  }

  if (isFileReplacement && (!params.filename || !params.mimeType || !params.contentBase64)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "File replacement requires filename, mimeType, and content",
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
      storageKey: true,
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
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  let replacementStorageKey: string | undefined;
  const updates: Partial<typeof coworkerDocument.$inferInsert> = {};

  if (hasFilename) {
    updates.filename = params.filename;
  }
  if (hasDescription) {
    updates.description = params.description;
  }

  if (isFileReplacement) {
    const filename = params.filename!;
    const mimeType = params.mimeType!;
    const fileBuffer = Buffer.from(params.contentBase64!, "base64");
    const sizeBytes = fileBuffer.length;

    // Replacement does not increase the number of documents, so skip the count-limit branch.
    validateFileUpload(filename, mimeType, sizeBytes, 0);

    await ensureBucket();
    replacementStorageKey = generateCoworkerDocumentStorageKey(
      params.userId,
      existingDocument.coworkerId,
      filename,
    );
    await uploadToS3(replacementStorageKey, fileBuffer, mimeType);

    updates.filename = filename;
    updates.mimeType = mimeType;
    updates.sizeBytes = sizeBytes;
    updates.storageKey = replacementStorageKey;
  }

  let updatedDocument: typeof coworkerDocument.$inferSelect | undefined;
  try {
    [updatedDocument] = await params.database
      .update(coworkerDocument)
      .set(updates)
      .where(eq(coworkerDocument.id, existingDocument.id))
      .returning();
  } catch (error) {
    if (replacementStorageKey) {
      await deleteFromS3(replacementStorageKey).catch(() => undefined);
    }
    throw error;
  }

  if (!updatedDocument) {
    if (replacementStorageKey) {
      await deleteFromS3(replacementStorageKey).catch(() => undefined);
    }
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  if (replacementStorageKey) {
    await deleteFromS3(existingDocument.storageKey);
  }

  return {
    id: updatedDocument.id,
    filename: updatedDocument.filename,
    mimeType: updatedDocument.mimeType,
    sizeBytes: updatedDocument.sizeBytes,
    description: updatedDocument.description ?? null,
  };
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
      storageKey: true,
    },
  });

  if (!existingDocument) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  const existingCoworker = await params.database.query.coworker.findFirst({
    where: and(eq(coworker.id, existingDocument.coworkerId), eq(coworker.ownerId, params.userId)),
    columns: {
      id: true,
    },
  });

  if (!existingCoworker) {
    throw new ORPCError("NOT_FOUND", { message: "Document not found" });
  }

  await deleteFromS3(existingDocument.storageKey);
  await params.database
    .delete(coworkerDocument)
    .where(eq(coworkerDocument.id, existingDocument.id));

  return {
    success: true,
    filename: existingDocument.filename,
  };
}
