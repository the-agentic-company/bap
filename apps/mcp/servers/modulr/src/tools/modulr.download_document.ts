import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { createManagedModulrClient, getManagedModulrClaims } from "../lib/modulr-auth";

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_URL_TTL_SECONDS = 3600;

function sanitizeFilename(value: string) {
  const sanitized = value
    .replace(/[/:\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "modulr-document";
}

async function resolveDownloadBaseUrl(): Promise<string> {
  const [{ env }, { resolvePublicCallbackBaseUrl }] = await Promise.all([
    import("@cmdclaw/core/env"),
    import("@cmdclaw/core/lib/worktree-routing"),
  ]);
  const baseUrl = resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    nextPublicAppUrl: env.NEXT_PUBLIC_APP_URL,
    nodeEnv: env.NODE_ENV,
  });
  if (!baseUrl) {
    throw new Error("Unable to resolve CmdClaw app URL for Modulr document downloads.");
  }
  return baseUrl;
}

async function buildDownloadUrl(token: string): Promise<string> {
  const url = new URL("/api/modulr/documents/download", await resolveDownloadBaseUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

export const schema = {
  documentId: z.string().min(1).describe("Modulr document id"),
};

export const metadata: ToolMetadata = {
  name: "modulr.download_document",
  description:
    "Download a Modulr document into CmdClaw storage and return a direct downloadable URL.",
  annotations: {
    title: "Download document",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function downloadDocument(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const claims = getManagedModulrClaims(extra);
  const client = await createManagedModulrClient(extra);
  const document = await client.getDocument(params.documentId);
  const byteLength = Buffer.byteLength(document.blob, "base64");
  if (byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Document ${document.id} is too large to return through this tool (${byteLength} bytes).`,
    );
  }

  const filename = sanitizeFilename(
    document.filename ?? document.title ?? `modulr-document-${document.id}`,
  );
  const storageFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storageKey = `modulr-documents/${claims.workspaceId}/${document.id}/${Date.now()}-${storageFilename}`;
  const body = Buffer.from(document.blob, "base64");

  const [{ env }, { signModulrDocumentDownloadToken }, { ensureBucket, uploadToS3 }] =
    await Promise.all([
      import("@cmdclaw/core/env"),
      import("@cmdclaw/core/server/modulr/download-token"),
      import("@cmdclaw/core/server/storage/s3-client"),
    ]);
  await ensureBucket();
  await uploadToS3(storageKey, body, document.mimeType);
  const token = signModulrDocumentDownloadToken(
    {
      storageKey,
      filename,
      mimeType: document.mimeType,
      workspaceId: claims.workspaceId,
      documentId: document.id,
      sizeBytes: byteLength,
      exp: Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL_SECONDS,
    },
    env.CMDCLAW_SERVER_SECRET,
  );
  const downloadUrl = await buildDownloadUrl(token);

  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Downloaded ${filename} from Modulr and stored it in CmdClaw storage.`,
          `Download URL: ${downloadUrl}`,
        ].join("\n"),
      },
    ],
    structuredContent: {
      id: document.id,
      title: document.title,
      filename,
      mimeType: document.mimeType,
      resourceUri: document.resourceUri,
      sizeBytes: byteLength,
      downloadUrl,
    },
  };
}
