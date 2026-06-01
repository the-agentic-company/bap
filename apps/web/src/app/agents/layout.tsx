"use client";

import { useEffect, useState } from "react";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";

export default function CoworkersLayout({ children }: { children: React.ReactNode }) {
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);

  useEffect(() => {
    const handleOpenDrawer = () => setRecentDrawerOpen(true);
    window.addEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
    return () => window.removeEventListener(COWORKERS_OPEN_RECENT_DRAWER_EVENT, handleOpenDrawer);
  }, []);

  return (
    <>
      <div className="bg-background min-h-screen">{children}</div>

      <MobileRecentDrawer
        open={recentDrawerOpen}
        onOpenChange={setRecentDrawerOpen}
        mode="coworkers"
      />
    </>
  );
}
