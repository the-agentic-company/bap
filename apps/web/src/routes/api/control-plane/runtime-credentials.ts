import { createFileRoute } from "@tanstack/react-router";
import { runtimeCredentialsHandler } from "./-handlers/runtime-credentials";

/** Thin adapter for the frozen `/api/control-plane/runtime-credentials` URL. */
export const Route = createFileRoute("/api/control-plane/runtime-credentials")({
  server: {
    handlers: {
      POST: ({ request }) => runtimeCredentialsHandler(request),
    },
  },
});
