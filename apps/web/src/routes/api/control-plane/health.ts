import { createFileRoute } from "@tanstack/react-router";
import { healthHandler } from "./-handlers/health";

/** Thin adapter for the frozen `/api/control-plane/health` URL. */
export const Route = createFileRoute("/api/control-plane/health")({
  server: {
    handlers: {
      GET: ({ request }) => healthHandler(request),
    },
  },
});
