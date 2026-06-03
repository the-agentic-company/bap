import { createFileRoute } from "@tanstack/react-router";
import {
  handleHostedMcpTokenOptions,
  handleHostedMcpTokenPost,
} from "./-handlers/token";

/**
 * Server route for `/api/mcp/oauth/token`. Thin adapter over the
 * framework-neutral token handlers, including the CORS preflight (OPTIONS).
 */
export const Route = createFileRoute("/api/mcp/oauth/token")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => handleHostedMcpTokenOptions(request),
      POST: ({ request }) => handleHostedMcpTokenPost(request),
    },
  },
});
