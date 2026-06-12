import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerGet } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  serverUrl: z.string().url().optional().describe("Override the Bap server URL"),
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
  const clientState = createMcpClient(extra, params.serverUrl);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerGet(clientState.client, params.reference);
  return toMcpToolResult(result);
}
