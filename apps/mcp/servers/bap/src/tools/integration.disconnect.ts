import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleIntegrationDisconnect } from "../lib/handlers";

export const schema = {
  id: z.string().min(1).describe("Integration id to disconnect (from integration.list)"),
};

export const metadata: ToolMetadata = {
  name: "integration.disconnect",
  description: "Disconnect an integration from the active account",
  annotations: {
    title: "Disconnect integration",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function integrationDisconnect(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleIntegrationDisconnect({
    client: clientState.client,
    id: params.id,
  });
  return toMcpToolResult(result);
}
