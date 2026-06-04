import { createFileRoute } from "@tanstack/react-router";
import { handleLiveness } from "@/server/health/handler";

/**
 * Process liveness probe for platform health checks. Keep deep dependency checks on
 * `/api/health`; Render should only use this endpoint to decide whether the web process is up.
 */
export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: () => handleLiveness(),
    },
  },
});
