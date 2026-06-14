import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerUpdateDocument } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  documentId: z.string().describe("Coworker Document ID"),
  filename: z.string().min(1).max(256).optional().describe("Document filename"),
  mimeType: z.string().min(1).optional().describe("Document MIME type for file replacement"),
  contentBase64: z.string().min(1).optional().describe("Base64 file content for replacement"),
  description: z
    .string()
    .max(1024)
    .nullable()
    .optional()
    .describe("Optional document description. Use null to clear it."),
};

export const metadata: ToolMetadata = {
  name: "coworker.updateDocument",
  description: "Update or replace a coworker document",
  annotations: {
    title: "Update coworker document",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerUpdateDocument(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerUpdateDocument({
    client: clientState.client,
    reference: params.reference,
    documentId: params.documentId,
    filename: params.filename,
    mimeType: params.mimeType,
    contentBase64: params.contentBase64,
    description: params.description,
  });
  return toMcpToolResult(result);
}
