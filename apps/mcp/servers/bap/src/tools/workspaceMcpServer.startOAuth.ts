import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerStartOAuth } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  id: z.string().min(1),
  redirectUrl: z.string().url(),
};
export const metadata: ToolMetadata = {
  name: "workspaceMcpServer_startOAuth",
  description:
    "Start OAuth reauthorization. A successful callback replaces the previous credential.",
  annotations: {
    title: "Authorize workspace MCP server",
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMcpServerStartOAuth({ client, ...params }),
  );
}
