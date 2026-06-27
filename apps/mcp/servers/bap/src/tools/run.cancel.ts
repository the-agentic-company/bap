import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleRunCancel } from "../lib/handlers";

export const schema = {
  runId: z.string().min(1).describe("Run id to cancel"),
};

export const metadata: ToolMetadata = {
  name: "run.cancel",
  description: "Cancel an in-flight coworker run",
  annotations: {
    title: "Cancel run",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function runCancel(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleRunCancel({
    client: clientState.client,
    runId: params.runId,
  });
  return toMcpToolResult(result);
}
