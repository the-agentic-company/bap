import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerRunCancel } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = { workspaceId: workspaceIdSchema, runId: z.string().min(1) };
export const metadata: ToolMetadata = {
  name: "coworkerRun_cancel",
  description: "Cancel a nonterminal Coworker Run.",
  annotations: {
    title: "Cancel coworker run",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerRunCancel({ client, runId: params.runId }),
  );
}
