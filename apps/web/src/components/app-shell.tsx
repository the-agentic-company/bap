"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomBar } from "@/components/mobile-bottom-bar";
import { SelfhostControlPlaneGate } from "@/components/selfhost-control-plane-gate";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const APP_SHELL_CONTENT_STYLE: React.CSSProperties = { transform: "translateZ(0)" };

export type SidebarVisibility = "always" | "authenticated" | "never";

type AppShellProps = {
  children: React.ReactNode;
  sidebarVisibility?: SidebarVisibility;
  initialHasSession?: boolean;
};

export function AppShell({
  children,
  sidebarVisibility = "always",
  initialHasSession = false,
}: AppShellProps) {
  const pathname = usePathname();
  const [showAuthenticatedSidebar, setShowAuthenticatedSidebar] = useState(initialHasSession);
  const isChatRoute =
    pathname === "/chat" || pathname?.startsWith("/chat/") || pathname?.startsWith("/agents/runs/");

  useEffect(() => {
    if (sidebarVisibility === "always") {
      setShowAuthenticatedSidebar(true);
      return;
    }

    if (sidebarVisibility !== "authenticated") {
      setShowAuthenticatedSidebar(false);
      return;
    }

    let mounted = true;

    authClient
      .getSession()
      .then((result) => {
        if (!mounted) {
          return;
        }

        setShowAuthenticatedSidebar(Boolean(result?.data?.session && result?.data?.user));
      })
      .catch(() => {
        if (mounted) {
          setShowAuthenticatedSidebar(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [sidebarVisibility]);

  const showNav =
    sidebarVisibility === "always" ||
    (sidebarVisibility === "authenticated" && showAuthenticatedSidebar);

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden">
      <SelfhostControlPlaneGate />
      {showNav ? <AppSidebar /> : null}
      <div
        className={cn(
          "app-shell-scroll-container relative h-full min-w-0 flex-1",
          isChatRoute ? "overflow-hidden" : "overflow-auto",
          !isChatRoute && showNav ? "pb-16 md:pb-0" : "pb-0",
        )}
        style={APP_SHELL_CONTENT_STYLE}
      >
        {children}
      </div>
      {showNav ? <MobileBottomBar /> : null}
    </div>
  );
}
