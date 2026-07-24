import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMemberList } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema };
export const metadata: ToolMetadata = {
  name: "workspaceMember_list",
  description: "List Workspace Memberships and pending Workspace Invitations.",
  annotations: { title: "List workspace members", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMemberList({ client, workspaceId: params.workspaceId }),
  );
}
