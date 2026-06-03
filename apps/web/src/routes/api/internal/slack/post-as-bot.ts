import { createFileRoute } from "@tanstack/react-router";
import { handleSlackPostAsBot } from "@/server/internal/slack-post-as-bot";

/** Thin server-route adapter for the internal Slack post-as-bot relay endpoint. */
export const Route = createFileRoute("/api/internal/slack/post-as-bot")({
  server: {
    handlers: {
      POST: ({ request }) => handleSlackPostAsBot(request),
    },
  },
});
