import { createFileRoute } from "@tanstack/react-router";
import { startHandler } from "../-handlers/link";

/** Thin adapter for the frozen `/api/control-plane/link/start` URL. */
export const Route = createFileRoute("/api/control-plane/link/start")({
  server: {
    handlers: {
      POST: ({ request }) => startHandler(request),
    },
  },
});
