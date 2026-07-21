import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { coworkerReadQuerySchema, detailSchema, workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerRead } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: workspaceIdSchema,
  query: coworkerReadQuerySchema,
  detail: detailSchema,
};
export const metadata: ToolMetadata = {
  name: "coworker.read",
  description: "List, get, or export Coworkers.",
  annotations: { title: "Read coworkers", readOnlyHint: true, idempotentHint: true },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerRead({ client, query: params.query }),
  );
}
