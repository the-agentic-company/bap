import { createFileRoute } from "@tanstack/react-router";
import { disconnectHandler } from "../-handlers/provider-auth";

/** Thin adapter for the frozen `/api/control-plane/provider-auth/disconnect` URL. */
export const Route = createFileRoute("/api/control-plane/provider-auth/disconnect")({
  server: {
    handlers: {
      POST: ({ request }) => disconnectHandler(request),
    },
  },
});
