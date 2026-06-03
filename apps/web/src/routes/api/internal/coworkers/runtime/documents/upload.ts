import { createFileRoute } from "@tanstack/react-router";
import { handleCoworkerDocumentUpload } from "@/server/internal/coworker-runtime";

/** Thin server-route adapter for the internal coworker runtime document upload endpoint. */
export const Route = createFileRoute("/api/internal/coworkers/runtime/documents/upload")({
  server: {
    handlers: {
      POST: ({ request }) => handleCoworkerDocumentUpload(request),
    },
  },
});
