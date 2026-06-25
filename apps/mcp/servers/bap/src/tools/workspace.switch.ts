import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleWorkspaceSwitch } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().min(1).describe("Workspace ID to make active"),
};

export const metadata: ToolMetadata = {
  name: "workspace.switch",
  description: "Switch the authenticated user to another workspace they belong to",
  annotations: {
    title: "Switch workspace",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function workspaceSwitch(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleWorkspaceSwitch({
    client: clientState.client,
    workspaceId: params.workspaceId,
  });
  return toMcpToolResult(result);
}
