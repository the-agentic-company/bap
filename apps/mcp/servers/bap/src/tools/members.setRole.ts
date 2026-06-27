import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleMembersSetRole } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().min(1).describe("Workspace id"),
  email: z.string().email().describe("Email of the member whose role to change"),
  role: z.enum(["admin", "member"]).describe("New role for the member"),
};

export const metadata: ToolMetadata = {
  name: "members.setRole",
  description:
    "Change a workspace member's role (admin/member). The authenticated user must be an admin of the workspace; the owner's role cannot be changed.",
  annotations: {
    title: "Set workspace member role",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function membersSetRole(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleMembersSetRole({
    client: clientState.client,
    workspaceId: params.workspaceId,
    email: params.email,
    role: params.role,
  });
  return toMcpToolResult(result);
}
