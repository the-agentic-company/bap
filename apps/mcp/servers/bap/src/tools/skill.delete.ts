import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleSkillDelete } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, id: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "skill.delete",
  description: "Delete a skill.",
  annotations: {
    title: "Delete skill",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleSkillDelete({ client, id: params.id }),
  );
}
