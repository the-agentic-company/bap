import { getFileAssetDownloadUrl } from "@bap/core/server/services/file-asset-service";
import { getPresignedDownloadUrl } from "@bap/core/server/storage/s3-client";
import { db } from "@bap/db/client";
import { sandboxFile } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";

const SANDBOX_FILE_DOWNLOAD_TTL_MS = 60 * 60 * 1000;

export function buildSandboxFileDownloadUrl(fileId: string): string {
  const expiresAt = Date.now() + SANDBOX_FILE_DOWNLOAD_TTL_MS;
  const token = signSandboxFileDownload(fileId, expiresAt);
  const url = new URL(
    `/api/sandbox-files/${encodeURIComponent(fileId)}/download`,
    getPublicAppBaseUrl(),
  );
  url.searchParams.set("expiresAt", expiresAt.toString());
  url.searchParams.set("token", token);
  return url.toString();
}

export async function downloadSandboxFile(request: Request, fileId: string): Promise<Response> {
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get("expiresAt"));
  const token = url.searchParams.get("token") ?? "";

  if (!Number.isSafeInteger(expiresAt) || Date.now() > expiresAt) {
    return Response.json({ error: "Download link expired" }, { status: 401 });
  }

  if (!verifySandboxFileDownload(fileId, expiresAt, token)) {
    return Response.json({ error: "Invalid download token" }, { status: 401 });
  }

  const file = await db.query.sandboxFile.findFirst({
    where: eq(sandboxFile.id, fileId),
    columns: {
      filename: true,
      mimeType: true,
      storageKey: true,
      fileAssetId: true,
    },
    with: {
      conversation: {
        columns: {
          workspaceId: true,
        },
      },
    },
  });

  if (!file?.storageKey) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  const signedUrl =
    file.fileAssetId && file.conversation.workspaceId
      ? (
          await getFileAssetDownloadUrl({
            database: db,
            workspaceId: file.conversation.workspaceId,
            fileAssetId: file.fileAssetId,
          })
        ).url
      : await getPresignedDownloadUrl(file.storageKey, 300, {
          filename: file.filename,
          contentType: file.mimeType,
        });

  return Response.redirect(signedUrl, 302);
}

function getPublicAppBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    process.env.APP_SERVER_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  );
}

function getDownloadSecret(): string {
  const secret = process.env.APP_SERVER_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("APP_SERVER_SECRET or BETTER_AUTH_SECRET must be configured");
  }
  return secret;
}

function signSandboxFileDownload(fileId: string, expiresAt: number): string {
  return createHmac("sha256", getDownloadSecret())
    .update(`${fileId}.${expiresAt}`)
    .digest("base64url");
}

function verifySandboxFileDownload(fileId: string, expiresAt: number, token: string): boolean {
  const expected = Buffer.from(signSandboxFileDownload(fileId, expiresAt));
  const actual = Buffer.from(token);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
