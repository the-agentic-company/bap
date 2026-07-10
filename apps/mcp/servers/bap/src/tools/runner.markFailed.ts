import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleRunnerMarkFailed } from "../lib/handlers";

export const schema = {
  reason: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_.:-]+$/i)
    .describe("Compact machine-readable failure reason"),
  message: z.string().trim().min(1).max(2_000).optional().describe("Human-readable failure note"),
};

export const metadata: ToolMetadata = {
  name: "runner.markFailed",
  description:
    "Mark the current coworker runner's own run as failed. Only runner-scoped Bap MCP tokens can use this tool.",
  annotations: {
    title: "Mark runner failed",
    destructiveHint: true,
    idempotentHint: true,
    readOnlyHint: false,
  },
};

export default async function runnerMarkFailed(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }

  const result = await handleRunnerMarkFailed({
    client: clientState.client,
    reason: params.reason,
    message: params.message,
  });
  return toMcpToolResult(result);
}
