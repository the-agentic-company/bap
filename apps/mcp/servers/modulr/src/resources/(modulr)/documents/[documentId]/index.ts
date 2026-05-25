import { z } from "zod";
import { type ResourceMetadata, type ToolExtraArguments } from "xmcp";
import { createManagedModulrClient } from "../../../../lib/modulr-auth";

export const schema = {
  documentId: z.string().min(1),
};

export const metadata: ResourceMetadata = {
  name: "modulr-document",
  description: "Downloadable Modulr GED document",
  mimeType: "application/octet-stream",
};

export default async function readModulrDocument(
  params: { documentId: string },
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  const document = await client.getDocument(params.documentId);
  return {
    contents: [
      {
        uri: document.resourceUri,
        name: document.filename ?? document.title ?? `modulr-document-${document.id}`,
        mimeType: document.mimeType,
        blob: document.blob,
      },
    ],
  };
}
