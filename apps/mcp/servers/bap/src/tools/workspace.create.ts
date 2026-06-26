import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceCreate } from "../lib/handlers";

export const schema = {
  name: z.string().trim().min(2).max(80).describe("Name of the workspace to create"),
};

export const metadata: ToolMetadata = {
  name: "workspace.create",
  description: "Create a new workspace for the authenticated user",
  annotations: {
    title: "Create workspace",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceCreate(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceCreate({
    client: clientState.client,
    name: params.name,
  });
  return toMcpToolResult(result);
}
