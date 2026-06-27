import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillGet } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Skill id to fetch (with its files and documents)"),
};

export const metadata: ToolMetadata = {
  name: "skill.get",
  description: "Get a skill's detail, including its files and documents",
  annotations: {
    title: "Get skill",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function skillGet(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillGet({
    client: clientState.client,
    id: params.id,
  });
  return toMcpToolResult(result);
}
