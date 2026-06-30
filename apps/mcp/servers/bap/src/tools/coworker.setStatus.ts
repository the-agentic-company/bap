import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleCoworkerSetStatus } from "../lib/handlers";

export const schema = {
  reference: z
    .string()
    .optional()
    .describe("Coworker ID or @username. Required unless runId is provided."),
  runId: z.string().optional().describe('In-flight run id to cancel. Use with status "off".'),
  status: z
    .enum(["on", "off"])
    .describe('Coworker status, or "off" to cancel the run when runId is set'),
};

export const metadata: ToolMetadata = {
  name: "coworker.setStatus",
  description:
    'Turn a coworker on or off, or cancel an in-flight run by passing runId with status "off"',
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
    runId: params.runId,
    status: params.status,
  });
  return toMcpToolResult(result);
}
