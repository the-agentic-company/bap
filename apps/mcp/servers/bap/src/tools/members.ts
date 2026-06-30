import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleMembers } from "../lib/handlers.remote-management";

export const schema = {
  action: z
    .enum(["list", "setRole", "remove"])
    .describe(
      "list: workspace members. setRole: change a member's role. remove: remove a member. setRole/remove require the authenticated user to be a workspace admin; the owner is protected.",
    ),
  workspaceId: z.string().min(1).describe("Workspace id"),
  email: z.string().email().optional().describe("Member email. Required for setRole and remove."),
  role: z.enum(["admin", "member"]).optional().describe("New role. Required for setRole."),
};

export const metadata: ToolMetadata = {
  name: "members",
  description:
    "Manage workspace members: list, change a member's role, or remove a member. Role changes and removals require workspace-admin rights and cannot target the owner.",
  annotations: { title: "Workspace members", readOnlyHint: false, idempotentHint: false },
};

export default async function members(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleMembers({
    client: clientState.client,
    action: params.action,
    workspaceId: params.workspaceId,
    email: params.email,
    role: params.role,
  });
  return toMcpToolResult(result);
}
