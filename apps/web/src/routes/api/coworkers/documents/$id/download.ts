import { createFileRoute } from "@tanstack/react-router";
import { downloadCoworkerDocument } from "@/server/api/coworkers/document-download";

/**
 * Server route adapter preserving the public `GET /api/coworkers/documents/:id/download`
 * URL. All logic (session + workspace auth, S3 binary streaming, content-disposition) lives
 * in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/coworkers/documents/$id/download")({
  server: {
    handlers: {
      GET: ({ request, params }) => downloadCoworkerDocument(request, params.id),
    },
  },
});
