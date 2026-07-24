import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerDelete } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, id: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "workspaceMcpServer_delete",
  description: "Delete a Workspace MCP Server configuration.",
  annotations: {
    title: "Delete workspace MCP server",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMcpServerDelete({ client, id: params.id }),
  );
}
