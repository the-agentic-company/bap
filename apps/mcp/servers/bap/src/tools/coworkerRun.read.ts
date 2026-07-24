import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { detailSchema, workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerRunRead } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const status = z.enum([
  "needs_user_input",
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "cancelling",
  "completed",
  "error",
  "cancelled",
]);
const query = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("list"),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      status: status.optional(),
      coworkerId: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal("logs"), runId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("downloadFile"),
      runId: z.string().min(1),
      fileId: z.string().min(1),
    })
    .strict(),
]);
export const schema = { workspaceId: workspaceIdSchema, query, detail: detailSchema };
export const metadata: ToolMetadata = {
  name: "coworkerRun_read",
  description: "List Coworker Runs, read run logs, or download a Sandbox File owned by a run.",
  annotations: { title: "Read coworker runs", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerRunRead({ client, query: params.query }),
  );
}
