import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMemberRemove } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, email: z.string().email() };
export const metadata: ToolMetadata = {
  name: "workspaceMember_remove",
  description: "Remove a Workspace Membership.",
  annotations: {
    title: "Remove workspace member",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMemberRemove({ client, ...params }),
  );
}
