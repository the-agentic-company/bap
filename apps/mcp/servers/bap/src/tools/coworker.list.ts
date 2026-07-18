import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerList } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID whose coworkers should be listed"),
};

export const metadata: ToolMetadata = {
  name: "coworker.list",
  description: "List available coworkers",
  annotations: {
    title: "List coworkers",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerList(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerList(clientState.client);
  return toMcpToolResult(result);
}
