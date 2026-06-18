import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerMove } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  folderId: z.string().optional().describe("Existing destination Coworker Folder ID"),
  folderPath: z.string().optional().describe("Folder path to create or reuse as the destination"),
  folder: z.null().optional().describe("Use null to move the coworker to the top level"),
};

export const metadata: ToolMetadata = {
  name: "coworker.move",
  description: "Move a coworker to a folder or to the top level",
  annotations: {
    title: "Move coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerMove(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerMove({
    client: clientState.client,
    reference: params.reference,
    folderId: params.folderId,
    folderPath: params.folderPath,
    folder: params.folder,
  });
  return toMcpToolResult(result);
}
