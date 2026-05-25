import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createManagedModulrClient } from "../lib/modulr-auth";

export const schema = {
  records: z
    .array(
      z.object({
        recordType: z.enum(["client", "policy", "estimate", "claim", "complaint"]),
        recordId: z.string().min(1),
      }),
    )
    .min(1)
    .describe("Modulr records whose GED attachments should be listed"),
  extranetOnly: z
    .boolean()
    .default(false)
    .describe("Only return documents carrying the Modulr extranet GED tag"),
};

export const metadata: ToolMetadata = {
  name: "modulr.list_documents_for_records",
  description: "List GED documents attached to one or more Modulr records.",
  annotations: {
    title: "List record documents",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function listDocumentsForRecords(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  const documents = await Promise.all(
    params.records.map((record) =>
      client.listDocumentsForRecord({
        ...record,
        extranetOnly: params.extranetOnly,
      }),
    ),
  );
  return toMcpToolResult({
    documents: documents.flat(),
  });
}
