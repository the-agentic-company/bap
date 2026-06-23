import {
  fileAsset,
  fileAssetReference,
  uploadSession,
  type fileAssetReferenceKindEnum,
} from "@bap/db/schema";
import { and, count, eq, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import {
  deleteFromS3,
  ensureBucket,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  headS3Object,
  uploadToS3,
} from "../storage/s3-client";

type Database = typeof import("@bap/db/client").db;
type FileAssetReferenceKind = (typeof fileAssetReferenceKindEnum.enumValues)[number];

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const FILE_ASSET_LIMITS = {
  maxFileSizeBytes: 1 * GB,
  maxMessageAttachmentCount: 10,
  maxMessageAttachmentTotalBytes: 2 * GB,
  maxActiveUploadSessionsPerUser: 20,
  workspaceQuotaBytes: 100 * GB,
  uploadSessionTtlMs: 15 * 60 * 1000,
  unattachedCleanupGraceMs: 24 * 60 * 60 * 1000,
  signedDownloadTtlSeconds: 5 * 60,
} as const;

export class FileAssetError extends Error {
  constructor(
    public readonly code:
      | "invalid_file"
      | "file_too_large"
      | "quota_exceeded"
      | "active_upload_limit"
      | "upload_session_not_found"
      | "upload_session_not_pending"
      | "upload_session_expired"
      | "uploaded_size_mismatch"
      | "file_asset_not_found"
      | "file_asset_not_ready",
    message: string,
  ) {
    super(message);
    this.name = "FileAssetError";
  }
}

export type ReadyFileAsset = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
};

function assertValidFileInput(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): void {
  if (!input.filename || input.filename.length > 256) {
    throw new FileAssetError("invalid_file", "Filename is required and must be under 256 characters");
  }
  if (!input.mimeType) {
    throw new FileAssetError("invalid_file", "MIME type is required");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new FileAssetError("invalid_file", "File size must be a positive integer");
  }
  if (input.sizeBytes > FILE_ASSET_LIMITS.maxFileSizeBytes) {
    throw new FileAssetError(
      "file_too_large",
      `File size exceeds maximum of ${FILE_ASSET_LIMITS.maxFileSizeBytes / MB} MB`,
    );
  }
}

function buildUploadStorageKey(workspaceId: string, uploadSessionId: string): string {
  return `file-assets/${workspaceId}/uploads/${uploadSessionId}`;
}

function buildServerStorageKey(workspaceId: string, fileAssetId: string): string {
  return `file-assets/${workspaceId}/server/${fileAssetId}`;
}

async function sumWorkspaceReadyFileAssetBytes(
  database: Database,
  workspaceId: string,
): Promise<number> {
  const [row] = await database
    .select({
      value: sql<number>`coalesce(sum(${fileAsset.sizeBytes}), 0)`,
    })
    .from(fileAsset)
    .where(
      and(
        eq(fileAsset.workspaceId, workspaceId),
        inArray(fileAsset.status, ["ready", "cleanup_pending"]),
        isNull(fileAsset.deletedAt),
      ),
    );

  return Number(row?.value ?? 0);
}

async function sumWorkspaceActiveUploadReservationBytes(
  database: Database,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const [row] = await database
    .select({
      value: sql<number>`coalesce(sum(${uploadSession.declaredSizeBytes}), 0)`,
    })
    .from(uploadSession)
    .where(
      and(
        eq(uploadSession.workspaceId, workspaceId),
        eq(uploadSession.status, "pending"),
        gt(uploadSession.expiresAt, now),
      ),
    );

  return Number(row?.value ?? 0);
}

async function assertWorkspaceQuotaAvailable(input: {
  database: Database;
  workspaceId: string;
  additionalReservedBytes: number;
  now: Date;
}): Promise<void> {
  const [readyBytes, activeUploadBytes] = await Promise.all([
    sumWorkspaceReadyFileAssetBytes(input.database, input.workspaceId),
    sumWorkspaceActiveUploadReservationBytes(input.database, input.workspaceId, input.now),
  ]);
  const nextTotal = readyBytes + activeUploadBytes + input.additionalReservedBytes;
  if (nextTotal > FILE_ASSET_LIMITS.workspaceQuotaBytes) {
    throw new FileAssetError("quota_exceeded", "Workspace file storage quota exceeded");
  }
}

async function assertActiveUploadSessionLimit(input: {
  database: Database;
  userId: string;
  now: Date;
}): Promise<void> {
  const [row] = await input.database
    .select({ value: count() })
    .from(uploadSession)
    .where(
      and(
        eq(uploadSession.userId, input.userId),
        eq(uploadSession.status, "pending"),
        gt(uploadSession.expiresAt, input.now),
      ),
    );

  if ((row?.value ?? 0) >= FILE_ASSET_LIMITS.maxActiveUploadSessionsPerUser) {
    throw new FileAssetError("active_upload_limit", "Too many active uploads");
  }
}

export async function createUploadSession(input: {
  database: Database;
  userId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{
  uploadSessionId: string;
  uploadUrl: string;
  expiresAt: Date;
}> {
  assertValidFileInput(input);
  const now = new Date();
  await assertActiveUploadSessionLimit({
    database: input.database,
    userId: input.userId,
    now,
  });
  await assertWorkspaceQuotaAvailable({
    database: input.database,
    workspaceId: input.workspaceId,
    additionalReservedBytes: input.sizeBytes,
    now,
  });

  await ensureBucket();
  const uploadSessionId = crypto.randomUUID();
  const storageKey = buildUploadStorageKey(input.workspaceId, uploadSessionId);
  const expiresAt = new Date(now.getTime() + FILE_ASSET_LIMITS.uploadSessionTtlMs);

  await input.database.insert(uploadSession).values({
    id: uploadSessionId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    filename: input.filename,
    mimeType: input.mimeType,
    declaredSizeBytes: input.sizeBytes,
    storageKey,
    expiresAt,
  });

  return {
    uploadSessionId,
    uploadUrl: await getPresignedUploadUrl(storageKey, input.mimeType),
    expiresAt,
  };
}

export async function completeUploadSession(input: {
  database: Database;
  userId: string;
  workspaceId: string;
  uploadSessionId: string;
}): Promise<ReadyFileAsset> {
  const session = await input.database.query.uploadSession.findFirst({
    where: and(
      eq(uploadSession.id, input.uploadSessionId),
      eq(uploadSession.userId, input.userId),
      eq(uploadSession.workspaceId, input.workspaceId),
    ),
  });

  if (!session) {
    throw new FileAssetError("upload_session_not_found", "Upload session not found");
  }
  if (session.status !== "pending") {
    throw new FileAssetError("upload_session_not_pending", "Upload session is not pending");
  }
  const now = new Date();
  if (session.expiresAt <= now) {
    await input.database
      .update(uploadSession)
      .set({ status: "expired", failedAt: now, failureReason: "expired" })
      .where(eq(uploadSession.id, session.id));
    throw new FileAssetError("upload_session_expired", "Upload session expired");
  }

  const object = await headS3Object(session.storageKey);
  if (object.sizeBytes !== session.declaredSizeBytes) {
    await input.database
      .update(uploadSession)
      .set({
        status: "failed",
        actualSizeBytes: object.sizeBytes,
        storageEtag: object.etag,
        failedAt: now,
        failureReason: "uploaded_size_mismatch",
      })
      .where(eq(uploadSession.id, session.id));
    throw new FileAssetError("uploaded_size_mismatch", "Uploaded file size does not match declared size");
  }
  await assertWorkspaceQuotaAvailable({
    database: input.database,
    workspaceId: input.workspaceId,
    additionalReservedBytes: 0,
    now,
  });

  const [asset] = await input.database
    .insert(fileAsset)
    .values({
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      filename: session.filename,
      mimeType: session.mimeType,
      sizeBytes: object.sizeBytes,
      storageKey: session.storageKey,
      storageEtag: object.etag,
      status: "ready",
    })
    .returning();

  await input.database
    .update(uploadSession)
    .set({
      status: "completed",
      fileAssetId: asset.id,
      actualSizeBytes: object.sizeBytes,
      storageEtag: object.etag,
      completedAt: now,
    })
    .where(eq(uploadSession.id, session.id));

  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    storageKey: asset.storageKey,
  };
}

export async function createFileAssetFromBuffer(input: {
  database: Database;
  userId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}): Promise<ReadyFileAsset> {
  assertValidFileInput({ ...input, sizeBytes: input.content.length });
  const now = new Date();
  await assertWorkspaceQuotaAvailable({
    database: input.database,
    workspaceId: input.workspaceId,
    additionalReservedBytes: input.content.length,
    now,
  });

  await ensureBucket();
  const fileAssetId = crypto.randomUUID();
  const storageKey = buildServerStorageKey(input.workspaceId, fileAssetId);
  await uploadToS3(storageKey, input.content, input.mimeType);

  const [asset] = await input.database
    .insert(fileAsset)
    .values({
      id: fileAssetId,
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
      storageKey,
      status: "ready",
    })
    .returning();

  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    storageKey: asset.storageKey,
  };
}

export async function assertReadyFileAssetsForWorkspace(input: {
  database: Database;
  workspaceId: string;
  fileAssetIds: string[];
}): Promise<ReadyFileAsset[]> {
  if (input.fileAssetIds.length === 0) {
    return [];
  }
  const rows = await input.database.query.fileAsset.findMany({
    where: and(
      inArray(fileAsset.id, input.fileAssetIds),
      eq(fileAsset.workspaceId, input.workspaceId),
      ne(fileAsset.status, "purged"),
      isNull(fileAsset.deletedAt),
    ),
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return input.fileAssetIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      throw new FileAssetError("file_asset_not_found", "File asset not found");
    }
    if (row.status !== "ready") {
      throw new FileAssetError("file_asset_not_ready", "File asset is not ready");
    }
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      storageKey: row.storageKey,
    };
  });
}

export function assertMessageAttachmentLimits(assets: ReadyFileAsset[]): void {
  if (assets.length > FILE_ASSET_LIMITS.maxMessageAttachmentCount) {
    throw new FileAssetError("invalid_file", "Too many message attachments");
  }
  const totalSize = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  if (totalSize > FILE_ASSET_LIMITS.maxMessageAttachmentTotalBytes) {
    throw new FileAssetError("file_too_large", "Message attachments exceed total size limit");
  }
}

export async function markFileAssetReference(input: {
  database: Database;
  fileAssetId: string;
  kind: FileAssetReferenceKind;
  referenceId: string;
}): Promise<void> {
  await input.database
    .insert(fileAssetReference)
    .values({
      fileAssetId: input.fileAssetId,
      kind: input.kind,
      referenceId: input.referenceId,
    })
    .onConflictDoNothing();
}

export async function getFileAssetDownloadUrl(input: {
  database: Database;
  workspaceId: string;
  fileAssetId: string;
}): Promise<{
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const [asset] = await assertReadyFileAssetsForWorkspace({
    database: input.database,
    workspaceId: input.workspaceId,
    fileAssetIds: [input.fileAssetId],
  });

  return {
    url: await getPresignedDownloadUrl(asset.storageKey, FILE_ASSET_LIMITS.signedDownloadTtlSeconds, {
      filename: asset.filename,
      contentType: asset.mimeType,
    }),
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  };
}

export async function expireUploadSessions(input: {
  database: Database;
  now?: Date;
}): Promise<{ expiredCount: number }> {
  const now = input.now ?? new Date();
  const expiredSessions = await input.database.query.uploadSession.findMany({
    where: and(eq(uploadSession.status, "pending"), lte(uploadSession.expiresAt, now)),
    columns: {
      id: true,
      storageKey: true,
    },
  });

  if (expiredSessions.length === 0) {
    return { expiredCount: 0 };
  }

  await input.database
    .update(uploadSession)
    .set({ status: "expired", failedAt: now, failureReason: "expired" })
    .where(inArray(uploadSession.id, expiredSessions.map((session) => session.id)));

  await Promise.all(
    expiredSessions.map((session) => deleteFromS3(session.storageKey).catch(() => undefined)),
  );

  return { expiredCount: expiredSessions.length };
}

export async function markUnreferencedFileAssetsCleanupPending(input: {
  database: Database;
  now?: Date;
}): Promise<{ markedCount: number }> {
  const now = input.now ?? new Date();
  const olderThan = new Date(now.getTime() - FILE_ASSET_LIMITS.unattachedCleanupGraceMs);
  const candidates = await input.database
    .select({ id: fileAsset.id })
    .from(fileAsset)
    .where(
      and(
        eq(fileAsset.status, "ready"),
        isNull(fileAsset.deletedAt),
        lt(fileAsset.createdAt, olderThan),
        sql`not exists (
          select 1 from ${fileAssetReference}
          where ${fileAssetReference.fileAssetId} = ${fileAsset.id}
        )`,
      ),
    );

  if (candidates.length === 0) {
    return { markedCount: 0 };
  }

  await input.database
    .update(fileAsset)
    .set({ status: "cleanup_pending", cleanupEligibleAt: now })
    .where(inArray(fileAsset.id, candidates.map((candidate) => candidate.id)));

  return { markedCount: candidates.length };
}

export async function purgeCleanupPendingFileAssets(input: {
  database: Database;
  now?: Date;
  limit?: number;
}): Promise<{ purgedCount: number }> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 100;
  const candidates = await input.database.query.fileAsset.findMany({
    where: and(
      eq(fileAsset.status, "cleanup_pending"),
      lte(fileAsset.cleanupEligibleAt, now),
      sql`not exists (
        select 1 from ${fileAssetReference}
        where ${fileAssetReference.fileAssetId} = ${fileAsset.id}
      )`,
    ),
    columns: {
      id: true,
      storageKey: true,
    },
    limit,
  });

  for (const candidate of candidates) {
    await deleteFromS3(candidate.storageKey).catch(() => undefined);
    await input.database
      .update(fileAsset)
      .set({
        status: "purged",
        deletedAt: now,
        purgedAt: now,
      })
      .where(eq(fileAsset.id, candidate.id));
  }

  return { purgedCount: candidates.length };
}
