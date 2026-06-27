import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleMembersRemove } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().min(1).describe("Workspace id"),
  email: z.string().email().describe("Email of the member to remove"),
};

export const metadata: ToolMetadata = {
  name: "members.remove",
  description: "Remove a member from a workspace by email. Requires platform admin privileges.",
  annotations: {
    title: "Remove workspace member",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function membersRemove(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleMembersRemove({
    client: clientState.client,
    workspaceId: params.workspaceId,
    email: params.email,
  });
  return toMcpToolResult(result);
}
