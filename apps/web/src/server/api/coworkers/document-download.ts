import { getFileAssetDownloadUrl } from "@bap/core/server/services/file-asset-service";
import { getPresignedDownloadUrl } from "@bap/core/server/storage/s3-client";
import { db } from "@bap/db/client";
import { coworker, coworkerDocument } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireActiveWorkspaceAccess } from "@/server/orpc/workspace-access";

/**
 * Framework-neutral handler for `GET /api/coworkers/documents/:id/download`.
 *
 * Streams an owned coworker document from S3 with the exact binary bytes, MIME type,
 * Content-Disposition, Content-Length, and private/no-store cache headers preserved.
 * API authorization (session + active workspace ownership) lives here, not in a route
 * page-guard.
 */
export async function downloadCoworkerDocument(
  request: Request,
  documentId: string,
): Promise<Response> {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingDocument = await db.query.coworkerDocument.findFirst({
    where: eq(coworkerDocument.id, documentId),
    columns: {
      coworkerId: true,
      filename: true,
      mimeType: true,
      storageKey: true,
      fileAssetId: true,
    },
  });

  if (!existingDocument) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const activeWorkspace = await requireActiveWorkspaceAccess(sessionData.user.id);
  const coworkerRow = await db.query.coworker.findFirst({
    where: and(
      eq(coworker.id, existingDocument.coworkerId),
      eq(coworker.ownerId, sessionData.user.id),
      eq(coworker.workspaceId, activeWorkspace.workspace.id),
    ),
    columns: {
      id: true,
    },
  });

  if (!coworkerRow) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const signedUrl = existingDocument.fileAssetId
    ? (
        await getFileAssetDownloadUrl({
          database: db,
          workspaceId: activeWorkspace.workspace.id,
          fileAssetId: existingDocument.fileAssetId,
        })
      ).url
    : await getPresignedDownloadUrl(existingDocument.storageKey, 300, {
        filename: existingDocument.filename,
        contentType: existingDocument.mimeType,
      });

  return Response.redirect(signedUrl, 302);
}

function asciiFilenameFallback(filename: string): string {
  return (
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .replace(/[/:]/g, "-")
      .trim() || "coworker-document"
  );
}

export function buildContentDisposition(filename: string): string {
  const fallback = asciiFilenameFallback(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
