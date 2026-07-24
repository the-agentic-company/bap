import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { integrationTypeSchema, workspaceIdSchema } from "../lib/contract-schemas";
import { handleConnectedAccountConnect } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  integrationType: integrationTypeSchema,
  redirectUrl: z
    .string()
    .url()
    .describe("Absolute URL to return the user to after the authorization flow completes."),
  mode: z.enum(["connect", "connect_to_label", "reauth"]).optional(),
  accountLabel: z.string().optional(),
  connectedAccountId: z.string().optional(),
};
export const metadata: ToolMetadata = {
  name: "connectedAccount.connect",
  description:
    'Start a Connected Account authorization flow for an integration provider such as "google_gmail". Returns an authUrl that the user must open in a browser to grant consent; no credentials are entered through this tool.',
  annotations: {
    title: "Connect account",
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleConnectedAccountConnect({ client, ...params }),
  );
}
