import { createFileRoute } from "@tanstack/react-router";
import { toggleHandler } from "../-handlers/integrations";

/** Thin adapter for the frozen `/api/control-plane/integrations/toggle` URL. */
export const Route = createFileRoute("/api/control-plane/integrations/toggle")({
  server: {
    handlers: {
      POST: ({ request }) => toggleHandler(request),
    },
  },
});
