import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleMembersList } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().min(1).describe("Workspace id to list members for"),
};

export const metadata: ToolMetadata = {
  name: "members.list",
  description: "List the members of a workspace and their roles",
  annotations: {
    title: "List workspace members",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function membersList(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleMembersList({
    client: clientState.client,
    workspaceId: params.workspaceId,
  });
  return toMcpToolResult(result);
}
