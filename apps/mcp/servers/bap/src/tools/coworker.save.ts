import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const schedule = z.union([
  z.object({ type: z.literal("interval"), intervalMinutes: z.number().min(60).max(10080) }),
  z.object({ type: z.literal("daily"), time: z.string(), timezone: z.string().optional() }),
  z.object({
    type: z.literal("weekly"),
    time: z.string(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
    timezone: z.string().optional(),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string(),
    dayOfMonth: z.number().int().min(1).max(31),
    timezone: z.string().optional(),
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
    trigger: z.string().min(1).max(128).optional(),
    prompt: z.string().max(20000).optional(),
    autoApprove: z.boolean().optional(),
    model: z.string().optional(),
    authSource: z.enum(["user", "shared"]).nullable().optional(),
    toolAccessMode: z.string().optional(),
    integrationTypes: z.array(z.string()).optional(),
    customIntegrationIds: z.array(z.string()).optional(),
    workspaceMcpServerIds: z.array(z.string()).optional(),
    skillSlugs: z.array(z.string()).optional(),
    schedule: schedule.optional(),
    requiresUserInput: z.boolean().optional(),
    userInputPrompt: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const schema = { workspaceId: workspaceIdSchema, id: z.string().optional(), values };
export const metadata: ToolMetadata = {
  name: "coworker.save",
  description:
    "Create or partially update a Coworker, including status, favorite state, and Coworker Folder placement.",
  annotations: { title: "Save coworker", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerSave({ client, id: params.id, values: params.values }),
  );
}
