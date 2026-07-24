import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerDeleteDocument } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  coworkerReference: z.string().min(1),
  documentId: z.string().min(1),
};
export const metadata: ToolMetadata = {
  name: "coworkerDocument_delete",
  description: "Delete a Coworker Document.",
  annotations: {
    title: "Delete coworker document",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerDeleteDocument({
      client,
      reference: params.coworkerReference,
      documentId: params.documentId,
    }),
  );
}
