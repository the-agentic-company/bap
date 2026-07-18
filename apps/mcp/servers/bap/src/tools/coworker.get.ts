import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerGet } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
};

export const metadata: ToolMetadata = {
  name: "coworker.get",
  description: "Get a coworker by ID or @username",
  annotations: {
    title: "Get coworker",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerGet(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerGet(clientState.client, params.reference);
  return toMcpToolResult(result);
}
