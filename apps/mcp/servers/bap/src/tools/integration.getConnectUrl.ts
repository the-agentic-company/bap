import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleIntegrationGetConnectUrl } from "../lib/handlers";

export const schema = {
  type: z.string().min(1).describe("Integration type, e.g. gmail, google_drive, slack, linkedin"),
  redirectUrl: z
    .string()
    .url()
    .optional()
    .describe("Where the OAuth flow lands after consent. Defaults to the app origin."),
  mode: z
    .enum(["connect", "connect_to_label", "reauth"])
    .optional()
    .describe("Connect a new account, attach to an account label, or re-authenticate"),
  accountLabel: z.string().optional().describe("Account label when mode is connect_to_label"),
  connectedAccountId: z.string().optional().describe("Existing connected account id when reauth"),
};

export const metadata: ToolMetadata = {
  name: "integration.getConnectUrl",
  description:
    "Return the OAuth URL the user opens to connect (or re-authenticate) an integration",
  annotations: {
    title: "Get integration connect URL",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function integrationGetConnectUrl(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleIntegrationGetConnectUrl({
    client: clientState.client,
    type: params.type,
    redirectUrl: params.redirectUrl ?? clientState.serverUrl,
    mode: params.mode,
    accountLabel: params.accountLabel,
    connectedAccountId: params.connectedAccountId,
  });
  return toMcpToolResult(result);
}
