import { createFileRoute } from "@tanstack/react-router";
import { handleCoworkerList } from "@/server/internal/coworker-runtime";

/** Thin server-route adapter for the internal coworker runtime list endpoint. */
export const Route = createFileRoute("/api/internal/coworkers/runtime/list")({
  server: {
    handlers: {
      POST: ({ request }) => handleCoworkerList(request),
    },
  },
});
