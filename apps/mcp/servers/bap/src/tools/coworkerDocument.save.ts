import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerDocumentSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const file = z
  .object({
    filename: z.string().min(1).max(256),
    mimeType: z.string().min(1),
    contentBase64: z.string().min(1),
    description: z.string().max(1024).optional(),
  })
  .strict();
const operation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), files: z.array(file).min(1) }).strict(),
  z
    .object({
      type: z.literal("update"),
      documentId: z.string().min(1),
      values: z
        .object({
          filename: z.string().min(1).max(256).optional(),
          description: z.string().max(1024).nullable().optional(),
          replacement: z
            .object({ mimeType: z.string().min(1), contentBase64: z.string().min(1) })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);
export const schema = {
  workspaceId: workspaceIdSchema,
  coworkerReference: z.string().min(1).describe("Coworker ID or @username."),
  operation,
};
export const metadata: ToolMetadata = {
  name: "coworkerDocument_save",
  description: "Create or update persistent Coworker Documents.",
  annotations: { title: "Save coworker document", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerDocumentSave({
      client,
      coworkerReference: params.coworkerReference,
      operation: params.operation,
    }),
  );
}
