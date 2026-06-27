import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerClone } from "../lib/handlers";

export const schema = {
  reference: z.string().min(1).describe("Source coworker ID or @username to clone"),
  name: z.string().max(128).optional().describe("Name for the clone. Defaults to '<source> (copy)'."),
};

export const metadata: ToolMetadata = {
  name: "coworker.clone",
  description:
    "Clone a coworker's configuration into a new coworker. Uploaded documents are not copied.",
  annotations: {
    title: "Clone coworker",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function coworkerClone(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerClone({
    client: clientState.client,
    reference: params.reference,
    name: params.name,
  });
  return toMcpToolResult(result);
}
