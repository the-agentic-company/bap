import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { handleCoworkerDelete } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
};

export const metadata: ToolMetadata = {
  name: "coworker_delete",
  description: "Delete an existing coworker",
  annotations: {
    title: "Delete coworker",
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerDelete(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerDelete({ client, reference: params.reference }),
  );
}
