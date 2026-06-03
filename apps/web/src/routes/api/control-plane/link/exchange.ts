import { createFileRoute } from "@tanstack/react-router";
import { exchangeHandler } from "../-handlers/link";

/** Thin adapter for the frozen `/api/control-plane/link/exchange` URL. */
export const Route = createFileRoute("/api/control-plane/link/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => exchangeHandler(request),
    },
  },
});
