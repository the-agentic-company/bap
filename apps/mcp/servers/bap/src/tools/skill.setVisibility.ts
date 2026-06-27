import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillSetVisibility } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Skill id (owner only)"),
  visibility: z
    .enum(["public", "private"])
    .describe("public shares the skill to the workspace; private unshares it"),
};

export const metadata: ToolMetadata = {
  name: "skill.setVisibility",
  description: "Share (public) or unshare (private) a skill (owner only)",
  annotations: {
    title: "Set skill visibility",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function skillSetVisibility(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillSetVisibility({
    client: clientState.client,
    id: params.id,
    visibility: params.visibility,
  });
  return toMcpToolResult(result);
}
