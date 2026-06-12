import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSession } from "@/lib/route-guards";

/**
 * Protected app shell (pathless layout).
 *
 * This is the "app-shell" boundary for the main authenticated product experience
 * (chat conversations + inbox). It replaces the previous behavior where
 * `AppRootShell` / `AppShellRouteWrapper` rendered the sidebar chrome for these
 * routes and the global proxy enforced the session.
 *
 * - `beforeLoad` runs the shared protected-session guard: unauthenticated requests
 *   redirect to `/login` (or worktree auto-login) with a `callbackUrl` that returns
 *   the user to the originally requested path + search.
 * - The root `AppRootShell` renders the app sidebar around matching routes.
 *
 * Global providers (React Query, session-principal cache clearing) are owned by the
 * router/root scaffold, so this layout only owns the protected app chrome.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  component: AppLayout,
});

function AppLayout() {
  const { sessionContext } = Route.useRouteContext();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <Outlet />
    </AuthenticatedAppRootShell>
  );
}
