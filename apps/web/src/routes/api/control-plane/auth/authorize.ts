import { createFileRoute } from "@tanstack/react-router";
import { authorizeHandler } from "../-handlers/auth";

/** Thin adapter for the frozen `/api/control-plane/auth/authorize` URL. */
export const Route = createFileRoute("/api/control-plane/auth/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => authorizeHandler(request),
    },
  },
});
