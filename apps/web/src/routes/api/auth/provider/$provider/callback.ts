import { createFileRoute } from "@tanstack/react-router";
import { handleProviderCallback } from "@/server/auth/handlers";

/**
 * `/api/auth/provider/:provider/callback`. Subscription-provider OAuth callback.
 * Hard public-URL contract: provider dashboards point at this exact path. Thin
 * TanStack Start server route adapter; token exchange, session/state ownership
 * checks, and token storage live in the framework-neutral handler. The provider
 * segment is derived from the standard `Request` URL so the handler stays
 * framework-neutral and testable.
 */
export const Route = createFileRoute("/api/auth/provider/$provider/callback")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleProviderCallback(request, params.provider),
    },
  },
});
