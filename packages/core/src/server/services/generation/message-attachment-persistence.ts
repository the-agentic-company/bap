import { db } from "@bap/db/client";
import { messageAttachment } from "@bap/db/schema";
import type { UserFileAttachment } from "./queue/conversation-turn-queue";

/**
 * Upload each user file attachment for a message to object storage and record a
 * `messageAttachment` row pointing at it. The S3 client is imported lazily so the
 * storage dependency is only pulled in when an attachment actually needs saving.
 * A no-op when there are no attachments.
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

  const { uploadToS3, ensureBucket } = await import("../../storage/s3-client");
  await ensureBucket();

  await Promise.all(
    attachments.map(async (attachment) => {
      const base64Data = attachment.dataUrl.split(",")[1] || "";
      const buffer = Buffer.from(base64Data, "base64");
      const sanitizedFilename = attachment.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const storageKey = `attachments/${params.conversationId}/${params.messageId}/${Date.now()}-${sanitizedFilename}`;
      await uploadToS3(storageKey, buffer, attachment.mimeType);
      await db.insert(messageAttachment).values({
        messageId: params.messageId,
        filename: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: buffer.length,
        storageKey,
      });
    }),
  );
}
