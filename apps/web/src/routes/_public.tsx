import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppRootShell } from "@/components/app-root-shell";
import { fetchSessionContext } from "@/lib/route-guards";

/**
 * Pathless layout route for public pages (access = public, no auth).
 *
 * Shell selection is route nesting, not a global pathname switch: every page under
 * `_public/*` renders inside this layout while keeping its exact public URL (the
 * `_public` segment is pathless, so `/pricing`, `/avatar`, etc. are unchanged).
 *
 * Authenticated visitors keep the sidebar chrome on public product-facing pages such as
 * `/` and `/templates`; anonymous visitors get the bare public pages.
 */
export const Route = createFileRoute("/_public")({
  loader: async () => {
    const context = await fetchSessionContext();
    return {
      hasSession: Boolean(context.principal),
      principal: context.principal,
    };
  },
  component: PublicLayout,
});

function PublicLayout() {
  const { hasSession, principal } = Route.useLoaderData();

  if (!hasSession) {
    return <Outlet />;
  }

  return (
    <AppRootShell hasSession initialPrincipal={principal}>
      <Outlet />
    </AppRootShell>
  );
}
