import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleConnectedAccountDisconnect } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, connectedAccountId: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "connectedAccount.disconnect",
  description: "Disconnect a Connected Account.",
  annotations: {
    title: "Disconnect account",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleConnectedAccountDisconnect({ client, connectedAccountId: params.connectedAccountId }),
  );
}
