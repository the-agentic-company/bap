import { createFileRoute } from "@tanstack/react-router";
import { handleCheckEmail } from "@/server/auth/handlers";

/**
 * `/api/auth/check-email`. Thin TanStack Start server route adapter; the
 * approval + credential-password lookup lives in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/auth/check-email")({
  server: {
    handlers: {
      POST: ({ request }) => handleCheckEmail(request),
    },
  },
});
