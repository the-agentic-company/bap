import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerDisconnectCredential } from "../lib/handlers";

export const schema = {
  workspaceMcpServerId: z.string().min(1).describe("Workspace MCP server id to disconnect"),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.disconnectCredential",
  description: "Remove the stored credential / OAuth authorization from a workspace MCP server",
  annotations: {
    title: "Disconnect workspace MCP server credential",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceMcpServerDisconnectCredential(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerDisconnectCredential({
    client: clientState.client,
    workspaceMcpServerId: params.workspaceMcpServerId,
  });
  return toMcpToolResult(result);
}
