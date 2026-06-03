import { createFileRoute } from "@tanstack/react-router";
import { handleCliSession } from "@/server/internal/testing-cli-session";

/** Thin server-route adapter for the internal CLI test-session minting endpoint. */
export const Route = createFileRoute("/api/internal/testing/cli-session")({
  server: {
    handlers: {
      POST: ({ request }) => handleCliSession(request),
    },
  },
});
