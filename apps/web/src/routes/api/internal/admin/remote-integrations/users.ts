import { createFileRoute } from "@tanstack/react-router";
import { handleRemoteIntegrationUsers } from "@/server/internal/admin-remote-integrations";

/** Thin server-route adapter for the internal admin remote-integration user search. */
export const Route = createFileRoute("/api/internal/admin/remote-integrations/users")({
  server: {
    handlers: {
      POST: ({ request }) => handleRemoteIntegrationUsers(request),
    },
  },
});
