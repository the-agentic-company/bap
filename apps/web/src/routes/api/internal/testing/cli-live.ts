import { createFileRoute } from "@tanstack/react-router";
import { handleCliLive } from "@/server/internal/testing-cli-live";

/** Thin server-route adapter for the internal CLI live-testing control endpoint. */
export const Route = createFileRoute("/api/internal/testing/cli-live")({
  server: {
    handlers: {
      POST: ({ request }) => handleCliLive(request),
    },
  },
});
