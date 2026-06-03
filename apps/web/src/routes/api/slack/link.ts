import { createFileRoute } from "@tanstack/react-router";
import { handleSlackLink } from "./-handlers/link";

/**
 * Server route for `/api/slack/link`. Thin adapter over the framework-neutral
 * `handleSlackLink` handler, which performs the Better Auth session check and
 * links a Slack user/team to a CmdClaw account.
 */
export const Route = createFileRoute("/api/slack/link")({
  server: {
    handlers: {
      GET: ({ request }) => handleSlackLink(request),
    },
  },
});
