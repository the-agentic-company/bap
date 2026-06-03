import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthCallback } from "./-handlers/callback";

/**
 * `/api/oauth/callback`. Frozen provider OAuth callback URL: provider dashboards
 * point at this exact path, so the public URL contract must not change. Thin
 * TanStack Start server route adapter; token exchange, the Better Auth session
 * check, state ownership verification, and token storage all live in the
 * framework-neutral handler.
 */
export const Route = createFileRoute("/api/oauth/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthCallback(request),
    },
  },
});
