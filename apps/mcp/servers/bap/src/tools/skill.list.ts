import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillList } from "../lib/handlers";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "skill.list",
  description: "List the skills accessible in the active workspace",
  annotations: {
    title: "List skills",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function skillList(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillList(clientState.client);
  return toMcpToolResult(result);
}
