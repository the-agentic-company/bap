import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSession } from "@/lib/route-guards";

/**
 * Protected layout route for the `/integrations/**` shell.
 *
 * Replaces the previous `integrations/layout.tsx`. Shell selection is route nesting: the
 * generic detail page and the specific Reddit / Twitter / WhatsApp pages all render inside
 * this centered container via `<Outlet />`, rather than a global pathname switch.
 *
 * Access is protected: `beforeLoad` runs the shared session guard, redirecting
 * unauthenticated users to `/login` (or worktree auto-login) with a `callbackUrl` that
 * returns them to the originally requested integrations path after sign-in.
 */
export const Route = createFileRoute("/integrations")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  component: IntegrationsLayout,
});

function IntegrationsLayout() {
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
