import { z } from "zod";

export const workspaceIdSchema = z.string().trim().min(1).describe("Workspace ID");

export const paginationSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
};

export const detailSchema = z.enum(["summary", "full"]).default("summary").optional();

export const attachmentReferenceSchema = z.object({
  attachmentId: z.string().min(1).describe("Ready attachment ID"),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export function toFileAttachments(
  attachments:
    | Array<{
        attachmentId: string;
        name?: string;
        mimeType?: string;
        sizeBytes?: number;
      }>
    | undefined,
) {
  return attachments?.map(({ attachmentId, ...metadata }) => ({
    fileAssetId: attachmentId,
    ...metadata,
  }));
}
