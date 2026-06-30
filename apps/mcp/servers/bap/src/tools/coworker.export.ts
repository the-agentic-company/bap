import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerExport } from "../lib/handlers";

export const schema = {
  reference: z.string().min(1).describe("Coworker ID or @username to export"),
};

export const metadata: ToolMetadata = {
  name: "coworker.export",
  description: "Export a coworker's configuration as a portable JSON object",
  annotations: {
    title: "Export coworker",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerExport(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerExport({
    client: clientState.client,
    reference: params.reference,
  });
  return toMcpToolResult(result);
}
