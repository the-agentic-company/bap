import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleConnectedAccountConnect } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  integrationType: z.string().min(1),
  redirectUrl: z.string().url(),
  mode: z.enum(["connect", "connect_to_label", "reauth"]).optional(),
  accountLabel: z.string().optional(),
  connectedAccountId: z.string().optional(),
};
export const metadata: ToolMetadata = {
  name: "connectedAccount.connect",
  description: "Start a Connected Account authorization flow.",
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
