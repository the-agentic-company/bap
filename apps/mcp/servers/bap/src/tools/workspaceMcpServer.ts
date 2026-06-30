import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceMcpServerAction } from "../lib/handlers.remote-management";

export const schema = {
  action: z
    .enum(["list", "create", "update", "delete", "setCredential", "connect", "disconnect"])
    .describe(
      "list servers; create/update (name+namespace+endpoint required); delete; setCredential (api_key/bearer secret); connect (oauth2, returns an OAuth URL for the user to open); disconnect (clear credential).",
    ),
  id: z.string().optional().describe("Server id. Required for update/delete/setCredential/connect/disconnect."),
  name: z.string().max(120).optional().describe("Display name (create/update)."),
  namespace: z.string().max(120).optional().describe("Namespace prefix for this server's tools (create/update)."),
  endpoint: z.string().url().optional().describe("Streamable HTTP MCP endpoint URL (create/update)."),
  specUrl: z.string().url().nullish().describe("Optional spec/discovery URL."),
  transport: z.string().max(120).nullish().describe("Optional transport override."),
  headers: z.record(z.string(), z.string()).optional().describe("Static request headers."),
  queryParams: z.record(z.string(), z.string()).optional().describe("Static query parameters."),
  defaultHeaders: z.record(z.string(), z.string()).optional().describe("Default headers merged into every request."),
  authType: z
    .enum(["none", "api_key", "bearer", "oauth2"])
    .optional()
    .describe("Auth scheme. Use setCredential (api_key/bearer) or connect (oauth2) to supply secrets."),
  authHeaderName: z.string().max(120).nullish().describe("Header name for api_key auth."),
  authQueryParam: z.string().max(120).nullish().describe("Query param name for api_key auth."),
  authPrefix: z.string().max(120).nullish().describe("Prefix prepended to the secret, e.g. Bearer."),
  enabled: z.boolean().optional().describe("Whether the server (or credential) is enabled."),
  secret: z.string().optional().describe("API key / bearer token. Required for setCredential."),
  displayName: z.string().max(120).nullish().describe("Optional label for the stored credential."),
  redirectUrl: z
    .string()
    .url()
    .optional()
    .describe("Where the OAuth flow lands after consent (connect). Defaults to the app origin."),
};

export const metadata: ToolMetadata = {
  name: "workspaceMcpServer",
  description:
    "Manage workspace MCP servers: list, create, update, delete, set an api_key/bearer credential, get an OAuth connect URL (oauth2, opened by the user), or disconnect the credential.",
  annotations: { title: "Workspace MCP servers", readOnlyHint: false, idempotentHint: false },
};

export default async function workspaceMcpServer(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceMcpServerAction({
    client: clientState.client,
    action: params.action,
    id: params.id,
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
    secret: params.secret,
    displayName: params.displayName,
    redirectUrl: params.redirectUrl ?? clientState.serverUrl,
  });
  return toMcpToolResult(result);
}
