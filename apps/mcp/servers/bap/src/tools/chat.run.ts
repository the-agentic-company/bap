import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleChatRun } from "../lib/handlers";

export const schema = {
  message: z.string().describe("The prompt to send to Bap chat"),
  conversationId: z.string().optional().describe("Existing conversation ID to continue"),
  model: z.string().optional().describe("Model reference to use"),
  authSource: z.enum(["user", "shared"]).optional().describe("Model auth source"),
  sandbox: z.enum(["e2b", "daytona", "docker"]).optional().describe("Sandbox provider"),
  autoApprove: z.boolean().optional().describe("Auto-approve tool calls"),
  fileAttachments: z
    .array(
      z.object({
        fileAssetId: z.string().min(1).describe("Ready File Asset ID to attach to the chat turn"),
        name: z.string().optional().describe("Optional display name for the attachment"),
        mimeType: z.string().optional().describe("Optional MIME type override"),
        sizeBytes: z.number().int().nonnegative().optional().describe("Optional file size hint"),
      }),
    )
    .optional()
    .describe("Optional ready File Assets to attach to the chat turn"),
};

export const metadata: ToolMetadata = {
  name: "chat.run",
  description: "Run a Bap chat turn and return a structured result",
  annotations: {
    title: "Run chat",
    idempotentHint: false,
    readOnlyHint: false,
  },
};

export default async function chatRun(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleChatRun({
    client: clientState.client,
    message: params.message,
    conversationId: params.conversationId,
    model: params.model,
    authSource: params.authSource,
    sandbox: params.sandbox,
    autoApprove: params.autoApprove,
    fileAttachments: params.fileAttachments,
  });

  return toMcpToolResult(result);
}
