import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleIntegrationStatus } from "../lib/handlers";

export const schema = {
  type: z.string().min(1).optional().describe("Filter by integration type"),
  id: z.string().min(1).optional().describe("Filter by integration id"),
};

export const metadata: ToolMetadata = {
  name: "integration.status",
  description: "Report the auth status of one or more connected integrations",
  annotations: {
    title: "Integration status",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function integrationStatus(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleIntegrationStatus({
    client: clientState.client,
    type: params.type,
    id: params.id,
  });
  return toMcpToolResult(result);
}
