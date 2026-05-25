import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { createManagedModulrClient } from "../lib/modulr-auth";
import { extractPdfTextFromBase64 } from "../lib/pdf-text";

export const schema = {
  documentId: z.string().min(1).describe("Modulr document id"),
  maxCharacters: z
    .number()
    .int()
    .min(1_000)
    .max(50_000)
    .optional()
    .describe("Maximum extracted text characters to return. Defaults to 20000."),
};

export const metadata: ToolMetadata = {
  name: "modulr.read_document_text",
  description: "Download a Modulr PDF document and return extracted text for reading or summarization.",
  annotations: {
    title: "Read document text",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function readDocumentText(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const client = await createManagedModulrClient(extra);
  const document = await client.getDocument(params.documentId);
  if (document.mimeType !== "application/pdf") {
    throw new Error(
      `Text extraction currently supports PDF documents only. Document ${document.id} has MIME type ${document.mimeType}.`,
    );
  }

  const extracted = await extractPdfTextFromBase64(document.blob, params.maxCharacters);
  return {
    content: [
      {
        type: "text" as const,
        text: extracted.text || "No extractable text was found in this PDF.",
      },
    ],
    structuredContent: {
      id: document.id,
      title: document.title,
      filename: document.filename,
      mimeType: document.mimeType,
      resourceUri: document.resourceUri,
      pageCount: extracted.pageCount,
      truncated: extracted.truncated,
      characterCount: extracted.characterCount,
      text: extracted.text,
    },
  };
}
