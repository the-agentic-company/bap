import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerList } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema };
export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.list",
  description: "List Workspace MCP Servers.",
  annotations: { title: "List workspace MCP servers", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, handleWorkspaceMcpServerList);
}
