import { createFileRoute } from "@tanstack/react-router";
import { disconnectHandler } from "../-handlers/integrations";

/** Thin adapter for the frozen `/api/control-plane/integrations/disconnect` URL. */
export const Route = createFileRoute("/api/control-plane/integrations/disconnect")({
  server: {
    handlers: {
      POST: ({ request }) => disconnectHandler(request),
    },
  },
});
