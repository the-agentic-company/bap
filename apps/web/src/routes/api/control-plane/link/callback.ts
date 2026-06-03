import { createFileRoute } from "@tanstack/react-router";
import { callbackHandler } from "../-handlers/link";

/** Thin adapter for the frozen `/api/control-plane/link/callback` URL. */
export const Route = createFileRoute("/api/control-plane/link/callback")({
  server: {
    handlers: {
      GET: ({ request }) => callbackHandler(request),
    },
  },
});
