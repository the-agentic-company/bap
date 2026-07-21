import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleSkillSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const values = z
  .object({
    files: z
      .array(
        z.object({
          path: z.string().min(1),
          mimeType: z.string().optional(),
          contentBase64: z.string().min(1),
        }),
      )
      .min(1)
      .optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    visibility: z.enum(["public", "private"]).optional(),
  })
  .strict();
export const schema = { workspaceId: workspaceIdSchema, id: z.string().optional(), values };
export const metadata: ToolMetadata = {
  name: "skill.save",
  description: "Create a skill from files or partially update skill metadata and visibility.",
  annotations: { title: "Save skill", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleSkillSave({ client, id: params.id, values: params.values }),
  );
}
