import { createFileRoute } from "@tanstack/react-router";
import { statusHandler } from "../-handlers/integrations";

/** Thin adapter for the frozen `/api/control-plane/integrations/status` URL. */
export const Route = createFileRoute("/api/control-plane/integrations/status")({
  server: {
    handlers: {
      POST: ({ request }) => statusHandler(request),
    },
  },
});
