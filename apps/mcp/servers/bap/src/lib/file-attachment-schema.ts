import { type FileAttachmentInput } from "@bap/client";
import { z } from "zod";

export const fileAttachmentInputSchema: z.ZodType<FileAttachmentInput> = z.object({
  fileAssetId: z.string().min(1).describe("Ready File Asset ID to attach"),
  name: z.string().optional().describe("Optional display name for the attachment"),
  mimeType: z.string().optional().describe("Optional MIME type override"),
  sizeBytes: z.number().int().nonnegative().optional().describe("Optional file size hint"),
});
