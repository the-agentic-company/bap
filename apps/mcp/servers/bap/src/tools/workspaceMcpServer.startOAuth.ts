import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerStartOAuth } from "../lib/handlers";

export const schema = {
  workspaceMcpServerId: z.string().min(1).describe("Workspace MCP server id (authType oauth2)"),
  redirectUrl: z
    .string()
    .url()
    .optional()
    .describe("Where the OAuth flow lands after consent. Defaults to the app origin."),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.startOAuth",
  description: "Return the OAuth URL to authorize an oauth2 workspace MCP server",
  annotations: {
    title: "Start workspace MCP server OAuth",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceMcpServerStartOAuth(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerStartOAuth({
    client: clientState.client,
    workspaceMcpServerId: params.workspaceMcpServerId,
    redirectUrl: params.redirectUrl ?? clientState.serverUrl,
  });
  return toMcpToolResult(result);
}
