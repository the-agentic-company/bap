// oxlint-disable jsx-a11y/prefer-tag-over-role

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bug,
  Building2,
  Check,
  CircleDollarSign,
  Container,
  CreditCard,
  Gauge,
  Inbox,
  LayoutTemplate,
  LogOut,
  MessageSquare,
  ScrollText,
  Settings,
  Shield,
  Toolbox,
  User,
  UserCog,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SessionPrincipal } from "@/lib/route-guards";
import { AppImage } from "@/components/app-image";
import { AppLink } from "@/components/app-link";
import { BugReportDialog } from "@/components/bug-report-dialog";
import { BrickIcon } from "@/components/icons/brick-icon";
import { WorkspaceAvatar } from "@/components/workspace-avatar";
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
import { useBillingOverview, useSwitchWorkspace } from "@/orpc/hooks/billing";
import { toast } from "sonner";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];
type SidebarMode = "user" | "admin";
const SIDEBAR_MODE_STORAGE_KEY = "bap.sidebarMode";

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

const MCP_LOGO_MASK_STYLE = {
  mask: "url('/integrations/mcp.svg') center / contain no-repeat",
  WebkitMask: "url('/integrations/mcp.svg') center / contain no-repeat",
} as const;

function readStoredSidebarMode(): SidebarMode {
  if (typeof window === "undefined") {
    return "admin";
  }

  try {
    const savedMode = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
    return savedMode === "user" || savedMode === "admin" ? savedMode : "admin";
  } catch {
    return "admin";
  }
}

function McpLogoIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block bg-current", className)}
      style={MCP_LOGO_MASK_STYLE}
    />
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AppLink
          href={item.href}
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
        </AppLink>
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
  const t = useGT();

  return (
    <div
      className="border-sidebar-border bg-sidebar-accent/55 flex flex-col gap-1 rounded-xl border p-1"
      role="group"
      aria-label={t("Sidebar view")}
    >
      <SidebarModeToggleButton
        currentMode={mode}
        icon={User}
        label={t("User view")}
        mode="user"
        onModeChange={onModeChange}
      />
      <SidebarModeToggleButton
        currentMode={mode}
        icon={Shield}
        label={t("Internal view")}
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

type SidebarWorkspace = {
  id: string;
  name: string;
  imageUrl?: string | null;
  active?: boolean;
};

const EMPTY_SIDEBAR_WORKSPACES: SidebarWorkspace[] = [];

function WorkspaceSwitcherItem({
  active,
  isPending,
  onSwitchWorkspace,
  workspace,
}: {
  active: boolean;
  isPending: boolean;
  onSwitchWorkspace: (workspaceId: string) => void;
  workspace: SidebarWorkspace;
}) {
  const handleClick = useCallback(() => {
    onSwitchWorkspace(workspace.id);
  }, [onSwitchWorkspace, workspace.id]);

  return (
    <DropdownMenuItem disabled={active || isPending} onClick={handleClick} className="gap-2">
      <WorkspaceAvatar
        name={workspace.name}
        imageUrl={workspace.imageUrl}
        className="h-7 w-7 rounded-md text-xs"
      />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      {active ? <Check className="h-4 w-4" /> : null}
    </DropdownMenuItem>
  );
}

function WorkspaceSwitcher({
  activeWorkspace,
  isPending,
  onSwitchWorkspace,
  workspaces,
}: {
  activeWorkspace: SidebarWorkspace | null;
  isPending: boolean;
  onSwitchWorkspace: (workspaceId: string) => void;
  workspaces: SidebarWorkspace[];
}) {
  const t = useGT();
  const workspaceName = activeWorkspace?.name ?? t("Workspace");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("Switch workspace")}
          className={cn(
            "group focus-visible:ring-sidebar-ring/45 flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground",
            "focus-visible:ring-3 focus-visible:outline-none",
          )}
          title={workspaceName}
        >
          <span className="border-sidebar-border bg-sidebar-accent/80 group-hover:bg-sidebar-accent flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border text-[13px] transition-colors">
            <WorkspaceAvatar
              name={workspaceName}
              imageUrl={activeWorkspace?.imageUrl}
              className="bg-sidebar-primary text-sidebar-primary-foreground h-full w-full rounded-[inherit] text-base"
              loading="eager"
              decoding="sync"
            />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="text-muted-foreground text-xs">
            <T>Workspace</T>
          </span>
        </DropdownMenuLabel>
        {workspaces.length > 0 ? (
          workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspace?.id;
            return (
              <WorkspaceSwitcherItem
                key={workspace.id}
                active={active}
                isPending={isPending}
                onSwitchWorkspace={onSwitchWorkspace}
                workspace={workspace}
              />
            );
          })
        ) : (
          <DropdownMenuItem disabled>
            <T>No workspaces found</T>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <AppLink href="/settings/workspace" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <span>
              <T>Workspace settings</T>
            </span>
          </AppLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AppSidebarProps = {
  initialPrincipal?: SessionPrincipal | null;
};

export function AppSidebar({ initialPrincipal = null }: AppSidebarProps) {
  const t = useGT();

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionData | undefined>(undefined);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(readStoredSidebarMode);
  const [reportOpen, setReportOpen] = useState(false);
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);
  const effectiveUser = session?.user ?? null;
  const initialPrincipalActive = session === undefined && initialPrincipal;
  const hasWorkspaceSession = Boolean(effectiveUser || initialPrincipalActive);
  const billingOverview = useBillingOverview(hasWorkspaceSession);
  const switchWorkspace = useSwitchWorkspace();

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
    const handleUserImageUpdated = (event: Event) => {
      const image = (event as CustomEvent<{ image: string | null }>).detail?.image ?? null;
      setSession((current: SessionData | null | undefined) =>
        current
          ? {
              ...current,
              user: {
                ...current.user,
                image,
              },
            }
          : current,
      );
    };

    window.addEventListener("bap:user-image-updated", handleUserImageUpdated);
    return () => {
      window.removeEventListener("bap:user-image-updated", handleUserImageUpdated);
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      void navigate({ to: "/login" });
    }
  }, [navigate]);

  const handleStopImpersonating = useCallback(async () => {
    setStoppingImpersonation(true);
    try {
      const result = await authClient.admin.stopImpersonating();
      if (!result.error) {
        window.location.assign("/internal");
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
    void navigate({ to: "/admin" });
  }, [navigate]);

  const enterUserMode = useCallback(() => {
    setSidebarMode("user");
    try {
      window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, "user");
    } catch {
      // Ignore storage failures; the in-memory view mode still updates.
    }
    void navigate({ to: "/inbox" });
  }, [navigate]);

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
      openNewChat(navigate);
    },
    [navigate],
  );

  const handleSwitchWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await switchWorkspace.mutateAsync(workspaceId);
        void navigate({ to: pathname || "/", search: location.search, hash: location.hash });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to switch workspace.");
      }
    },
    [navigate, pathname, switchWorkspace],
  );

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    if (href === "/internal") {
      return pathname === "/internal" || pathname === "/internal/";
    }
    if (href === "/admin") {
      return pathname === "/admin" || pathname === "/admin/";
    }
    if (href === "/chat") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  const userEmail = effectiveUser?.email ?? (initialPrincipalActive ? initialPrincipal.email : "");
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";
  const userRole =
    (effectiveUser as { role?: string | null } | null)?.role ??
    (initialPrincipalActive ? initialPrincipal.role : null);
  const avatarImage =
    effectiveUser?.image ?? (initialPrincipalActive ? initialPrincipal.image : null);
  const isAdmin = userRole === "admin";
  const isProductAdminRoute = pathname?.startsWith("/admin");
  const isAdminRoute =
    isProductAdminRoute || pathname?.startsWith("/internal") || pathname?.startsWith("/instance");
  const activeSidebarMode: SidebarMode = !isAdmin || isAdminRoute ? "admin" : sidebarMode;
  const impersonatedBy = (
    session as (SessionData & { session?: { impersonatedBy?: string | null } }) | null
  )?.session?.impersonatedBy;
  const isImpersonating = Boolean(impersonatedBy);
  const workspaces = billingOverview.data?.workspaces ?? EMPTY_SIDEBAR_WORKSPACES;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.active) ??
    workspaces.find((workspace) => workspace.id === billingOverview.data?.owner.ownerId) ??
    null;

  const mainNavItems: NavItem[] = [
    { icon: WandSparkles, label: t("Create"), href: "/" },
    { icon: LayoutTemplate, label: t("Templates"), href: "/templates" },
  ];

  const appNavItems: NavItem[] = [
    ...(isAdmin ? [{ icon: Inbox, label: t("Inbox"), href: "/inbox" }] : []),
    { icon: MessageSquare, label: t("Chat"), href: "/chat", onClick: handleChatNavClick },
    { icon: BrickIcon, label: t("Agents"), href: "/agents" },
    { icon: Toolbox, label: t("Toolbox"), href: "/toolbox" },
  ];

  const userNavItems: NavItem[] = isAdmin
    ? [
        { icon: Inbox, label: t("Inbox"), href: "/inbox" },
        { icon: BrickIcon, label: t("Agents"), href: "/agents" },
      ]
    : [];

  const adminUsersItems: NavItem[] = [
    { icon: UserCog, label: "User", href: "/internal" },
    { icon: Building2, label: "Workspaces", href: "/internal/workspaces" },
  ];

  const productAdminItems: NavItem[] = [
    { icon: UserCog, label: "User Management", href: "/admin" },
    { icon: Activity, label: "Overview", href: "/admin/overview" },
    { icon: ScrollText, label: "Audit", href: "/admin/audit-trail" },
    { icon: Building2, label: "Workspaces", href: "/admin/workspaces" },
    { icon: CreditCard, label: "AI Subscriptions", href: "/admin/subscriptions" },
    { icon: BarChart3, label: "Usage", href: "/admin/usage" },
  ];

  const adminConfigItems: NavItem[] = [
    { icon: LayoutTemplate, label: "Templates", href: "/internal/templates" },
    { icon: CreditCard, label: "AI Subscriptions", href: "/internal/subscriptions" },
    { icon: McpLogoIcon, label: "MCP", href: "/internal/mcp" },
  ];

  const adminBillingItems: NavItem[] = [
    { icon: CircleDollarSign, label: "Credits", href: "/internal/credits" },
    { icon: BarChart3, label: "Usage", href: "/internal/usage" },
  ];

  const adminMonitoringItems: NavItem[] = [
    { icon: Activity, label: "Chat Health", href: "/internal/chat-overview" },
    { icon: BrickIcon, label: "Coworker Overview", href: "/internal/coworker-overview" },
    { icon: Gauge, label: "Performance", href: "/internal/performance" },
    { icon: Container, label: "Sandboxes", href: "/internal/sandboxes" },
    { icon: Bug, label: "Ops", href: "/internal/ops" },
  ];

  const adminInstanceItems: NavItem[] = clientEditionCapabilities.hasInstanceAdmin
    ? [{ icon: Shield, label: "Instance", href: "/instance" }]
    : [];

  return (
    <>
      <BugReportDialog open={reportOpen} onOpenChange={setReportOpen} />

      <aside className="bg-sidebar hidden h-screen w-20 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center justify-center">
          <WorkspaceSwitcher
            activeWorkspace={activeWorkspace}
            isPending={switchWorkspace.isPending}
            onSwitchWorkspace={handleSwitchWorkspace}
            workspaces={workspaces}
          />
        </div>

        <nav className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-2 pb-4 pt-1">
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
                <NavButton icon={Bug} label={t("Bug report")} onClick={openReportDialog} />
                {isAdmin ? (
                  <NavButton icon={Shield} label={t("Admin")} onClick={openAdminRoute} />
                ) : null}
              </NavGroup>
            </>
          ) : isProductAdminRoute ? (
            <>
              <NavGroup>
                {productAdminItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </NavGroup>
              <NavDivider />
              <NavGroup>
                <NavButton icon={ArrowLeft} label={t("Exit Admin")} onClick={enterUserMode} />
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
                <NavButton icon={ArrowLeft} label={t("Exit Admin")} onClick={enterUserMode} />
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
                <NavButton icon={ArrowLeft} label={t("Exit Admin")} onClick={enterUserMode} />
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
                {avatarImage ? (
                  <AppImage
                    src={avatarImage}
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
                <AppLink href="/settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>
                    <T>Settings</T>
                  </span>
                </AppLink>
              </DropdownMenuItem>
              {clientEditionCapabilities.hasSupportAdmin && isAdmin ? (
                <DropdownMenuItem asChild>
                  <AppLink href="/internal" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span>
                      <T>Internal</T>
                    </span>
                  </AppLink>
                </DropdownMenuItem>
              ) : null}
              {clientEditionCapabilities.hasBilling ? (
                <DropdownMenuItem asChild>
                  <AppLink href="/settings/usage" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>
                      <T>Usage</T>
                    </span>
                  </AppLink>
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
              {session?.user || initialPrincipalActive ? (
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  <span>
                    <T>Log out</T>
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild>
                  <AppLink href="/login" className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    <span>
                      <T>Log in</T>
                    </span>
                  </AppLink>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
