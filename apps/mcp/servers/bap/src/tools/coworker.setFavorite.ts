import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerSetFavorite } from "../lib/handlers";

export const schema = {
  workspaceId: z.string().trim().min(1).describe("Workspace ID containing the coworker"),
  reference: z.string().describe("Coworker ID or @username"),
  favorite: z.boolean().describe("Whether the coworker should be favorited"),
};

export const metadata: ToolMetadata = {
  name: "coworker.setFavorite",
  description: "Add or remove a coworker from favorites",
  annotations: {
    title: "Set coworker favorite",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function coworkerSetFavorite(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra, params.workspaceId);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerSetFavorite({
    client: clientState.client,
    reference: params.reference,
    favorite: params.favorite,
  });
  return toMcpToolResult(result);
}
