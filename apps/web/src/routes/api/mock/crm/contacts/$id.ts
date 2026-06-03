import { createFileRoute } from "@tanstack/react-router";
import { getContactHandler, patchContactHandler } from "../-handlers/contacts";

/**
 * `/api/mock/crm/contacts/:id`. Mock CRM single-contact read/patch. Thin TanStack Start
 * adapter; logic lives in the framework-neutral handlers. The `id` segment is derived from the
 * standard request params. Public mock fixtures (no auth by design).
 */
export const Route = createFileRoute("/api/mock/crm/contacts/$id")({
  server: {
    handlers: {
      GET: ({ params }) => getContactHandler(params.id),
      PATCH: ({ request, params }) => patchContactHandler(request, params.id),
    },
  },
});
