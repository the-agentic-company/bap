import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerDelete } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Workspace MCP server id to delete"),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.delete",
  description: "Delete a workspace MCP server (managed servers cannot be deleted)",
  annotations: {
    title: "Delete workspace MCP server",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceMcpServerDelete(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerDelete({
    client: clientState.client,
    id: params.id,
  });
  return toMcpToolResult(result);
}
