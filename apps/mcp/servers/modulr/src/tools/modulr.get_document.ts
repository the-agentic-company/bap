import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { createManagedModulrClient } from "../lib/modulr-auth";

export const schema = {
  documentId: z.string().min(1).describe("Modulr document id"),
};

export const metadata: ToolMetadata = {
  name: "modulr.get_document",
  description: "Return a resource link for a Modulr document download.",
  annotations: {
    title: "Get document",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function getDocument(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  const document = await client.getDocument(params.documentId);
  return {
    content: [
      {
        type: "resource_link" as const,
        uri: document.resourceUri,
        name: document.filename ?? document.title ?? `modulr-document-${document.id}`,
        mimeType: document.mimeType,
      },
    ],
    structuredContent: {
      id: document.id,
      title: document.title,
      filename: document.filename,
      mimeType: document.mimeType,
      resourceUri: document.resourceUri,
    },
  };
}
