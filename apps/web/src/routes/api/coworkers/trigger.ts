import { createFileRoute } from "@tanstack/react-router";
import { triggerCoworker } from "@/server/api/coworkers/trigger";

/**
 * Server route adapter preserving the public `POST /api/coworkers/trigger` URL. All logic
 * (server-secret auth, validation, run trigger) lives in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/coworkers/trigger")({
  server: {
    handlers: {
      POST: ({ request }) => triggerCoworker(request),
    },
  },
});
