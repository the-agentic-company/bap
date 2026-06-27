import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerCreate } from "../lib/handlers";

export const schema = {
  name: z.string().min(1).max(120).describe("Display name for the MCP server"),
  namespace: z
    .string()
    .min(1)
    .max(120)
    .describe("Namespace prefix the coworker uses to reference this server's tools"),
  endpoint: z.string().url().describe("Streamable HTTP MCP endpoint URL"),
  specUrl: z.string().url().nullish().describe("Optional spec/discovery URL"),
  transport: z.string().max(120).nullish().describe("Optional transport override"),
  headers: z.record(z.string(), z.string()).optional().describe("Static request headers"),
  queryParams: z.record(z.string(), z.string()).optional().describe("Static query parameters"),
  defaultHeaders: z
    .record(z.string(), z.string())
    .optional()
    .describe("Default headers merged into every request"),
  authType: z
    .enum(["none", "api_key", "bearer", "oauth2"])
    .optional()
    .describe("Auth scheme. Defaults to none. Use setCredential/startOAuth to supply secrets."),
  authHeaderName: z.string().max(120).nullish().describe("Header name for api_key auth"),
  authQueryParam: z.string().max(120).nullish().describe("Query param name for api_key auth"),
  authPrefix: z.string().max(120).nullish().describe("Prefix prepended to the secret, e.g. Bearer"),
  enabled: z.boolean().optional().describe("Whether the server is enabled. Defaults to true."),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer.create",
  description: "Register a new workspace MCP server that coworkers can be granted access to",
  annotations: {
    title: "Create workspace MCP server",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceMcpServerCreate(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerCreate({
    client: clientState.client,
    input: {
      kind: "mcp",
      name: params.name,
      namespace: params.namespace,
      endpoint: params.endpoint,
      specUrl: params.specUrl,
      transport: params.transport,
      headers: params.headers,
      queryParams: params.queryParams,
      defaultHeaders: params.defaultHeaders,
      authType: params.authType,
      authHeaderName: params.authHeaderName,
      authQueryParam: params.authQueryParam,
      authPrefix: params.authPrefix,
      enabled: params.enabled,
    },
  });
  return toMcpToolResult(result);
}
