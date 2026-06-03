import { env } from "@cmdclaw/core/env";
import { verifyModulrDocumentDownloadToken } from "@cmdclaw/core/server/modulr/download-token";
import { downloadFromS3 } from "@cmdclaw/core/server/storage/s3-client";

/**
 * Framework-neutral handler for `GET /api/modulr/documents/download`.
 *
 * Verifies a signed download token (no session auth) and streams the referenced
 * document from S3 with the exact binary bytes, MIME type, Content-Disposition,
 * Content-Length, and private/no-store cache headers preserved. API authorization
 * (token verification) lives here, not in a route page-guard.
 */
export async function downloadModulrDocument(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return Response.json({ error: "Missing download token." }, { status: 400 });
  }

  let claims: ReturnType<typeof verifyModulrDocumentDownloadToken>;
  try {
    claims = verifyModulrDocumentDownloadToken(token, env.CMDCLAW_SERVER_SECRET);
  } catch {
    return Response.json({ error: "Invalid or expired download token." }, { status: 401 });
  }

  const body = await downloadFromS3(claims.storageKey);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": claims.mimeType,
      "Content-Disposition": buildContentDisposition(claims.filename),
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
      .trim() || "modulr-document"
  );
}

export function buildContentDisposition(filename: string): string {
  const fallback = asciiFilenameFallback(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
