import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerUploadDocument } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(256).describe("Document filename"),
        mimeType: z.string().min(1).describe("Document MIME type"),
        contentBase64: z.string().min(1).describe("Base64-encoded document content"),
        description: z.string().max(1024).optional().describe("Optional document description"),
      }),
    )
    .min(1)
    .describe("Documents to attach to the coworker"),
  serverUrl: z.string().url().optional().describe("Override the CmdClaw server URL"),
};

export const metadata: ToolMetadata = {
  name: "coworker.uploadDocument",
  description: "Upload documents to an existing coworker",
  annotations: {
    title: "Upload coworker documents",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerUploadDocument(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.serverUrl);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerUploadDocument({
    client: clientState.client,
    reference: params.reference,
    files: params.files,
  });
  return toMcpToolResult(result);
}
