import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import { handleWorkspaceSave } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: z.string().trim().min(1).optional().describe("Workspace ID when updating"),
  values: z.object({ name: z.string().trim().min(2).max(80) }).strict(),
};
export const metadata: ToolMetadata = {
  name: "workspace.save",
  description: "Create a Workspace, or rename the explicitly identified Workspace.",
  annotations: { title: "Save workspace", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleWorkspaceSave({ client, workspaceId: params.workspaceId, name: params.values.name }),
  );
}
