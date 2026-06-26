import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleFileAssetCreateUpload } from "../lib/handlers";

export const schema = {
  filename: z.string().min(1).max(256).describe("Attachment filename"),
  mimeType: z.string().min(1).describe("Attachment MIME type"),
  sizeBytes: z.number().int().positive().describe("Attachment size in bytes"),
};

export const metadata: ToolMetadata = {
  name: "fileAsset.createUpload",
  description: "Create a Bap Upload Session for a File Asset attachment",
  annotations: {
    title: "Create file upload",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function fileAssetCreateUpload(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }

  const result = await handleFileAssetCreateUpload({
    client: clientState.client,
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
  });

  return toMcpToolResult(result);
}
