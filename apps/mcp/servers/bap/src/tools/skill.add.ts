import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkillAdd } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID where the skill will be added"),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(256)
          .describe("Relative path inside the skill folder. Must include SKILL.md."),
        mimeType: z.string().min(1).max(256).optional().describe("Optional MIME type"),
        contentBase64: z.string().min(1).describe("Base64-encoded file content"),
      }),
    )
    .min(1)
    .max(100)
    .describe(
      "Skill folder files to import. Include SKILL.md with name and description frontmatter.",
    ),
};

export const metadata: ToolMetadata = {
  name: "skill.add",
  description: "Add a user-owned Bap skill from a folder-style file list",
  annotations: {
    title: "Add skill",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function skillAdd(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }

  const result = await handleSkillAdd({
    client: clientState.client,
    files: params.files,
  });
  return toMcpToolResult(result);
}
