import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleWorkspaceMemberSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
};
export const metadata: ToolMetadata = {
  name: "workspaceMember.save",
  description: "Invite an email to a Workspace or update an existing Workspace Membership role.",
  annotations: {
    title: "Save workspace member access",
    readOnlyHint: false,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceMemberSave({ client, ...params }),
  );
}
