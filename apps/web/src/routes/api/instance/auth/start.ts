import { createFileRoute } from "@tanstack/react-router";
import { handleInstanceAuthStart } from "@/server/instance/handlers";

/**
 * Self-host instance auth start. Preserves the public `/api/instance/auth/start`
 * URL. Thin TanStack Start server route adapter; the redirect logic stays in the
 * framework-neutral handler module.
 */
export const Route = createFileRoute("/api/instance/auth/start")({
  server: {
    handlers: {
      GET: ({ request }) => handleInstanceAuthStart(request),
    },
  },
});
