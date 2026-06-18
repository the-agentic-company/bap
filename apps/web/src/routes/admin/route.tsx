import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { requireSupportAdmin } from "@/lib/route-guards";

export const Route = createFileRoute("/admin")({
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
