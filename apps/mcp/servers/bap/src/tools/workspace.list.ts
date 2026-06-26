import { type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceList } from "../lib/handlers";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "workspace.list",
  description: "List the workspaces available to the authenticated user",
  annotations: {
    title: "List workspaces",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function workspaceList(_params: typeof schema, extra?: ToolExtraArguments) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceList(clientState.client);
  return toMcpToolResult(result);
}
