import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerMoveWorkspace } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Source Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
  targetWorkspaceId: z.string().trim().min(1).describe("Destination workspace ID"),
};

export const metadata: ToolMetadata = {
  name: "coworker.moveWorkspace",
  description: "Move a coworker to another workspace where the authenticated user is a member",
  annotations: {
    title: "Move coworker to workspace",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerMoveWorkspace(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerMoveWorkspace({
    client: clientState.client,
    reference: params.reference,
    targetWorkspaceId: params.targetWorkspaceId,
  });
  return toMcpToolResult(result);
}
