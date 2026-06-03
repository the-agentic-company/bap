import { createFileRoute } from "@tanstack/react-router";
import { createDealHandler, listDealsHandler } from "./-handlers/deals";

/**
 * `/api/mock/crm/deals`. Mock CRM deals collection. Thin TanStack Start adapter; logic lives in
 * the framework-neutral handlers. Public mock fixtures (no auth by design).
 */
export const Route = createFileRoute("/api/mock/crm/deals")({
  server: {
    handlers: {
      GET: ({ request }) => listDealsHandler(request),
      POST: ({ request }) => createDealHandler(request),
    },
  },
});
