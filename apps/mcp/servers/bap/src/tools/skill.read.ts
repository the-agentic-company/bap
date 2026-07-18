import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleSkillRead } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const query = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("get"), id: z.string().min(1) }).strict(),
]);
export const schema = { workspaceId: workspaceIdSchema, query };
export const metadata: ToolMetadata = {
  name: "skill.read",
  description: "List or get skills.",
  annotations: { title: "Read skills", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleSkillRead({ client, query: params.query }),
  );
}
