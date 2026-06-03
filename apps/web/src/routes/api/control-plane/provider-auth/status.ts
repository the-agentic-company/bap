import { createFileRoute } from "@tanstack/react-router";
import { statusHandler } from "../-handlers/provider-auth";

/** Thin adapter for the frozen `/api/control-plane/provider-auth/status` URL. */
export const Route = createFileRoute("/api/control-plane/provider-auth/status")({
  server: {
    handlers: {
      POST: ({ request }) => statusHandler(request),
    },
  },
});
