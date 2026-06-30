import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerCreate } from "../lib/handlers";

export const schema = {
  name: z.string().optional().describe("Coworker name"),
  trigger: z.string().min(1).optional().describe("Trigger type. Defaults to manual."),
  prompt: z.string().optional().describe("Coworker instructions. Defaults to empty."),
  folder: z.string().min(1).optional().describe("Folder path to create or reuse"),
  autoApprove: z.boolean().optional().describe("Enable auto-approve"),
  model: z.string().optional().describe("Model reference"),
  authSource: z.enum(["user", "shared"]).optional().describe("Model auth source"),
  integrations: z.array(z.string()).optional().describe("Allowed integrations"),
  workspaceMcpServerIds: z
    .array(z.string())
    .optional()
    .describe("Allowed workspace MCP server IDs"),
  skillSlugs: z.array(z.string()).optional().describe("Allowed skill slugs"),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(256).describe("Document filename"),
        mimeType: z.string().min(1).describe("Document MIME type"),
        contentBase64: z.string().min(1).describe("Base64-encoded document content"),
        description: z.string().max(1024).optional().describe("Optional document description"),
      }),
    )
    .optional()
    .describe("Documents to attach to the coworker after creation"),
};

export const metadata: ToolMetadata = {
  name: "coworker.create",
  description: "Create a coworker",
  annotations: {
    title: "Create coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerCreate(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerCreate({
    client: clientState.client,
    name: params.name,
    trigger: params.trigger,
    prompt: params.prompt,
    folderPath: params.folder,
    autoApprove: params.autoApprove,
    model: params.model,
    authSource: params.authSource,
    integrations: params.integrations,
    workspaceMcpServerIds: params.workspaceMcpServerIds,
    skillSlugs: params.skillSlugs,
    files: params.files,
  });
  return toMcpToolResult(result);
}
