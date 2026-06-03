import { createFileRoute } from "@tanstack/react-router";
import {
  handleHostedMcpAuthorizeGet,
  handleHostedMcpAuthorizePost,
} from "./-handlers/authorize";

/**
 * Server route for `/api/mcp/oauth/authorize`. Thin adapter over the
 * framework-neutral authorize handlers; the Better Auth session check and
 * consent logic stay inside the handler module.
 */
export const Route = createFileRoute("/api/mcp/oauth/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => handleHostedMcpAuthorizeGet(request),
      POST: ({ request }) => handleHostedMcpAuthorizePost(request),
    },
  },
});
