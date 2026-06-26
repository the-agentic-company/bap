import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerDelete } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
};

export const metadata: ToolMetadata = {
  name: "coworker.delete",
  description: "Delete an existing coworker",
  annotations: {
    title: "Delete coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerDelete(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerDelete({
    client: clientState.client,
    reference: params.reference,
  });
  return toMcpToolResult(result);
}
