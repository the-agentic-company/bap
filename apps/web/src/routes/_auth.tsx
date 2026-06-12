import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Pathless layout route for the public authentication flow: login, password reset,
 * token-based magic-link sign-in, and invite-only access request.
 *
 * Each auth page previously rendered its own full-screen wrapper, so this shell stays
 * intentionally thin and only groups the routes
 * via nesting. Shell selection is route nesting, not a global pathname switch. The pages
 * keep their own page-level layout wrappers so the rendered markup is unchanged.
 *
 * Access is public — no `beforeLoad` guard here. Individual pages own the server-side
 * session redirect (already-authenticated users get bounced to their callback) so the
 * redirect logic stays colocated with each page's other server work.
 */
export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return <Outlet />;
}
