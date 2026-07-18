import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleFileAssetCompleteUpload } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID owning the Upload Session"),
  uploadSessionId: z
    .string()
    .min(1)
    .describe("Upload Session ID returned by fileAsset.createUpload"),
};

export const metadata: ToolMetadata = {
  name: "fileAsset.completeUpload",
  description:
    "Complete a Bap Upload Session after the file bytes were uploaded and return a ready File Asset that can be passed to chat.run or coworker.run in fileAttachments.",
  annotations: {
    title: "Complete file upload",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function fileAssetCompleteUpload(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }

  const result = await handleFileAssetCompleteUpload({
    client: clientState.client,
    uploadSessionId: params.uploadSessionId,
  });

  return toMcpToolResult(result);
}
