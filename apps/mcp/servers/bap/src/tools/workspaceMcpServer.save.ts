import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMcpServerSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const values = z
  .object({
    name: z.string().max(120).optional().describe("Required when creating (no id)."),
    namespace: z
      .string()
      .max(120)
      .optional()
      .describe(
        "Required when creating. Lowercased and slugified, must be unique per workspace, and becomes the MCP tool prefix.",
      ),
    endpoint: z.string().url().optional().describe("Required when creating. Server base URL."),
    enabled: z.boolean().optional(),
    specUrl: z.string().url().nullable().optional(),
    transport: z
      .string()
      .nullable()
      .optional()
      .describe('Transport: "http" (default) or "sse". Other values are treated as "http".'),
    headers: z.record(z.string(), z.string()).optional(),
    queryParams: z.record(z.string(), z.string()).optional(),
    defaultHeaders: z.record(z.string(), z.string()).optional(),
    authType: z
      .enum(["none", "api_key", "bearer", "oauth2"])
      .optional()
      .describe(
        'Auth mode. "api_key" and "bearer" require a follow-up workspaceMcpServer.setCredential to set the secret; "oauth2" uses workspaceMcpServer.startOAuth.',
      ),
    authHeaderName: z.string().nullable().optional(),
    authQueryParam: z.string().nullable().optional(),
    authPrefix: z
      .string()
      .nullable()
      .optional()
      .describe('Prefix prepended to a bearer secret. Defaults to "Bearer " (with trailing space).'),
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
