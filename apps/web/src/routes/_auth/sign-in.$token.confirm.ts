import { createFileRoute } from "@tanstack/react-router";
import { handleMagicLinkConfirm } from "@/server/auth/handlers";

/**
 * POST `/sign-in/:token/confirm`. The email link lands on `/sign-in/:token`;
 * this route handles the confirmation form without exposing Better Auth's raw
 * verification URL in the email.
 */
export const Route = createFileRoute("/_auth/sign-in/$token/confirm")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleMagicLinkConfirm(request, params.token),
    },
  },
});
