import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerLogs } from "../lib/handlers";

export const schema = {
  runId: z.string().describe("Coworker run ID"),
};

export const metadata: ToolMetadata = {
  name: "coworker.logs",
  description: "Get coworker run details and events",
  annotations: {
    title: "Coworker logs",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerLogs(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerLogs(clientState.client, params.runId);
  return toMcpToolResult(result);
}
