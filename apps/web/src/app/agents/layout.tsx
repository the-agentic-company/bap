"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";

export default function CoworkersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const isRunsRoute = pathname?.startsWith("/agents/runs");
  const isGridRoute = pathname === "/agents/grid";
  const isDeployRoute = pathname?.startsWith("/agents/deploy/");
  const isOverviewRoute = pathname === "/agents/overview";
  const isHistoryRoute = pathname === "/agents/history";
  const isUsageRoute = pathname === "/agents/usage";
  const isOrgChartRoute = pathname === "/agents/org-chart";
  const isCoworkerEditorRoute =
    pathname?.startsWith("/agents/") &&
    pathname !== "/agents" &&
    !isDeployRoute &&
    !isRunsRoute &&
    !isGridRoute &&
    !isOverviewRoute &&
    !isHistoryRoute &&
    !isUsageRoute &&
    !isOrgChartRoute;

  useEffect(() => {
    const handleOpenDrawer = () => setRecentDrawerOpen(true);
    window.addEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
    return () => window.removeEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
  }, []);

  return (
    <>
      {isRunsRoute || isOrgChartRoute ? (
        children
      ) : isCoworkerEditorRoute ? (
        <div className="bg-background flex h-full min-h-0 w-full flex-1 overflow-hidden">
          {children}
        </div>
      ) : (
        <div className="bg-background min-h-screen">
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
            {children}
          </main>
        </div>
      )}

      <MobileRecentDrawer
        open={recentDrawerOpen}
        onOpenChange={setRecentDrawerOpen}
        mode="coworkers"
      />
    </>
  );
}
