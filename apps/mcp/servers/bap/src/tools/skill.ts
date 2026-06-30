import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleSkill } from "../lib/handlers.remote-management";

export const schema = {
  action: z
    .enum(["list", "get", "add", "update", "delete", "setEnabled", "setVisibility"])
    .describe(
      "list/get skills; add (import a folder of files); update metadata; delete; setEnabled; setVisibility (public/private).",
    ),
  id: z.string().optional().describe("Skill id. Required for get/update/delete/setEnabled/setVisibility."),
  files: z
    .array(
      z.object({
        path: z.string().min(1).describe("Path inside the skill folder, e.g. SKILL.md"),
        mimeType: z.string().optional().describe("Optional MIME type"),
        contentBase64: z.string().min(1).describe("Base64-encoded file content"),
      }),
    )
    .optional()
    .describe("Skill folder files. Required for add."),
  name: z.string().optional().describe("Skill name (update)."),
  displayName: z.string().optional().describe("Display name (update)."),
  description: z.string().optional().describe("Description (update)."),
  icon: z.string().nullable().optional().describe("Icon (update)."),
  enabled: z.boolean().optional().describe("Enabled flag. Used by update and required by setEnabled."),
  visibility: z.enum(["public", "private"]).optional().describe("Visibility. Required for setVisibility."),
};

export const metadata: ToolMetadata = {
  name: "skill",
  description:
    "Manage skills: list, get, add (import a folder), update metadata, delete, set enabled, or set visibility.",
  annotations: { title: "Skills", readOnlyHint: false, idempotentHint: false },
};

export default async function skill(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleSkill({
    client: clientState.client,
    action: params.action,
    id: params.id,
    files: params.files,
    name: params.name,
    displayName: params.displayName,
    description: params.description,
    icon: params.icon,
    enabled: params.enabled,
    visibility: params.visibility,
  });
  return toMcpToolResult(result);
}
