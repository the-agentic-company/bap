import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { createManagedModulrClient } from "../lib/modulr-auth";

export const schema = {
  clientId: z.string().min(1).describe("Modulr client id"),
};

export const metadata: ToolMetadata = {
  name: "modulr.list_customer_records",
  description: "List Modulr records related to a customer.",
  annotations: {
    title: "List customer records",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function listCustomerRecords(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  return toMcpToolResult(await client.listCustomerRecords(params.clientId));
}
