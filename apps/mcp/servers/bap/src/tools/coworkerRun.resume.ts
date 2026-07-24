import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerRunResume } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, runId: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "coworkerRun_resume",
  description: "Resume a paused Coworker Run.",
  annotations: { title: "Resume coworker run", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerRunResume({ client, runId: params.runId }),
  );
}
