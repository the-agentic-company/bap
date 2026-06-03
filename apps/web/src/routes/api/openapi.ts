import { createFileRoute } from "@tanstack/react-router";
import { handleOpenApi } from "@/server/openapi/handler";

/**
 * OpenAPI schema server route. Preserves the public `/api/openapi` URL and the JSON
 * OpenAPI document shape. Thin TanStack Start adapter; spec generation lives in the
 * framework-neutral `handleOpenApi` handler (standard `Response`, no Next imports).
 */
export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: () => handleOpenApi(),
    },
  },
});
