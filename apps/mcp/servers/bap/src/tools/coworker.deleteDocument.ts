import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerDeleteDocument } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  documentId: z.string().describe("Coworker Document ID"),
};

export const metadata: ToolMetadata = {
  name: "coworker.deleteDocument",
  description: "Delete a coworker document",
  annotations: {
    title: "Delete coworker document",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerDeleteDocument(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerDeleteDocument({
    client: clientState.client,
    reference: params.reference,
    documentId: params.documentId,
  });
  return toMcpToolResult(result);
}
