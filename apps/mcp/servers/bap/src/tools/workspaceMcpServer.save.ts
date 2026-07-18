import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const values = z
  .object({
    name: z.string().max(120).optional(),
    namespace: z.string().max(120).optional(),
    endpoint: z.string().url().optional(),
    enabled: z.boolean().optional(),
    specUrl: z.string().url().nullable().optional(),
    transport: z.string().nullable().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    queryParams: z.record(z.string(), z.string()).optional(),
    defaultHeaders: z.record(z.string(), z.string()).optional(),
    authType: z.enum(["none", "api_key", "bearer", "oauth2"]).optional(),
    authHeaderName: z.string().nullable().optional(),
    authQueryParam: z.string().nullable().optional(),
    authPrefix: z.string().nullable().optional(),
  })
  .strict();
export const schema = { workspaceId: workspaceIdSchema, id: z.string().optional(), values };
export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.save",
  description: "Create or partially update a Workspace MCP Server, including enabled state.",
  annotations: { title: "Save workspace MCP server", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMcpServerSave({ client, id: params.id, values: params.values }),
  );
}
