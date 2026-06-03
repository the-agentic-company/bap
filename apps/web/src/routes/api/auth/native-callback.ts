import { createFileRoute } from "@tanstack/react-router";
import { handleNativeCallback } from "@/server/auth/handlers";

/**
 * `/api/auth/native-callback`. Native magic-link app callback. Thin TanStack
 * Start server route adapter; the session-token extraction and native-app
 * redirect live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/auth/native-callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleNativeCallback(request),
    },
  },
});
