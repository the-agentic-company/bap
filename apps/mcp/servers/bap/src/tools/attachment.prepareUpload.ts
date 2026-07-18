import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleAttachmentPrepareUpload } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  filename: z.string().min(1).max(256),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
};
export const metadata: ToolMetadata = {
  name: "attachment.prepareUpload",
  description:
    "Prepare a direct attachment upload and return a signed upload URL. Complete it with attachment.completeUpload.",
  annotations: {
    title: "Prepare attachment upload",
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleAttachmentPrepareUpload({ client, ...params }),
  );
}
