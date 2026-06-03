import { createFileRoute } from "@tanstack/react-router";
import { mockCrmOpenApiHandler } from "./-handlers/openapi";

/**
 * `/api/mock/crm/openapi.json`. Serves the mock CRM OpenAPI document. The `[.]` in the file
 * name escapes the literal dot so the public URL keeps its `.json` suffix. Thin TanStack Start
 * adapter; origin derivation + document build live in the framework-neutral handler. Public
 * mock fixtures (no auth by design).
 */
export const Route = createFileRoute("/api/mock/crm/openapi.json")({
  server: {
    handlers: {
      GET: ({ request }) => mockCrmOpenApiHandler(request),
    },
  },
});
