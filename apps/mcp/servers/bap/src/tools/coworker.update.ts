import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerUpdate } from "../lib/handlers";

const scheduleSchema = z
  .union([
    z.object({
      type: z.literal("interval"),
      intervalMinutes: z.number().min(60).max(10080),
    }),
    z.object({
      type: z.literal("daily"),
      time: z.string(),
      timezone: z.string().optional(),
    }),
    z.object({
      type: z.literal("weekly"),
      time: z.string(),
      daysOfWeek: z.array(z.number().min(0).max(6)).min(1),
      timezone: z.string().optional(),
    }),
    z.object({
      type: z.literal("monthly"),
      time: z.string(),
      dayOfMonth: z.number().min(1).max(31),
      timezone: z.string().optional(),
    }),
    z.null(),
  ])
  .optional();

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
  name: z.string().max(128).optional().describe("Coworker name"),
  description: z.string().max(280).nullable().optional().describe("Coworker description"),
  username: z.string().max(128).nullable().optional().describe("Coworker username"),
  status: z.enum(["on", "off"]).optional().describe("Coworker status"),
  trigger: z.string().min(1).max(128).optional().describe("Trigger type"),
  prompt: z.string().max(20000).optional().describe("Coworker instructions"),
  autoApprove: z.boolean().optional().describe("Enable auto-approve"),
  isPinned: z.boolean().optional().describe("Pinned coworker state"),
  model: z.string().optional().describe("Model reference"),
  authSource: z.enum(["user", "shared"]).nullable().optional().describe("Model auth source"),
  toolAccessMode: z.enum(["all", "selected"]).optional().describe("Tool access mode"),
  integrations: z.array(z.string()).optional().describe("Allowed integrations"),
  customIntegrations: z.array(z.string()).optional().describe("Allowed custom integrations"),
  workspaceMcpServerIds: z
    .array(z.string())
    .optional()
    .describe("Allowed workspace MCP server IDs"),
  skillSlugs: z.array(z.string()).optional().describe("Allowed skill slugs"),
  schedule: scheduleSchema.describe("Coworker schedule, or null to clear it"),
  requiresUserInput: z.boolean().optional().describe("Require a Start Message before running"),
  userInputPrompt: z.string().max(1000).nullable().optional().describe("User Input Prompt"),
};

export const metadata: ToolMetadata = {
  name: "coworker.update",
  description: "Update an existing coworker",
  annotations: {
    title: "Update coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerUpdate(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerUpdate({
    client: clientState.client,
    reference: params.reference,
    name: params.name,
    description: params.description,
    username: params.username,
    status: params.status,
    trigger: params.trigger,
    prompt: params.prompt,
    autoApprove: params.autoApprove,
    isPinned: params.isPinned,
    model: params.model,
    authSource: params.authSource,
    toolAccessMode: params.toolAccessMode,
    integrations: params.integrations,
    customIntegrations: params.customIntegrations,
    workspaceMcpServerIds: params.workspaceMcpServerIds,
    skillSlugs: params.skillSlugs,
    schedule: params.schedule,
    requiresUserInput: params.requiresUserInput,
    userInputPrompt: params.userInputPrompt,
  });
  return toMcpToolResult(result);
}
