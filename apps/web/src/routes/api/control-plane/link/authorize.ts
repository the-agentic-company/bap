import { createFileRoute } from "@tanstack/react-router";
import { authorizeHandler } from "../-handlers/link";

/** Thin adapter for the frozen `/api/control-plane/link/authorize` URL. */
export const Route = createFileRoute("/api/control-plane/link/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => authorizeHandler(request),
    },
  },
});
