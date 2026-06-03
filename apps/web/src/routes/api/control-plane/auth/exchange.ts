import { createFileRoute } from "@tanstack/react-router";
import { exchangeHandler } from "../-handlers/auth";

/** Thin adapter for the frozen `/api/control-plane/auth/exchange` URL. */
export const Route = createFileRoute("/api/control-plane/auth/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => exchangeHandler(request),
    },
  },
});
