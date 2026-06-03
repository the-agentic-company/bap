import { createFileRoute } from "@tanstack/react-router";
import { handleInviteOnlyRequestAccess } from "@/server/invite-only/handlers";

/**
 * Request access endpoint for invite-only deployments. Preserves the public
 * `/api/invite-only/request-access` URL and POST contract (400 on invalid body,
 * already-approved short-circuit, Slack notification). Thin TanStack Start adapter over the
 * framework-neutral handler.
 */
export const Route = createFileRoute("/api/invite-only/request-access")({
  server: {
    handlers: {
      POST: ({ request }) => handleInviteOnlyRequestAccess(request),
    },
  },
});
