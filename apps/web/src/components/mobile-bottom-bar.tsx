import { useNavigate, useRouterState } from "@tanstack/react-router";
import { T, msg, useMessages } from "gt-react";
import { LayoutTemplate, Menu, MessageSquare, WandSparkles, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AppLink } from "@/components/app-link";
import { BrickIcon } from "@/components/icons/brick-icon";
import { MobileMenuPanel } from "@/components/mobile-menu-sheet";
import { openNewChat } from "@/lib/open-new-chat";
import { cn } from "@/lib/utils";

type BottomTab = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
};

const tabs: BottomTab[] = [
  { icon: MessageSquare, label: msg("Chat"), href: "/chat" },
  { icon: WandSparkles, label: msg("Create"), href: "/" },
  { icon: BrickIcon, label: msg("Agents"), href: "/agents" },
  { icon: LayoutTemplate, label: msg("Templates"), href: "/templates" },
];

const mobileBottomNavStyle = {
  paddingBottom: "var(--safe-area-inset-bottom)",
};

export function MobileBottomBar() {
  const m = useMessages();
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const infoTab = searchParams.get("tab");
  const isFlatBottomBar = pathname.startsWith("/agents/info/") && (!infoTab || infoTab === "app");

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
      openNewChat(navigate);
    },
    [closeMenu, navigate],
  );

  return (
    <>
      {/* Menu panel - positioned above the bottom bar */}
      <MobileMenuPanel open={menuOpen} onOpenChange={setMenuOpen} />

      <div
        className={cn(
          "border-border bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-sm md:hidden",
          !isFlatBottomBar && "rounded-t-2xl",
        )}
      >
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
            <span>
              <T>Menu</T>
            </span>
          </button>

          {/* Nav tabs */}
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <AppLink
                key={tab.href}
                href={tab.href}
                onClick={handleTabClick(tab.href)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 pt-3 pb-2 text-[11px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <tab.icon className="h-6 w-6" />
                <span>{m(tab.label)}</span>
              </AppLink>
            );
          })}
        </nav>
      </div>
    </>
  );
}
