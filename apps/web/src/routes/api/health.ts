import { createFileRoute } from "@tanstack/react-router";
import { handleHealth } from "@/server/health/handler";

/**
 * Health check server route. Preserves the public `/api/health` URL and JSON shape used by
 * the Render `healthCheckPath`. Thin TanStack Start adapter; the database/redis checks live in
 * the framework-neutral `handleHealth` handler (standard `Response`, no Next imports).
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => handleHealth(),
    },
  },
});
