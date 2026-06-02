"use client";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bug,
  Building2,
  CircleDollarSign,
  Container,
  CreditCard,
  Gauge,
  Inbox,
  LayoutTemplate,
  LogOut,
  MessageSquare,
  Settings,
  Shield,
  Toolbox,
  User,
  UserCog,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BugReportDialog } from "@/components/bug-report-dialog";
import { BrickIcon } from "@/components/icons/brick-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { clientEditionCapabilities } from "@/lib/edition";
import { openNewChat } from "@/lib/open-new-chat";
import { cn } from "@/lib/utils";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];
type SidebarMode = "user" | "admin";
const SIDEBAR_MODE_STORAGE_KEY = "cmdclaw.sidebarMode";

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

function McpLogoIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative block", className)}>
      <Image
        src="/integrations/mcp.svg"
        alt=""
        fill
        sizes="18px"
        className="object-contain dark:invert"
      />
    </span>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          prefetch={false}
          onClick={item.onClick}
          aria-label={item.label}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/65 transition-colors",
            "focus-visible:ring-sidebar-ring/45 focus-visible:ring-3 focus-visible:outline-none",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/65 transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "focus-visible:ring-sidebar-ring/45 focus-visible:ring-3 focus-visible:outline-none",
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-1.5">{children}</div>;
}

function NavDivider() {
  return <div className="bg-sidebar-border my-1 h-px w-8" />;
}

function SidebarModeToggle({
  mode,
  onModeChange,
}: {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
}) {
  return (
    <div
      className="border-sidebar-border bg-sidebar-accent/55 flex flex-col gap-1 rounded-xl border p-1"
      role="group"
      aria-label="Sidebar view"
    >
      <SidebarModeToggleButton
        currentMode={mode}
        icon={User}
        label="User view"
        mode="user"
        onModeChange={onModeChange}
      />
      <SidebarModeToggleButton
        currentMode={mode}
        icon={Shield}
        label="Admin view"
        mode="admin"
        onModeChange={onModeChange}
      />
    </div>
  );
}

function SidebarModeToggleButton({
  currentMode,
  icon: Icon,
  label,
  mode,
  onModeChange,
}: {
  currentMode: SidebarMode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
}) {
  const active = currentMode === mode;
  const handleClick = useCallback(() => {
    onModeChange(mode);
  }, [mode, onModeChange]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            "focus-visible:ring-sidebar-ring/45 focus-visible:ring-3 focus-visible:outline-none",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("admin");
  const [reportOpen, setReportOpen] = useState(false);
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);

  useEffect(() => {
    let mounted = true;
    authClient
      .getSession()
      .then((res) => {
        if (!mounted) {
          return;
        }
        const hasSession = res?.data?.session && res?.data?.user;
        setSession(hasSession ? res.data : null);
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      const savedMode = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
      if (savedMode === "user" || savedMode === "admin") {
        setSidebarMode(savedMode);
      }
    } catch {
      setSidebarMode("admin");
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      router.push("/login");
    }
  }, [router]);

  const handleStopImpersonating = useCallback(async () => {
    setStoppingImpersonation(true);
    try {
      const result = await authClient.admin.stopImpersonating();
      if (!result.error) {
        window.location.assign("/admin");
      }
    } finally {
      setStoppingImpersonation(false);
    }
  }, []);

  const enterAdminMode = useCallback(() => {
    setSidebarMode("admin");
    try {
      window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, "admin");
    } catch {
      // Ignore storage failures; the in-memory view mode still updates.
    }
  }, []);

  const openAdminRoute = useCallback(() => {
    router.push("/admin");
  }, [router]);

  const enterUserMode = useCallback(() => {
    setSidebarMode("user");
    try {
      window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, "user");
    } catch {
      // Ignore storage failures; the in-memory view mode still updates.
    }
    router.push("/inbox");
  }, [router]);

  const handleSidebarModeChange = useCallback(
    (mode: SidebarMode) => {
      if (mode === "admin") {
        enterAdminMode();
        return;
      }

      enterUserMode();
    },
    [enterAdminMode, enterUserMode],
  );

  const openReportDialog = useCallback(() => {
    setReportOpen(true);
  }, []);

  const handleChatNavClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openNewChat(router);
    },
    [router],
  );

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    if (href === "/chat") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const userEmail = session?.user?.email ?? "";
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";
  const isAdmin = session?.user?.role === "admin";
  const isAdminRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/instance");
  const activeSidebarMode: SidebarMode = !isAdmin || isAdminRoute ? "admin" : sidebarMode;
  const impersonatedBy = (
    session as (SessionData & { session?: { impersonatedBy?: string | null } }) | null
  )?.session?.impersonatedBy;
  const isImpersonating = Boolean(impersonatedBy);

  const mainNavItems: NavItem[] = [
    { icon: WandSparkles, label: "Create", href: "/" },
    { icon: LayoutTemplate, label: "Templates", href: "/templates" },
  ];

  const appNavItems: NavItem[] = [
    ...(isAdmin ? [{ icon: Inbox, label: "Inbox", href: "/inbox" }] : []),
    { icon: MessageSquare, label: "Chat", href: "/chat", onClick: handleChatNavClick },
    { icon: BrickIcon, label: "Agents", href: "/agents" },
    { icon: Toolbox, label: "Toolbox", href: "/toolbox" },
  ];

  const userNavItems: NavItem[] = isAdmin
    ? [
        { icon: Inbox, label: "Inbox", href: "/inbox" },
        { icon: BrickIcon, label: "Agents", href: "/agents" },
      ]
    : [];

  const adminUsersItems: NavItem[] = [
    { icon: UserCog, label: "User", href: "/admin" },
    { icon: Building2, label: "Workspaces", href: "/admin/workspaces" },
  ];

  const adminConfigItems: NavItem[] = [
    { icon: LayoutTemplate, label: "Templates", href: "/admin/templates" },
    { icon: CreditCard, label: "AI Subscriptions", href: "/admin/subscriptions" },
    { icon: McpLogoIcon, label: "MCP", href: "/admin/mcp" },
  ];

  const adminBillingItems: NavItem[] = [
    { icon: CircleDollarSign, label: "Credits", href: "/admin/credits" },
    { icon: BarChart3, label: "Usage", href: "/admin/usage" },
  ];

  const adminMonitoringItems: NavItem[] = [
    { icon: Activity, label: "Chat Health", href: "/admin/chat-overview" },
    { icon: BrickIcon, label: "Coworker Overview", href: "/admin/coworker-overview" },
    { icon: Gauge, label: "Performance", href: "/admin/performance" },
    { icon: Container, label: "Sandboxes", href: "/admin/sandboxes" },
    { icon: Bug, label: "Ops", href: "/admin/ops" },
  ];

  const adminInstanceItems: NavItem[] = clientEditionCapabilities.hasInstanceAdmin
    ? [{ icon: Shield, label: "Instance", href: "/instance" }]
    : [];

  return (
    <>
      <BugReportDialog open={reportOpen} onOpenChange={setReportOpen} />

      <aside className="bg-sidebar hidden h-screen w-16 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/"
                prefetch={false}
                aria-label="CmdClaw home"
                className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring/45 flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:ring-3 focus-visible:outline-none"
              >
                <Image src="/logo.png" alt="" width={24} height={24} className="object-contain" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              CmdClaw
            </TooltipContent>
          </Tooltip>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-2 pb-4">
          {activeSidebarMode === "user" ? (
            <>
              <NavGroup>
                {userNavItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
            </>
          ) : !isAdminRoute ? (
            <>
              <NavGroup>
                {mainNavItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                {appNavItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                <NavButton icon={Bug} label="Bug report" onClick={openReportDialog} />
                {isAdmin ? (
                  <NavButton icon={Shield} label="Admin" onClick={openAdminRoute} />
                ) : null}
              </NavGroup>
            </>
          ) : clientEditionCapabilities.hasSupportAdmin ? (
            <>
              <NavGroup>
                {adminUsersItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                {adminConfigItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                {adminBillingItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                {adminMonitoringItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                <NavButton icon={ArrowLeft} label="Exit Admin" onClick={enterUserMode} />
              </NavGroup>
            </>
          ) : (
            <>
              {adminInstanceItems.length > 0 ? (
                <NavGroup>
                  {adminInstanceItems.map((item) => (
                    <NavLink key={item.href} item={item} active={isActive(item.href)} />
                  ))}
                </NavGroup>
              ) : null}
              <NavDivider />
              <NavGroup>
                <NavButton icon={ArrowLeft} label="Exit Admin" onClick={enterUserMode} />
              </NavGroup>
            </>
          )}
        </nav>

        <div className="flex flex-col items-center gap-2 px-2 pb-3">
          {isAdmin ? (
            <SidebarModeToggle mode={activeSidebarMode} onModeChange={handleSidebarModeChange} />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="border-sidebar-border bg-sidebar-accent/80 hover:bg-sidebar-accent focus-visible:ring-sidebar-ring/45 flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border text-[13px] transition-colors focus-visible:ring-3 focus-visible:outline-none"
                title={userEmail || "Account"}
              >
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={40}
                    height={40}
                    className="h-full w-full shrink-0 rounded-[inherit] object-cover"
                  />
                ) : (
                  <span className="bg-sidebar-primary text-sidebar-primary-foreground flex h-full w-full shrink-0 items-center justify-center rounded-[inherit] text-base font-semibold">
                    {avatarInitial}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="min-w-48">
              {userEmail && (
                <>
                  <DropdownMenuLabel className="font-normal">
                    <span className="text-muted-foreground text-xs">{userEmail}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/settings" prefetch={false} className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              {clientEditionCapabilities.hasBilling ? (
                <DropdownMenuItem asChild>
                  <Link href="/settings/usage" prefetch={false} className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>Usage</span>
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {clientEditionCapabilities.hasSupportAdmin && isImpersonating ? (
                <DropdownMenuItem
                  onClick={handleStopImpersonating}
                  disabled={stoppingImpersonation}
                >
                  <Shield className="h-4 w-4" />
                  <span>
                    {stoppingImpersonation ? "Stopping impersonation..." : "Stop impersonating"}
                  </span>
                </DropdownMenuItem>
              ) : null}
              {session?.user ? (
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild>
                  <Link href="/login" prefetch={false} className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    <span>Log in</span>
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
