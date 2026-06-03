import { createFileRoute } from "@tanstack/react-router";
import { handleInstanceHealth } from "@/server/instance/handlers";

/**
 * Instance health check. Preserves the public `/api/instance/health` URL and the
 * authenticated 401/200/503 behavior. Thin server route adapter; auth and the
 * health checks stay in the framework-neutral handler module.
 */
export const Route = createFileRoute("/api/instance/health")({
  server: {
    handlers: {
      GET: ({ request }) => handleInstanceHealth(request),
    },
  },
});
