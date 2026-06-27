import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillSetEnabled } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Skill id"),
  enabled: z.boolean().describe("Enable (true) or disable (false) the skill"),
};

export const metadata: ToolMetadata = {
  name: "skill.setEnabled",
  description: "Enable or disable a skill",
  annotations: {
    title: "Set skill enabled",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function skillSetEnabled(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkillSetEnabled({
    client: clientState.client,
    id: params.id,
    enabled: params.enabled,
  });
  return toMcpToolResult(result);
}
