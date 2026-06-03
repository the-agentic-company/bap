import { createFileRoute } from "@tanstack/react-router";
import { handleClientObservations } from "./-handlers/client-observations";

/**
 * Server route for `/api/observability/client-observations`. Thin adapter over
 * the framework-neutral `handleClientObservations` handler, which enforces
 * authentication and workspace authorization internally.
 */
export const Route = createFileRoute("/api/observability/client-observations")({
  server: {
    handlers: {
      POST: ({ request }) => handleClientObservations(request),
    },
  },
});
