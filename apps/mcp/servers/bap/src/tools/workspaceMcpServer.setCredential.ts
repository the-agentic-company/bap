import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerSetCredential } from "../lib/handlers";

export const schema = {
  workspaceMcpServerId: z.string().min(1).describe("Workspace MCP server id"),
  secret: z.string().min(1).describe("API key or bearer token for manual (non-OAuth) auth"),
  displayName: z.string().max(120).nullish().describe("Optional label for the stored credential"),
  enabled: z.boolean().optional().describe("Whether the credential is active. Defaults to true."),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.setCredential",
  description: "Store an API key / bearer credential for a workspace MCP server (manual auth)",
  annotations: {
    title: "Set workspace MCP server credential",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function workspaceMcpServerSetCredential(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerSetCredential({
    client: clientState.client,
    workspaceMcpServerId: params.workspaceMcpServerId,
    secret: params.secret,
    displayName: params.displayName,
    enabled: params.enabled,
  });
  return toMcpToolResult(result);
}
