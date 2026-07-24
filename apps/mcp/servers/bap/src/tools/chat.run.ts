import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import {
  attachmentReferenceSchema,
  modelReferenceSchema,
  toFileAttachments,
  workspaceIdSchema,
} from "../lib/contract-schemas";
import { handleChatRun } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema.describe("Workspace ID for this chat turn"),
  message: z.string().describe("The prompt to send to Bap chat"),
  conversationId: z.string().optional().describe("Existing conversation ID to continue"),
  model: modelReferenceSchema.optional(),
  authSource: z.enum(["user", "shared"]).optional().describe("Model auth source"),
  sandbox: z.enum(["e2b", "daytona", "docker"]).optional().describe("Sandbox provider"),
  autoApprove: z.boolean().optional().describe("Auto-approve tool calls"),
  attachments: z
    .array(attachmentReferenceSchema)
    .optional()
    .describe("Optional ready attachments for the chat turn"),
};

export const metadata: ToolMetadata = {
  name: "chat.run",
  description:
    "Run a Bap chat turn and return a structured result. The message may be empty when at least one ready attachment is provided.",
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
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleChatRun({
      client,
      message: params.message,
      conversationId: params.conversationId,
      model: params.model,
      authSource: params.authSource,
      sandbox: params.sandbox,
      autoApprove: params.autoApprove,
      fileAttachments: toFileAttachments(params.attachments),
    }),
  );
}
