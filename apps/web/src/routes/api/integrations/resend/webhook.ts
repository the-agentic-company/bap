import { createFileRoute } from "@tanstack/react-router";
import { handleResendWebhook } from "../-handlers/resend-webhook";

/**
 * Server route for `/api/integrations/resend/webhook`. Thin adapter over the
 * framework-neutral `handleResendWebhook` handler, which reads the raw body for
 * Svix signature verification.
 */
export const Route = createFileRoute("/api/integrations/resend/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleResendWebhook(request),
    },
  },
});
