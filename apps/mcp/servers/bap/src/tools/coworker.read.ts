import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { detailSchema, workspaceIdSchema } from "../lib/contract-schemas";
import { handleCoworkerRead } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const query = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("get"), reference: z.string().min(1) }).strict(),
  z.object({ type: z.literal("export"), reference: z.string().min(1) }).strict(),
]);
export const schema = { workspaceId: workspaceIdSchema, query, detail: detailSchema };
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
