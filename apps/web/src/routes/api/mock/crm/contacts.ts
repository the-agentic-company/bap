import { createFileRoute } from "@tanstack/react-router";
import { createContactHandler, listContactsHandler } from "./-handlers/contacts";

/**
 * `/api/mock/crm/contacts`. Mock CRM contacts collection. Thin TanStack Start adapter; logic
 * lives in the framework-neutral handlers. Public mock fixtures (no auth by design).
 */
export const Route = createFileRoute("/api/mock/crm/contacts")({
  server: {
    handlers: {
      GET: ({ request }) => listContactsHandler(request),
      POST: ({ request }) => createContactHandler(request),
    },
  },
});
