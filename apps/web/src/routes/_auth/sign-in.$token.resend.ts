import { createFileRoute } from "@tanstack/react-router";
import { handleMagicLinkResend } from "@/server/auth/handlers";

/**
 * POST `/sign-in/:token/resend`. Requests a replacement magic link for a stored
 * expired or consumed sign-in request.
 */
export const Route = createFileRoute("/_auth/sign-in/$token/resend")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleMagicLinkResend(request, params.token),
    },
  },
});
