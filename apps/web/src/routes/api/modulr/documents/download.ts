import { createFileRoute } from "@tanstack/react-router";
import { downloadModulrDocument } from "@/server/api/modulr/document-download";

/**
 * Server route adapter preserving the public `GET /api/modulr/documents/download`
 * URL. All logic (signed token verification, S3 binary streaming, content-disposition)
 * lives in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/modulr/documents/download")({
  server: {
    handlers: {
      GET: ({ request }) => downloadModulrDocument(request),
    },
  },
});
