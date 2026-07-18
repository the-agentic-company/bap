import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleAttachmentCompleteUpload } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, attachmentId: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "attachment.completeUpload",
  description: "Complete a prepared attachment upload and return a ready attachment ID.",
  annotations: {
    title: "Complete attachment upload",
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleAttachmentCompleteUpload({ client, attachmentId: params.attachmentId }),
  );
}
