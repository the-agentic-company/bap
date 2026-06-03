import { createFileRoute } from "@tanstack/react-router";
import { handleCoworkerEdit } from "@/server/internal/coworker-runtime";

/** Thin server-route adapter for the internal coworker runtime edit endpoint. */
export const Route = createFileRoute("/api/internal/coworkers/runtime/edit")({
  server: {
    handlers: {
      POST: ({ request }) => handleCoworkerEdit(request),
    },
  },
});
