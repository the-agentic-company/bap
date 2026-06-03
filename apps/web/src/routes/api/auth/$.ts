import { createFileRoute } from "@tanstack/react-router";
import { handleBetterAuth, handleBetterAuthOptions } from "@/server/auth/handlers";

/**
 * Better Auth catch-all (`/api/auth/**`). Hard public-URL contract: every Better
 * Auth sub-path (sign-in, callbacks, device auth, magic-link confirm/resend,
 * email verification, password reset) keeps its exact URL. Thin TanStack Start
 * server route adapter; CORS, the invite-only social-callback redirect, and the
 * `auth.handler` delegation live in the framework-neutral handler module.
 *
 * More specific sibling routes (`check-email`, `password/start`,
 * `native-callback`, `provider/$provider/callback`) take precedence over this
 * splat; everything else under `/api/auth` is owned by Better Auth.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleBetterAuth(request),
      POST: ({ request }) => handleBetterAuth(request),
      PUT: ({ request }) => handleBetterAuth(request),
      PATCH: ({ request }) => handleBetterAuth(request),
      DELETE: ({ request }) => handleBetterAuth(request),
      OPTIONS: ({ request }) => handleBetterAuthOptions(request),
    },
  },
});
