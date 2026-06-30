import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerDownloadFile } from "../lib/handlers";

export const schema = {
  fileId: z
    .string()
    .min(1)
    .describe("Sandbox file id from a run's sandboxFiles[] (see coworker.logs)"),
};

export const metadata: ToolMetadata = {
  name: "coworker.downloadFile",
  description: "Get a signed download URL for a file a coworker run produced in its sandbox",
  annotations: {
    title: "Download coworker run file",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function coworkerDownloadFile(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerDownloadFile({
    client: clientState.client,
    fileId: params.fileId,
  });
  return toMcpToolResult(result);
}
