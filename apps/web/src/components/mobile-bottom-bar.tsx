"use client";

import { Cuboid, LayoutTemplate, Menu, MessageSquare, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { MobileMenuPanel } from "@/components/mobile-menu-sheet";
import { openNewChat } from "@/lib/open-new-chat";
import { cn } from "@/lib/utils";

type BottomTab = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
};

const tabs: BottomTab[] = [
  { icon: MessageSquare, label: "Chat", href: "/chat" },
  { icon: WandSparkles, label: "Create", href: "/" },
  { icon: Cuboid, label: "Agents", href: "/agents" },
  { icon: LayoutTemplate, label: "Templates", href: "/templates" },
];

const mobileBottomNavStyle = {
  paddingBottom: "var(--safe-area-inset-bottom)",
};

export function MobileBottomBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = useCallback(
    (href: string) => {
      if (href === "/") {
        return pathname === "/";
      }
      if (href === "/chat") {
        return pathname === "/chat" || pathname.startsWith("/chat/");
      }
      return pathname === href || pathname.startsWith(href + "/");
    },
    [pathname],
  );

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const handleTabClick = useCallback(
    (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
      closeMenu();
      if (href !== "/chat") {
        return;
      }
      event.preventDefault();
      openNewChat(router);
    },
    [closeMenu, router],
  );

  return (
    <>
      {/* Menu panel - positioned above the bottom bar */}
      <MobileMenuPanel open={menuOpen} onOpenChange={setMenuOpen} />

      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t backdrop-blur-sm md:hidden">
        <nav className="flex items-stretch justify-around" style={mobileBottomNavStyle}>
          {/* Menu button */}
          <button
            type="button"
            onClick={toggleMenu}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 pt-3 pb-2 text-[11px] font-medium transition-colors",
              menuOpen ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            <span>Menu</span>
          </button>

          {/* Nav tabs */}
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={false}
                onClick={handleTabClick(tab.href)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 pt-3 pb-2 text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <tab.icon className="h-6 w-6" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
