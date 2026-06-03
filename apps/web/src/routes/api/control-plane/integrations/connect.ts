import { createFileRoute } from "@tanstack/react-router";
import { connectHandler } from "../-handlers/integrations";

/** Thin adapter for the frozen `/api/control-plane/integrations/connect` URL. */
export const Route = createFileRoute("/api/control-plane/integrations/connect")({
  server: {
    handlers: {
      GET: ({ request }) => connectHandler(request),
    },
  },
});
