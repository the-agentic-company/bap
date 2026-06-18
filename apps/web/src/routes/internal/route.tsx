import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSupportAdmin } from "@/lib/route-guards";

/**
 * Internal shell layout (was src/app/admin/layout.tsx).
 *
 * Replaces the previous admin layout. Shell selection is route nesting: every internal page
 * renders inside this centered `<main>` wrapper via `<Outlet />`.
 *
 * Access is gated server-side in `beforeLoad` with the shared support-admin guard:
 * - unauthenticated requests redirect to `/login` (or worktree auto-login) with a
 *   `callbackUrl` back to the originally requested internal path,
 * - non-admins and the self-host edition (where support-admin does not exist) redirect to `/`.
 *
 * This moves the old client-side `useIsAdmin()` / `clientEditionCapabilities.hasSupportAdmin`
 * checks to the route boundary, so admin surfaces are never merely client-side protected.
 */
export const Route = createFileRoute("/internal")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSupportAdmin(location.href),
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { sessionContext } = Route.useRouteContext();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <div className="bg-background min-h-full">
        <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
          <Outlet />
        </main>
      </div>
    </AuthenticatedAppRootShell>
  );
}
