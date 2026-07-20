import type { BapApiClient } from "@bap/client";

export async function handleAttachmentPrepareUpload(params: {
  client: BapApiClient;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const result = await params.client.fileAsset.createUpload({
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
  });
  return {
    status: "completed" as const,
    attachment: {
      attachmentId: result.uploadSessionId,
      uploadUrl: result.uploadUrl,
      expiresAt: result.expiresAt,
    },
  };
}

export async function handleAttachmentCompleteUpload(params: {
  client: BapApiClient;
  attachmentId: string;
}) {
  const file = await params.client.fileAsset.completeUpload({
    uploadSessionId: params.attachmentId,
  });
  return {
    status: "completed" as const,
    attachment: { attachmentId: file.id, ...file },
  };
}
