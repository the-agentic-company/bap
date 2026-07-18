import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceAddMembers } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID where members should be added"),
  emails: z.array(z.string().email()).min(1).max(20).describe("Existing user email addresses"),
  role: z.enum(["admin", "member"]).optional().describe("Membership role to grant"),
};

export const metadata: ToolMetadata = {
  name: "workspace.addMembers",
  description: "Add existing users to a workspace where the authenticated user is an admin",
  annotations: {
    title: "Add workspace members",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceAddMembers(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceAddMembers({
    client: clientState.client,
    workspaceId: params.workspaceId,
    emails: params.emails,
    role: params.role,
  });
  return toMcpToolResult(result);
}
