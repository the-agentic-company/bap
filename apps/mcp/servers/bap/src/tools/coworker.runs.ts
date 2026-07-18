import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerRuns } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID whose runs should be listed"),
  status: z
    .enum([
      "needs_user_input",
      "running",
      "awaiting_approval",
      "awaiting_auth",
      "paused",
      "completed",
      "error",
      "cancelled",
    ])
    .optional()
    .describe("Filter by run status, for example error"),
  coworkerId: z.string().optional().describe("Filter to one coworker ID"),
  limit: z.number().min(1).max(100).optional().describe("Maximum runs to return. Defaults to 50."),
  cursor: z.string().optional().describe("Pagination cursor returned by the previous call"),
};

export const metadata: ToolMetadata = {
  name: "coworker.runs",
  description: "List workspace coworker runs, optionally filtered by status or coworker",
  annotations: {
    title: "List coworker runs",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerRuns(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerRuns({
    client: clientState.client,
    status: params.status,
    coworkerId: params.coworkerId,
    limit: params.limit,
    cursor: params.cursor,
  });
  return toMcpToolResult(result);
}
