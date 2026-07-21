import { z } from "zod";
import type { InferSchema, ToolExtraArguments, ToolMetadata } from "xmcp";
import {
  attachmentReferenceSchema,
  toFileAttachments,
  workspaceIdSchema,
} from "../lib/contract-schemas";
import { handleCoworkerRunStart } from "../lib/handlers";
import { executeBapTool } from "../lib/tool-runtime";

const request = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("new"),
      coworkerReference: z.string().min(1),
      input: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      attachments: z.array(attachmentReferenceSchema).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("provideInput"),
      runId: z.string().min(1),
      input: z.string().trim().min(1),
      attachments: z.array(attachmentReferenceSchema).optional(),
    })
    .strict(),
]);
export const schema = { workspaceId: workspaceIdSchema, request };
export const metadata: ToolMetadata = {
  name: "coworkerRun.start",
  description:
    "Start a Coworker Run with optional input and attachments, or provide requested input to an existing run.",
  annotations: { title: "Start coworker run", readOnlyHint: false, idempotentHint: false },
};
export default async function tool(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const request =
    params.request.mode === "new"
      ? { ...params.request, fileAttachments: toFileAttachments(params.request.attachments) }
      : { ...params.request, fileAttachments: toFileAttachments(params.request.attachments) };
  return executeBapTool(extra, params.workspaceId, metadata.name, (client) =>
    handleCoworkerRunStart({ client, request }),
  );
}
