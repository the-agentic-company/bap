import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { handleCoworkerMoveWorkspace } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Source Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
  targetWorkspaceId: z.string().trim().min(1).describe("Destination workspace ID"),
};

export const metadata: ToolMetadata = {
  name: "coworker_moveWorkspace",
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
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerMoveWorkspace({
      client,
      reference: params.reference,
      targetWorkspaceId: params.targetWorkspaceId,
    }),
  );
}
