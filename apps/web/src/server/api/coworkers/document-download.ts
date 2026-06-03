import { downloadFromS3 } from "@cmdclaw/core/server/storage/s3-client";
import { db } from "@cmdclaw/db/client";
import { coworker, coworkerDocument } from "@cmdclaw/db/schema";
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

  const body = await downloadFromS3(existingDocument.storageKey);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": existingDocument.mimeType,
      "Content-Disposition": buildContentDisposition(existingDocument.filename),
      "Content-Length": body.byteLength.toString(),
      "Cache-Control": "private, no-store",
    },
  });
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
