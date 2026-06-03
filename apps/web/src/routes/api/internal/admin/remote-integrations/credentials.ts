import { createFileRoute } from "@tanstack/react-router";
import { handleRemoteIntegrationCredentials } from "@/server/internal/admin-remote-integrations";

/**
 * Thin server-route adapter for the internal admin remote-integration credentials endpoint.
 * Authorization (Bearer CMDCLAW_SERVER_SECRET) stays inside the handler, not in any page
 * guard, so the API contract is preserved regardless of routing.
 */
export const Route = createFileRoute("/api/internal/admin/remote-integrations/credentials")({
  server: {
    handlers: {
      POST: ({ request }) => handleRemoteIntegrationCredentials(request),
    },
  },
});
