import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerRun } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  payload: z.record(z.string(), z.unknown()).optional().describe("Optional run payload"),
  userInput: z.string().optional().describe("Trusted first user input for coworkers that need it"),
  fileAttachments: z
    .array(
      z.object({
        fileAssetId: z.string().min(1).describe("Ready File Asset ID to attach to the run"),
        name: z.string().optional().describe("Optional display name for the attachment"),
        mimeType: z.string().optional().describe("Optional MIME type override"),
        sizeBytes: z.number().int().nonnegative().optional().describe("Optional file size hint"),
      }),
    )
    .optional()
    .describe("Optional ready File Assets to attach to the run"),
};

export const metadata: ToolMetadata = {
  name: "coworker.run",
  description: "Trigger a coworker run",
  annotations: {
    title: "Run coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerRun(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerRun({
    client: clientState.client,
    reference: params.reference,
    payload: params.payload,
    userInput: params.userInput,
    fileAttachments: params.fileAttachments,
  });
  return toMcpToolResult(result);
}
