import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerSetCredential } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  id: z.string().min(1),
  secret: z.string().min(1),
  displayName: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
};
export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.setCredential",
  description: "Set or replace a manual Workspace MCP Authorization secret.",
  annotations: {
    title: "Set workspace MCP credential",
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMcpServerSetCredential({ client, ...params }),
  );
}
