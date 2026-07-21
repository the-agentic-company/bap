import { type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { handleWorkspaceList } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "workspace.list",
  description: "List the workspaces available to the authenticated user",
  annotations: {
    title: "List workspaces",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function workspaceList(_params: typeof schema, extra?: ToolExtraArguments) {
  return executeBapTool(extra, undefined, metadata.name, handleWorkspaceList);
}
