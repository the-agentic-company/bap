import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { integrationTypeSchema, workspaceIdSchema } from "../lib/contract-schemas";
import { handleConnectedAccountRead } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const query = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), integrationType: integrationTypeSchema.optional() }).strict(),
  z.object({ type: z.literal("get"), connectedAccountId: z.string().min(1) }).strict(),
]);
export const schema = { workspaceId: workspaceIdSchema, query };
export const metadata: ToolMetadata = {
  name: "connectedAccount.read",
  description: "List or get Connected Accounts in a Workspace.",
  annotations: { title: "Read connected accounts", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleConnectedAccountRead({ client, query: params.query }),
  );
}
