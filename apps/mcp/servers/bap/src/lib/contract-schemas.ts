import { z } from "zod";

export const workspaceIdSchema = z.string().trim().min(1).describe("Workspace ID");

export const detailSchema = z.enum(["summary", "full"]).default("summary").optional();

export const coworkerReadQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("get"), reference: z.string().min(1) }).strict(),
  z.object({ type: z.literal("export"), reference: z.string().min(1) }).strict(),
]);

export const skillReadQuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("get"), id: z.string().min(1) }).strict(),
]);

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
