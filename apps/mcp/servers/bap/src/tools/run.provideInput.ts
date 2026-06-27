import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createMcpClient } from "../lib/client";
import { handleRunProvideInput } from "../lib/handlers";

export const schema = {
  runId: z.string().min(1).describe("Run id that is waiting in needs_user_input"),
  userInput: z.string().min(1).describe("Trusted user input to hand to the waiting run"),
};

export const metadata: ToolMetadata = {
  name: "run.provideInput",
  description: "Provide the requested input to a coworker run paused in needs_user_input",
  annotations: {
    title: "Provide run input",
    readOnlyHint: false,
    idempotentHint: false,
  },
};

export default async function runProvideInput(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const clientState = createMcpClient(extra);
  if (clientState.status !== "ready") {
    return toMcpToolResult(clientState);
  }
  const result = await handleRunProvideInput({
    client: clientState.client,
    runId: params.runId,
    userInput: params.userInput,
  });
  return toMcpToolResult(result);
}
