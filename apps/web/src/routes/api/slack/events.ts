import { createFileRoute } from "@tanstack/react-router";
import { handleSlackEvents } from "./-handlers/events";

/**
 * Server route for `/api/slack/events`. Thin adapter over the framework-neutral
 * `handleSlackEvents` handler, which reads the raw body for Slack HMAC signature
 * verification.
 */
export const Route = createFileRoute("/api/slack/events")({
  server: {
    handlers: {
      POST: ({ request }) => handleSlackEvents(request),
    },
  },
});
