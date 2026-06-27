import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerList } from "../lib/handlers";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.list",
  description: "List the MCP servers registered in the active workspace",
  annotations: {
    title: "List workspace MCP servers",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function workspaceMcpServerList(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerList(clientState.client);
  return toMcpToolResult(result);
}
