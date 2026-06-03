import { createFileRoute } from "@tanstack/react-router";
import { handleCoworkerInvoke } from "@/server/internal/coworker-runtime";

/** Thin server-route adapter for the internal coworker runtime invoke endpoint. */
export const Route = createFileRoute("/api/internal/coworkers/runtime/invoke")({
  server: {
    handlers: {
      POST: ({ request }) => handleCoworkerInvoke(request),
    },
  },
});
