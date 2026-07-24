import { COWORKER_TOOL_ACCESS_MODES } from "@bap/core/lib/coworker-tool-policy";
import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import {
  integrationTypeSchema,
  modelReferenceSchema,
  workspaceIdSchema,
} from "../lib/contract-schemas";
import { handleCoworkerSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const scheduleTime = z
  .string()
  .describe('Time of day in 24h zero-padded "HH:MM", for example "09:30".');
const scheduleTimezone = z
  .string()
  .optional()
  .describe('IANA timezone name, for example "Europe/Paris". Defaults to UTC.');

const schedule = z.union([
  z.object({ type: z.literal("interval"), intervalMinutes: z.number().min(60).max(10080) }),
  z.object({ type: z.literal("daily"), time: scheduleTime, timezone: scheduleTimezone }),
  z.object({
    type: z.literal("weekly"),
    time: scheduleTime,
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .describe("Days of week to run, 0 = Sunday through 6 = Saturday."),
    timezone: scheduleTimezone,
  }),
  z.object({
    type: z.literal("monthly"),
    time: scheduleTime,
    dayOfMonth: z.number().int().min(1).max(31),
    timezone: scheduleTimezone,
  }),
  z.null(),
]);
const values = z
  .object({
    name: z.string().max(128).optional(),
    description: z.string().max(280).nullable().optional(),
    username: z.string().max(128).nullable().optional(),
    status: z.enum(["on", "off"]).optional(),
    favorite: z.boolean().optional(),
    folderId: z.string().nullable().optional(),
    trigger: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        'One of "manual", "schedule", "email", "webhook". Use "schedule" (with schedule set) to enable cron runs.',
      ),
    prompt: z.string().max(20000).optional(),
    autoApprove: z.boolean().optional(),
    model: modelReferenceSchema.optional(),
    authSource: z.enum(["user", "shared"]).nullable().optional(),
    toolAccessMode: z.enum(COWORKER_TOOL_ACCESS_MODES).optional(),
    integrationTypes: z.array(integrationTypeSchema).optional(),
    customIntegrationIds: z
      .array(z.string())
      .optional()
      .describe("Connected Account IDs from connectedAccount_read."),
    workspaceMcpServerIds: z
      .array(z.string())
      .optional()
      .describe("Workspace MCP Server IDs from workspaceMcpServer_list."),
    skillSlugs: z
      .array(z.string())
      .optional()
      .describe('Lowercase skill slugs from the skill catalog; prefix custom skills with "custom:".'),
    schedule: schedule.optional(),
    requiresUserInput: z.boolean().optional(),
    userInputPrompt: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const schema = { workspaceId: workspaceIdSchema, id: z.string().optional(), values };
export const metadata: ToolMetadata = {
  name: "coworker_save",
  description:
    "Create or partially update a Coworker, including status, favorite state, and Coworker Folder placement.",
  annotations: { title: "Save coworker", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerSave({ client, id: params.id, values: params.values }),
  );
}
