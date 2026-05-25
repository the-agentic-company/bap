import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createManagedModulrClient } from "../lib/modulr-auth";

export const schema = {
  email: z.string().email().describe("Exact customer email address to resolve in Modulr"),
  includeRelatedRecords: z
    .boolean()
    .default(true)
    .describe("Include documents attached to policies, estimates, claims, and complaints"),
  extranetOnly: z
    .boolean()
    .default(false)
    .describe("Only return documents carrying the Modulr extranet GED tag"),
};

export const metadata: ToolMetadata = {
  name: "modulr.list_customer_documents_by_email",
  description: "Find a Modulr customer by exact email and list attached GED documents.",
  annotations: {
    title: "List customer documents",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function listCustomerDocumentsByEmail(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  return toMcpToolResult(
    await client.listCustomerDocumentsByEmail({
      email: params.email,
      includeRelatedRecords: params.includeRelatedRecords,
      extranetOnly: params.extranetOnly,
    }),
  );
}
