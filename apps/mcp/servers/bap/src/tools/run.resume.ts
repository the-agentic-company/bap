import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleRunResume } from "../lib/handlers";

export const schema = {
  runId: z.string().min(1).describe("Run id of a paused coworker run to resume"),
};

export const metadata: ToolMetadata = {
  name: "run.resume",
  description: "Resume a coworker run that paused (e.g. after hitting its run deadline)",
  annotations: {
    title: "Resume run",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function runResume(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleRunResume({
    client: clientState.client,
    runId: params.runId,
  });
  return toMcpToolResult(result);
}
