import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillDelete } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Skill id to delete (owner only)"),
};

export const metadata: ToolMetadata = {
  name: "skill.delete",
  description: "Delete a skill (owner only)",
  annotations: {
    title: "Delete skill",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function skillDelete(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillDelete({
    client: clientState.client,
    id: params.id,
  });
  return toMcpToolResult(result);
}
