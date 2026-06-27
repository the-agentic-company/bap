import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleIntegrationList } from "../lib/handlers";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "integration.list",
  description: "List the integrations connected to the active account, with their auth status",
  annotations: {
    title: "List integrations",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function integrationList(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleIntegrationList(clientState.client);
  return toMcpToolResult(result);
}
