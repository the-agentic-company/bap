import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";
import { requireSession } from "@/lib/route-guards";
import { isPendingAgentsPathChange } from "./-lib/agents-layout-state";

/**
 * Agents shell layout (was src/app/agents/layout.tsx).
 *
 * Protected access lives in `beforeLoad`: an unauthenticated request is redirected to
 * /login (or worktree auto-login) with a callbackUrl back to the originally requested path.
 *
 * The shell still selects its outer chrome from the current pathname, but that is now a
 * presentational concern reading TanStack Router location rather than a global pathname switch.
 */
export const Route = createFileRoute("/agents")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  component: AgentsLayout,
});

function AgentsRoutePending({ className = "min-h-[320px]" }: { className?: string }) {
  return (
    <div
      className={`text-muted-foreground flex items-center justify-center gap-2 text-sm ${className}`}
      aria-label="Loading"
    >
      <Loader2 className="text-muted-foreground size-5 animate-spin" />
      <span>Loading</span>
    </div>
  );
}

function AgentsLayout() {
  const { sessionContext } = Route.useRouteContext();
  const { pathname, resolvedPathname, status } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      resolvedPathname: state.resolvedLocation?.pathname,
      status: state.status,
    }),
  });
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const isRoutePathPending = status === "pending" && resolvedPathname !== pathname;
  const lastStablePathnameRef = useRef(resolvedPathname ?? pathname);
  const visualPathname = isRoutePathPending
    ? (resolvedPathname ?? lastStablePathnameRef.current)
    : pathname;
  const isRunsRoute = visualPathname.startsWith("/agents/runs");
  const isCoworkerEditorRoute = visualPathname.startsWith("/agents/edit/");
  const isCoworkerInfoRoute = visualPathname.startsWith("/agents/info/");
  const [hasHydrated, setHasHydrated] = useState(false);
  const isPendingNewPath =
    hasHydrated && isPendingAgentsPathChange({ pathname, resolvedPathname, status });
  const [settlingEditPathname, setSettlingEditPathname] = useState<string | null>(null);
  const isSettlingEditRoute = settlingEditPathname === pathname;

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    const handleOpenDrawer = () => setRecentDrawerOpen(true);
    window.addEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
    return () => window.removeEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
  }, []);

  useEffect(() => {
    if (!isRoutePathPending) {
      lastStablePathnameRef.current = pathname;
    }
  }, [isRoutePathPending, pathname]);

  useLayoutEffect(() => {
    if (!pathname.startsWith("/agents/edit/")) {
      setSettlingEditPathname(null);
      return;
    }

    setSettlingEditPathname(pathname);
    const timeout = window.setTimeout(() => setSettlingEditPathname(null), 180);
    return () => window.clearTimeout(timeout);
  }, [pathname]);

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      {isRunsRoute || isCoworkerInfoRoute ? (
        isPendingNewPath ? (
          <AgentsRoutePending className="h-full min-h-screen" />
        ) : (
          <Outlet />
        )
      ) : isCoworkerEditorRoute ? (
        <div className="bg-background flex h-full min-h-0 w-full flex-1 overflow-hidden">
          {isPendingNewPath || isSettlingEditRoute ? (
            <AgentsRoutePending className="h-full min-h-screen flex-1" />
          ) : (
            <Outlet />
          )}
        </div>
      ) : (
        <div className="bg-background min-h-screen">
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
            {isPendingNewPath ? <AgentsRoutePending /> : <Outlet />}
          </main>
        </div>
      )}

      <MobileRecentDrawer
        open={recentDrawerOpen}
        onOpenChange={setRecentDrawerOpen}
        mode="coworkers"
      />
    </AuthenticatedAppRootShell>
  );
}
