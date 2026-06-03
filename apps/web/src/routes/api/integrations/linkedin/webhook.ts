import { createFileRoute } from "@tanstack/react-router";
import { handleLinkedInWebhook } from "../-handlers/linkedin-webhook";

/**
 * Server route for `/api/integrations/linkedin/webhook`. Thin adapter over the
 * framework-neutral `handleLinkedInWebhook` Unipile AccountStatus handler.
 */
export const Route = createFileRoute("/api/integrations/linkedin/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleLinkedInWebhook(request),
    },
  },
});
