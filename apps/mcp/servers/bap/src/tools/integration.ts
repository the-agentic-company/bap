import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleIntegration } from "../lib/handlers.remote-management";

export const schema = {
  action: z
    .enum(["list", "status", "connect", "disconnect"])
    .describe(
      "list: connected integrations with auth status. status: status of one/filtered. connect: return an OAuth URL for the user to open. disconnect: remove an integration by id.",
    ),
  type: z
    .string()
    .optional()
    .describe("Integration type, e.g. gmail, slack, linkedin. Required for connect; filters status."),
  id: z
    .string()
    .optional()
    .describe("Integration id. Required for disconnect; optional filter for status."),
  redirectUrl: z
    .string()
    .url()
    .optional()
    .describe("Where the OAuth flow lands after consent (connect). Defaults to the app origin."),
  mode: z
    .enum(["connect", "connect_to_label", "reauth"])
    .optional()
    .describe("connect: new account; connect_to_label: attach to a label; reauth: re-authenticate."),
  accountLabel: z.string().optional().describe("Account label when mode is connect_to_label."),
  connectedAccountId: z.string().optional().describe("Connected account id when mode is reauth."),
};

export const metadata: ToolMetadata = {
  name: "integration",
  description:
    "Manage account integrations: list/status, get an OAuth connect URL for the user to open, or disconnect. Connecting itself is user-gated (the returned URL is opened by the user).",
  annotations: { title: "Integrations", readOnlyHint: false, idempotentHint: false },
};

export default async function integration(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleIntegration({
    client: clientState.client,
    action: params.action,
    type: params.type,
    id: params.id,
    redirectUrl: params.redirectUrl ?? clientState.serverUrl,
    mode: params.mode,
    accountLabel: params.accountLabel,
    connectedAccountId: params.connectedAccountId,
  });
  return toMcpToolResult(result);
}
