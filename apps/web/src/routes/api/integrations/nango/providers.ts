import { createFileRoute } from "@tanstack/react-router";
import { handleNangoProviders } from "../-handlers/nango-providers";

/**
 * Server route for `/api/integrations/nango/providers`. Thin adapter over the
 * framework-neutral `handleNangoProviders` handler; authorization lives in the handler.
 */
export const Route = createFileRoute("/api/integrations/nango/providers")({
  server: {
    handlers: {
      GET: ({ request }) => handleNangoProviders(request),
    },
  },
});
