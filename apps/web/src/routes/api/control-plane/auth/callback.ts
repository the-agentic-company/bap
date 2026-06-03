import { createFileRoute } from "@tanstack/react-router";
import { callbackHandler } from "../-handlers/auth";

/** Thin adapter for the frozen `/api/control-plane/auth/callback` URL. */
export const Route = createFileRoute("/api/control-plane/auth/callback")({
  server: {
    handlers: {
      GET: ({ request }) => callbackHandler(request),
    },
  },
});
