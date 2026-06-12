import { createFileRoute } from "@tanstack/react-router";
import { handleReport } from "@/server/report/handler";

/**
 * Bug report server route. Preserves the public `/api/report` URL and POST contract
 * (401 when unauthenticated, JSON or multipart body, Slack `bugs` channel forwarding with
 * optional attachment). Thin TanStack Start adapter; auth and Slack logic live in the
 * framework-neutral `handleReport` handler.
 */
export const Route = createFileRoute("/api/report")({
  server: {
    handlers: {
      POST: ({ request }) => handleReport(request),
    },
  },
});
