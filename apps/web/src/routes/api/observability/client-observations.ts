import { createFileRoute } from "@tanstack/react-router";

/**
 * Server route for `/api/observability/client-observations`. Thin adapter over
 * the framework-neutral `handleClientObservations` handler, which enforces
 * authentication and workspace authorization internally.
 */
export const Route = createFileRoute("/api/observability/client-observations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleClientObservations } = await import("./-handlers/client-observations");
        return handleClientObservations(request);
      },
    },
  },
});
