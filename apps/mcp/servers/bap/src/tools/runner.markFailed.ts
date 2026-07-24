import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { handleRunnerMarkFailed } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

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
  name: "runner_markFailed",
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
  return executeBapTool(extra, undefined, metadata.name, (client) =>
    handleRunnerMarkFailed({ client, reason: params.reason, message: params.message }),
  );
}
