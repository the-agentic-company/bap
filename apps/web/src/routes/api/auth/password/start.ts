import { createFileRoute } from "@tanstack/react-router";
import { handlePasswordStart } from "@/server/auth/handlers";

/**
 * `/api/auth/password/start`. Begins the invite-only password-reset onboarding
 * flow. Thin TanStack Start server route adapter; approval gating, user
 * resolution, and the reset-email request live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/auth/password/start")({
  server: {
    handlers: {
      POST: ({ request }) => handlePasswordStart(request),
    },
  },
});
