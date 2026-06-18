import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerSetStatus } from "../lib/handlers";

export const schema = {
  reference: z.string().describe("Coworker ID or @username"),
  status: z.enum(["on", "off"]).describe("Coworker status"),
};

export const metadata: ToolMetadata = {
  name: "coworker.setStatus",
  description: "Turn a coworker on or off",
  annotations: {
    title: "Set coworker status",
    readOnlyHint: false,
    idempotentHint: true,
  },
};

export default async function coworkerSetStatus(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleCoworkerSetStatus({
    client: clientState.client,
    reference: params.reference,
    status: params.status,
  });
  return toMcpToolResult(result);
}
