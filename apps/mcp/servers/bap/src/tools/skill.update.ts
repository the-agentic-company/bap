import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillUpdate } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Skill id to update"),
  name: z.string().min(1).max(64).optional().describe("Internal skill name/slug"),
  displayName: z.string().min(1).max(128).optional().describe("Skill display name"),
  description: z.string().min(1).max(1024).optional().describe("Skill description"),
  icon: z.string().max(64).nullable().optional().describe("Skill icon, or null to clear"),
  enabled: z.boolean().optional().describe("Whether the skill is enabled"),
};

export const metadata: ToolMetadata = {
  name: "skill.update",
  description: "Update a skill's metadata and enabled state (owner only)",
  annotations: {
    title: "Update skill",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function skillUpdate(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillUpdate({
    client: clientState.client,
    id: params.id,
    name: params.name,
    displayName: params.displayName,
    description: params.description,
    icon: params.icon,
    enabled: params.enabled,
  });
  return toMcpToolResult(result);
}
