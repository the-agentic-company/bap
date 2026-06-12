import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSession } from "@/lib/route-guards";

/**
 * Protected template shell (layout route for the `/template/*` group).
 *
 * Replaces the previous `src/app/template/layout.tsx` wrapper. This is an access=protected
 * shell: the `beforeLoad` guard runs the shared protected-session check, so unauthenticated
 * requests redirect to `/login` (or worktree auto-login) with a `callbackUrl` that returns
 * the user to the originally requested `/template/*` path + search. The child routes
 * (`/template` redirect, `/template/$templateId` detail) render inside this layout via the
 * <Outlet />.
 *
 * Global providers (React Query, session-principal cache clearing) are owned by the
 * router/root scaffold, so this layout only owns the page-shell chrome.
 */
export const Route = createFileRoute("/template")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  component: TemplateLayout,
});

function TemplateLayout() {
  const { sessionContext } = Route.useRouteContext();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="bg-background min-h-screen">
        <main className="mx-auto w-full max-w-[1400px] px-8 pt-10 pb-16">
          <Outlet />
        </main>
      </div>
    </AuthenticatedAppRootShell>
  );
}
