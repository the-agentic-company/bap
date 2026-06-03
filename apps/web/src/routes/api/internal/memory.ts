import { createFileRoute } from "@tanstack/react-router";
import { handleMemory } from "@/server/internal/memory";

/** Thin server-route adapter for the internal memory plugin endpoint. */
export const Route = createFileRoute("/api/internal/memory")({
  server: {
    handlers: {
      POST: ({ request }) => handleMemory(request),
    },
  },
});
