import { createFileRoute } from "@tanstack/react-router";
import { startHandler } from "../-handlers/auth";

/** Thin adapter for the frozen `/api/control-plane/auth/start` URL. */
export const Route = createFileRoute("/api/control-plane/auth/start")({
  server: {
    handlers: {
      POST: ({ request }) => startHandler(request),
    },
  },
});
