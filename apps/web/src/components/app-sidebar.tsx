"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bug,
  Building2,
  CircleDollarSign,
  CheckCheck,
  Check,
  CreditCard,
  Cuboid,
  Inbox,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Settings,
  Shield,
  Toolbox,
  Trash2,
  Gauge,
  Container,
  UserCog,
  WandSparkles,
  LayoutTemplate,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BugReportDialog } from "@/components/bug-report-dialog";
import { useChatDraftStore } from "@/components/chat/chat-draft-store";
import { ConversationUsageDialog } from "@/components/conversation-usage-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import {
  getConversationSeenTarget,
  getEffectiveSeenMessageCount,
  hasUnreadConversationResults,
} from "@/lib/conversation-seen";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { clientEditionCapabilities } from "@/lib/edition";
import { openNewChat } from "@/lib/open-new-chat";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";
import {
  useConversationList,
  useDeleteConversation,
  useMarkAllConversationsSeen,
  useMarkConversationSeen,
  useUpdateConversationPinned,
  useUpdateConversationTitle,
} from "@/orpc/hooks";

type ConversationListData = {
  conversations: Array<{
    id: string;
    title: string | null;
    isPinned: boolean;
    generationStatus:
      | "idle"
      | "generating"
      | "awaiting_approval"
      | "awaiting_auth"
      | "paused"
      | "complete"
      | "error";
    updatedAt: Date;
    messageCount: number;
    seenMessageCount: number;
  }>;
};
type WorkspaceCoworkerRunsData = {
  runs: Array<{
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage: string | null;
    conversationId: string | null;
    coworkerId: string | null;
    coworkerName: string;
  }>;
};

const RUNNING_CONVERSATION_STATUSES = new Set(["generating"]);
const ACTIVE_COWORKER_RUN_STATUSES = new Set([
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);
const HUMAN_INPUT_CONVERSATION_STATUSES = new Set(["awaiting_approval", "awaiting_auth", "paused"]);
const HUMAN_INPUT_COWORKER_RUN_STATUSES = new Set(["awaiting_approval", "awaiting_auth", "paused"]);
const EMPTY_CONVERSATIONS: ConversationListData["conversations"] = [];
const EMPTY_COWORKER_RUNS: WorkspaceCoworkerRunsData["runs"] = [];
const RECENT_LIST_LOAD_MORE_THRESHOLD_PX = 24;

function isActiveCoworkerRunStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && ACTIVE_COWORKER_RUN_STATUSES.has(status);
}

function useWorkspaceCoworkerRuns(options?: { limit?: number; enabled?: boolean }) {
  const query = useInfiniteQuery({
    queryKey: ["coworker", "workspace-runs", options?.limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.coworker.listWorkspaceRuns({
        limit: options?.limit ?? 50,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: options?.enabled ?? true,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.runs.some((run) => isActiveCoworkerRunStatus(run.status)),
      )
        ? 5_000
        : false,
  });

  const data = useMemo(
    () => ({
      runs: query.data?.pages.flatMap((page) => page.runs) ?? [],
    }),
    [query.data],
  );

  return {
    ...query,
    data,
  };
}

function formatRelativeShort(date: Date) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) {
    return "now";
  }

  const units: Array<[label: string, seconds: number]> = [
    ["y", 31_536_000],
    ["mo", 2_592_000],
    ["w", 604_800],
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
  ];

  for (const [label, seconds] of units) {
    if (diffSeconds >= seconds) {
      return `${Math.floor(diffSeconds / seconds)}${label}`;
    }
  }

  return "now";
}

function formatRelativeShortNullable(value?: Date | string | null) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatRelativeShort(date) : "—";
}

function HumanInputDot() {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500"
      aria-label="Needs human input"
    />
  );
}

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
};

function McpLogoIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative block", className)}>
      <Image
        src="/integrations/mcp.svg"
        alt=""
        fill
        sizes="16px"
        className="object-contain dark:invert"
      />
    </span>
  );
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
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
    <button
      type="button"
      onClick={onClick}
      className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sidebar-foreground/40 px-2.5 text-[11px] font-semibold tracking-wider uppercase">
      {children}
    </span>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);
  const [adminAnimState, setAdminAnimState] = useState<"idle" | "entering" | "exiting">("idle");
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [usageTarget, setUsageTarget] = useState<
    | {
        kind: "conversation";
        conversationId: string;
        title: string;
      }
    | {
        kind: "run";
        conversationId: string | null;
        title: string;
      }
    | null
  >(null);
  const latestSeenRef = useRef<Record<string, number>>({});
  const recentScrollRef = useRef<HTMLElement | null>(null);
  const recentChatsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const recentCoworkerRunsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const {
    data: rawConversationData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useConversationList();
  const conversationData = rawConversationData as ConversationListData | undefined;
  const isCoworkerPage = pathname === "/coworkers" || pathname.startsWith("/coworkers/");
  const {
    data: rawCoworkerRunsData,
    isLoading: coworkerRunsLoading,
    fetchNextPage: fetchNextCoworkerRunsPage,
    hasNextPage: hasNextCoworkerRunsPage,
    isFetchingNextPage: isFetchingNextCoworkerRunsPage,
  } = useWorkspaceCoworkerRuns({
    enabled: isCoworkerPage,
  });
  const coworkerRunsData = rawCoworkerRunsData as WorkspaceCoworkerRunsData | undefined;
  const deleteConversation = useDeleteConversation();
  const markAllConversationsSeenMutation = useMarkAllConversationsSeen();
  const markConversationSeenMutation = useMarkConversationSeen();
  const updateConversationPinned = useUpdateConversationPinned();
  const updateConversationTitle = useUpdateConversationTitle();

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

  // Derive admin mode from pathname
  const isAdminRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/instance");
  const prevAdminRouteRef = useRef(isAdminRoute);
  useEffect(() => {
    if (prevAdminRouteRef.current !== isAdminRoute) {
      setAdminAnimState(isAdminRoute ? "entering" : "exiting");
      prevAdminRouteRef.current = isAdminRoute;
    }
  }, [isAdminRoute]);
  useEffect(() => {
    if (adminAnimState !== "idle") {
      requestAnimationFrame(() => setAdminAnimState("idle"));
    }
  }, [adminAnimState]);

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

  const userEmail = session?.user?.email ?? "";
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";
  const isAdmin = session?.user?.role === "admin";
  const impersonatedBy = (
    session as (SessionData & { session?: { impersonatedBy?: string | null } }) | null
  )?.session?.impersonatedBy;
  const isImpersonating = Boolean(impersonatedBy);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    if (href === "/chat") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };
  // Only animate the recent section when navigating to/from coworkers, not on first load/reload.
  const recentDirection = isCoworkerPage ? 1 : -1;
  const [recentAnimState, setRecentAnimState] = useState<"idle" | "animating">(() => {
    if (typeof window === "undefined") {
      return "idle";
    }
    const prev = sessionStorage.getItem("sidebar-recent");
    const curr = isCoworkerPage ? "coworkers" : "chats";
    sessionStorage.setItem("sidebar-recent", curr);
    return prev !== null && prev !== curr ? "animating" : "idle";
  });
  useEffect(() => {
    if (recentAnimState === "animating") {
      // Trigger animation on next frame so CSS transition picks up the change
      requestAnimationFrame(() => setRecentAnimState("idle"));
    }
  }, [recentAnimState]);
  const recentContentStyle = useMemo(
    () =>
      recentAnimState === "animating"
        ? { opacity: 0, transform: `translateX(${recentDirection * 40}px)` }
        : { opacity: 1, transform: "translateX(0)" },
    [recentAnimState, recentDirection],
  );

  const normalPanelStyle = useMemo(
    () =>
      adminAnimState === "entering"
        ? { opacity: 0, transform: "translateX(-40px)" }
        : {
            opacity: isAdminRoute && adminAnimState === "idle" ? 0 : 1,
            transform: "translateX(0)",
          },
    [adminAnimState, isAdminRoute],
  );

  const adminPanelStyle = useMemo(
    () =>
      adminAnimState === "exiting"
        ? { opacity: 0, transform: "translateX(40px)" }
        : {
            opacity: !isAdminRoute && adminAnimState === "idle" ? 0 : 1,
            transform: "translateX(0)",
          },
    [adminAnimState, isAdminRoute],
  );

  const mainNavItems: NavItem[] = [
    { icon: WandSparkles, label: "Create", href: "/" },
    { icon: LayoutTemplate, label: "Templates", href: "/templates" },
  ];

  const coworkerNavItems: NavItem[] = [
    ...(isAdmin ? [{ icon: Inbox, label: "Inbox", href: "/inbox" }] : []),
    { icon: MessageSquare, label: "Chat", href: "/chat" },
    { icon: Cuboid, label: "Coworkers", href: "/coworkers" },
    { icon: Toolbox, label: "Toolbox", href: "/toolbox" },
  ];

  const adminUsersItems: NavItem[] = [
    { icon: UserCog, label: "User", href: "/admin" },
    { icon: Building2, label: "Workspaces", href: "/admin/workspaces" },
  ];

  const adminConfigItems: NavItem[] = [
    { icon: LayoutTemplate, label: "Templates", href: "/admin/templates" },
    { icon: CreditCard, label: "AI Subscriptions", href: "/admin/subscriptions" },
    { icon: McpLogoIcon, label: "MCP", href: "/admin/mcp" },
    // { icon: MessageCircle, label: "WhatsApp", href: "/admin/whatsapp" },
  ];

  const adminBillingItems: NavItem[] = [
    { icon: CircleDollarSign, label: "Credits", href: "/admin/credits" },
    { icon: BarChart3, label: "Usage", href: "/admin/usage" },
  ];

  const adminMonitoringItems: NavItem[] = [
    { icon: Activity, label: "Chat Health", href: "/admin/chat-overview" },
    { icon: Cuboid, label: "Coworker Overview", href: "/admin/coworker-overview" },
    { icon: Gauge, label: "Performance", href: "/admin/performance" },
    { icon: Container, label: "Sandboxes", href: "/admin/sandboxes" },
    { icon: Bug, label: "Ops", href: "/admin/ops" },
  ];

  const adminInstanceItems: NavItem[] = clientEditionCapabilities.hasInstanceAdmin
    ? [{ icon: Shield, label: "Instance", href: "/instance" }]
    : [];

  const recentCoworkerRuns = coworkerRunsData?.runs ?? EMPTY_COWORKER_RUNS;
  const recentConversations = conversationData?.conversations ?? EMPTY_CONVERSATIONS;
  const unreadConversationCount = recentConversations.filter(
    (conversation) =>
      conversation.messageCount >
      getEffectiveSeenMessageCount({
        serverSeenCount: conversation.seenMessageCount,
        optimisticSeenCount: latestSeenRef.current[conversation.id],
      }),
  ).length;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const root = recentScrollRef.current;
    const node = isCoworkerPage
      ? recentCoworkerRunsLoadMoreRef.current
      : recentChatsLoadMoreRef.current;
    const hasNextRecentPage = isCoworkerPage ? hasNextCoworkerRunsPage : hasNextPage;
    const isFetchingNextRecentPage = isCoworkerPage
      ? isFetchingNextCoworkerRunsPage
      : isFetchingNextPage;
    const fetchNextRecentPage = isCoworkerPage ? fetchNextCoworkerRunsPage : fetchNextPage;
    if (!root || !node || !hasNextRecentPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextRecentPage) {
          void fetchNextRecentPage();
        }
      },
      {
        root,
        rootMargin: "200px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    fetchNextCoworkerRunsPage,
    fetchNextPage,
    hasNextCoworkerRunsPage,
    hasNextPage,
    isCoworkerPage,
    isFetchingNextCoworkerRunsPage,
    isFetchingNextPage,
  ]);

  useEffect(() => {
    const isLoadingRecent = isCoworkerPage ? coworkerRunsLoading : conversationsLoading;
    const isFetchingNextRecentPage = isCoworkerPage
      ? isFetchingNextCoworkerRunsPage
      : isFetchingNextPage;
    const hasNextRecentPage = isCoworkerPage ? hasNextCoworkerRunsPage : hasNextPage;
    const fetchNextRecentPage = isCoworkerPage ? fetchNextCoworkerRunsPage : fetchNextPage;

    if (isLoadingRecent || isFetchingNextRecentPage || !hasNextRecentPage) {
      return;
    }

    const root = recentScrollRef.current;
    if (!root || root.scrollHeight > root.clientHeight) {
      return;
    }

    void fetchNextRecentPage();
  }, [
    conversationsLoading,
    coworkerRunsLoading,
    fetchNextCoworkerRunsPage,
    fetchNextPage,
    hasNextCoworkerRunsPage,
    hasNextPage,
    isCoworkerPage,
    isFetchingNextCoworkerRunsPage,
    isFetchingNextPage,
  ]);

  useEffect(() => {
    const activeConversationId = pathname.startsWith("/chat/")
      ? pathname.slice("/chat/".length)
      : "";
    if (!activeConversationId) {
      return;
    }

    const activeConversation = recentConversations.find(
      (conversation) => conversation.id === activeConversationId,
    );
    if (!activeConversation) {
      return;
    }

    const nextSeenCount = getConversationSeenTarget({
      messageCount: activeConversation.messageCount,
      serverSeenCount: activeConversation.seenMessageCount,
      optimisticSeenCount: latestSeenRef.current[activeConversation.id],
    });

    if (nextSeenCount === null) {
      return;
    }

    latestSeenRef.current[activeConversation.id] = nextSeenCount;
    markConversationSeenMutation.mutate({
      id: activeConversation.id,
      seenMessageCount: nextSeenCount,
    });
  }, [markConversationSeenMutation, pathname, recentConversations]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation.mutateAsync(id);
      useChatDraftStore.getState().clearDraft(id);
      if (pathname === `/chat/${id}`) {
        router.push("/chat");
      }
    },
    [deleteConversation, pathname, router],
  );

  const handleDeleteMenuClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const id = event.currentTarget.dataset.conversationId;
      if (!id) {
        return;
      }
      await handleDeleteConversation(id);
    },
    [handleDeleteConversation],
  );

  const handlePinMenuClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const id = event.currentTarget.dataset.conversationId;
      if (!id) {
        return;
      }
      const isPinned = event.currentTarget.dataset.conversationPinned === "true";
      await updateConversationPinned.mutateAsync({
        id,
        isPinned: !isPinned,
      });
    },
    [updateConversationPinned],
  );

  const handleRenameMenuClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const id = event.currentTarget.dataset.conversationId;
    if (!id) {
      return;
    }
    setRenameConversationId(id);
    setRenameTitle(event.currentTarget.dataset.conversationTitle ?? "");
    setIsRenameModalOpen(true);
  }, []);

  const handleUsageMenuClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const id = event.currentTarget.dataset.conversationId;
    if (!id) {
      return;
    }
    const title = event.currentTarget.dataset.conversationTitle ?? "Untitled";
    setUsageTarget({
      kind: "conversation",
      conversationId: id,
      title,
    });
  }, []);

  const handleRunUsageMenuClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const title = event.currentTarget.dataset.runTitle ?? "Untitled";
    setUsageTarget({
      kind: "run",
      conversationId: event.currentTarget.dataset.conversationId ?? null,
      title,
    });
  }, []);

  const handleRenameModalOpenChange = useCallback((open: boolean) => {
    setIsRenameModalOpen(open);
    if (!open) {
      setRenameConversationId(null);
      setRenameTitle("");
    }
  }, []);

  const handleUsageDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setUsageTarget(null);
    }
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    const trimmedTitle = renameTitle.trim();
    if (!renameConversationId || trimmedTitle.length === 0) {
      return;
    }
    await updateConversationTitle.mutateAsync({
      id: renameConversationId,
      title: trimmedTitle,
    });
    setIsRenameModalOpen(false);
    setRenameConversationId(null);
    setRenameTitle("");
  }, [renameConversationId, renameTitle, updateConversationTitle]);

  const handleRenameInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRenameTitle(event.target.value);
  }, []);

  const handleRenameFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleRenameSubmit();
    },
    [handleRenameSubmit],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (unreadConversationCount === 0 || markAllConversationsSeenMutation.isPending) {
      return;
    }

    for (const conversation of recentConversations) {
      latestSeenRef.current[conversation.id] = Math.max(
        latestSeenRef.current[conversation.id] ?? 0,
        conversation.messageCount,
      );
    }

    await markAllConversationsSeenMutation.mutateAsync();
  }, [markAllConversationsSeenMutation, recentConversations, unreadConversationCount]);

  const handleMarkAllReadClick = useCallback(() => {
    void handleMarkAllRead();
  }, [handleMarkAllRead]);

  const openReportDialog = useCallback(() => {
    setReportOpen(true);
  }, []);

  const enterAdminMode = useCallback(() => {
    router.push("/admin");
  }, [router]);

  const exitAdminMode = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleChatNavClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openNewChat(router);
    },
    [router],
  );

  const handleRecentListScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      const hasNextRecentPage = isCoworkerPage ? hasNextCoworkerRunsPage : hasNextPage;
      const isFetchingNextRecentPage = isCoworkerPage
        ? isFetchingNextCoworkerRunsPage
        : isFetchingNextPage;
      const fetchNextRecentPage = isCoworkerPage ? fetchNextCoworkerRunsPage : fetchNextPage;

      if (!hasNextRecentPage || isFetchingNextRecentPage) {
        return;
      }

      const node = event.currentTarget;
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (distanceFromBottom <= RECENT_LIST_LOAD_MORE_THRESHOLD_PX) {
        void fetchNextRecentPage();
      }
    },
    [
      fetchNextCoworkerRunsPage,
      fetchNextPage,
      hasNextCoworkerRunsPage,
      hasNextPage,
      isCoworkerPage,
      isFetchingNextCoworkerRunsPage,
      isFetchingNextPage,
    ],
  );

  return (
    <>
      <BugReportDialog open={reportOpen} onOpenChange={setReportOpen} />

      <AlertDialog open={isRenameModalOpen} onOpenChange={handleRenameModalOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename chat</AlertDialogTitle>
          </AlertDialogHeader>
          <form className="space-y-4" onSubmit={handleRenameFormSubmit}>
            <Input
              value={renameTitle}
              onChange={handleRenameInputChange}
              placeholder="Chat title"
              autoFocus
              maxLength={200}
            />
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={updateConversationTitle.isPending}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={updateConversationTitle.isPending || renameTitle.trim().length === 0}
              >
                {updateConversationTitle.isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Renaming...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Rename
                  </span>
                )}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <ConversationUsageDialog
        open={Boolean(usageTarget)}
        onOpenChange={handleUsageDialogOpenChange}
        conversationId={usageTarget?.conversationId}
        entityType={usageTarget?.kind ?? "conversation"}
        entityTitle={usageTarget?.title}
      />

      <aside className="bg-sidebar hidden h-screen w-[220px] shrink-0 flex-col border-r md:flex">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link href="/" prefetch={false} className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="CmdClaw"
              width={24}
              height={24}
              className="object-contain"
            />
            <span className="text-sidebar-foreground text-sm font-semibold tracking-tight">
              CmdClaw
            </span>
          </Link>
        </div>

        {/* Scrollable nav */}
        <div className="relative min-h-0 flex-1">
          <nav
            ref={recentScrollRef}
            onScroll={handleRecentListScroll}
            className="relative h-full overflow-y-auto px-2.5 pt-1 pb-10"
          >
            {/* Normal mode panel */}
            <div
              className={cn(
                "flex flex-col gap-5 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                isAdminRoute && adminAnimState === "idle" && "pointer-events-none invisible",
              )}
              style={normalPanelStyle}
            >
              {/* Main nav */}
              <div className="flex flex-col gap-0.5">
                {mainNavItems.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
                <NavButton icon={Bug} label="Bug report" onClick={openReportDialog} />
              </div>

              {/* Coworker section */}
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Coworker</SectionLabel>
                <div className="flex flex-col gap-0.5">
                  {coworkerNavItems.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                      onClick={item.href === "/chat" ? handleChatNavClick : undefined}
                    />
                  ))}
                </div>
              </div>

              {/* Admin trigger (admin only) */}
              {isAdmin && (
                <div className="flex flex-col gap-1.5">
                  <SectionLabel>Admin</SectionLabel>
                  <div className="flex flex-col gap-0.5">
                    <NavButton icon={Shield} label="Admin" onClick={enterAdminMode} />
                  </div>
                </div>
              )}

              {/* Recent — contextual: chats on all pages, runs on coworker page */}
              <div className="flex flex-col gap-1.5 overflow-hidden">
                <div
                  className="flex flex-col gap-1.5 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                  style={recentContentStyle}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between gap-2 px-2.5",
                      !isCoworkerPage && "group/recent-chats-header",
                    )}
                  >
                    <span className="text-sidebar-foreground/40 text-[11px] font-semibold tracking-wider uppercase">
                      {isCoworkerPage ? "Recent Runs" : "Recent Chats"}
                    </span>
                    {!isCoworkerPage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "text-sidebar-foreground/45 hover:text-sidebar-foreground h-5 w-5 rounded-sm transition-all",
                              "pointer-events-none opacity-0 group-hover/recent-chats-header:pointer-events-auto group-hover/recent-chats-header:opacity-100",
                              "focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
                            )}
                            aria-label="Recent chat actions"
                          >
                            <MoreHorizontal className="mx-auto h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom">
                          <DropdownMenuItem
                            onClick={handleMarkAllReadClick}
                            disabled={
                              unreadConversationCount === 0 ||
                              markAllConversationsSeenMutation.isPending
                            }
                          >
                            {markAllConversationsSeenMutation.isPending ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCheck className="h-4 w-4" />
                            )}
                            <span>Mark all as read</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {!isCoworkerPage ? (
                      conversationsLoading ? (
                        <span className="text-sidebar-foreground/55 px-2.5 py-1 text-[12px]">
                          Loading...
                        </span>
                      ) : recentConversations.length === 0 ? (
                        <div className="text-sidebar-foreground/30 px-2.5 py-3 text-[12px]">
                          No conversations yet
                        </div>
                      ) : (
                        <>
                          {recentConversations.map((conversation) => {
                            const isConversationActive = isActive(`/chat/${conversation.id}`);
                            const isConversationRunning = RUNNING_CONVERSATION_STATUSES.has(
                              conversation.generationStatus,
                            );
                            const needsHumanInput = HUMAN_INPUT_CONVERSATION_STATUSES.has(
                              conversation.generationStatus,
                            );
                            const hasUnreadResults = hasUnreadConversationResults({
                              isConversationActive,
                              isConversationRunning,
                              messageCount: conversation.messageCount,
                              serverSeenCount: conversation.seenMessageCount,
                              optimisticSeenCount: latestSeenRef.current[conversation.id],
                            });
                            const showConversationIndicator =
                              isConversationRunning || needsHumanInput || hasUnreadResults;

                            return (
                              <div
                                key={conversation.id}
                                className={cn(
                                  "group relative flex h-8 items-center rounded-md px-2.5 text-[13px] transition-colors",
                                  isConversationActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                                )}
                              >
                                <Link
                                  href={`/chat/${conversation.id}`}
                                  prefetch={false}
                                  className="flex min-w-0 flex-1 items-center"
                                >
                                  {isConversationRunning ? (
                                    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  ) : needsHumanInput ? (
                                    <HumanInputDot />
                                  ) : hasUnreadResults ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                                      aria-label="New unread results"
                                    />
                                  ) : null}
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 truncate",
                                      showConversationIndicator && "ml-2",
                                    )}
                                  >
                                    {conversation.title || "Untitled"}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-sidebar-foreground/50 ml-2 shrink-0 text-[12px] transition-opacity",
                                      "group-hover:opacity-0 group-focus-within:opacity-0",
                                    )}
                                  >
                                    {formatRelativeShort(new Date(conversation.updatedAt))}
                                  </span>
                                </Link>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className={cn(
                                        "text-sidebar-foreground/60 hover:text-sidebar-foreground absolute top-1/2 right-1 z-10 h-6 w-6 -translate-y-1/2 rounded-sm opacity-0 transition-opacity",
                                        "pointer-events-none group-hover:pointer-events-auto focus-visible:pointer-events-auto data-[state=open]:pointer-events-auto",
                                        "group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                                        "before:pointer-events-none before:absolute before:-inset-y-1 before:-left-9 before:w-9 before:bg-gradient-to-l before:to-transparent",
                                        isConversationActive
                                          ? "before:from-sidebar-accent"
                                          : "before:from-sidebar",
                                      )}
                                      aria-label="Conversation actions"
                                    >
                                      <MoreHorizontal className="mx-auto h-3.5 w-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" side="right">
                                    <DropdownMenuItem
                                      data-conversation-id={conversation.id}
                                      data-conversation-pinned={
                                        conversation.isPinned ? "true" : "false"
                                      }
                                      onClick={handlePinMenuClick}
                                    >
                                      {conversation.isPinned ? (
                                        <PinOff className="h-4 w-4" />
                                      ) : (
                                        <Pin className="h-4 w-4" />
                                      )}
                                      <span>{conversation.isPinned ? "Unpin" : "Pin"}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      data-conversation-id={conversation.id}
                                      data-conversation-title={conversation.title ?? "Untitled"}
                                      onClick={handleUsageMenuClick}
                                    >
                                      <BarChart3 className="h-4 w-4" />
                                      <span>Show usage</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      data-conversation-id={conversation.id}
                                      data-conversation-title={conversation.title ?? ""}
                                      onClick={handleRenameMenuClick}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      <span>Rename</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      data-conversation-id={conversation.id}
                                      onClick={handleDeleteMenuClick}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      <span>Delete</span>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            );
                          })}
                          {hasNextPage ? (
                            <div
                              ref={recentChatsLoadMoreRef}
                              className="text-sidebar-foreground/45 px-2.5 py-2 text-[12px]"
                            >
                              {isFetchingNextPage
                                ? "Loading older chats..."
                                : "Scroll for older chats"}
                            </div>
                          ) : null}
                        </>
                      )
                    ) : coworkerRunsLoading ? (
                      <span className="text-sidebar-foreground/55 px-2.5 py-1 text-[12px]">
                        Loading...
                      </span>
                    ) : recentCoworkerRuns.length === 0 ? (
                      <div className="text-sidebar-foreground/30 px-2.5 py-3 text-[12px]">
                        No runs yet
                      </div>
                    ) : (
                      <>
                        {recentCoworkerRuns.map((run) => {
                          const runPath = `/coworkers/runs/${run.id}`;
                          const isRunning = run.status === "running";
                          const needsHumanInput = HUMAN_INPUT_COWORKER_RUN_STATUSES.has(run.status);

                          return (
                            <div
                              key={run.id}
                              className={cn(
                                "group relative rounded-md text-[13px] transition-colors",
                                pathname === runPath
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                              )}
                            >
                              <Link
                                href={runPath}
                                prefetch={false}
                                className="flex min-h-10 flex-col justify-center px-2.5 py-1.5 pr-8"
                              >
                                <span className="flex items-center gap-2">
                                  {isRunning ? (
                                    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  ) : needsHumanInput ? (
                                    <HumanInputDot />
                                  ) : null}
                                  <span className="min-w-0 flex-1 truncate">
                                    {run.coworkerName}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-sidebar-foreground/45 shrink-0 text-[11px] transition-opacity",
                                      "group-hover:opacity-0 group-focus-within:opacity-0",
                                    )}
                                  >
                                    {formatRelativeShortNullable(run.startedAt)}
                                  </span>
                                </span>
                                <span className="text-sidebar-foreground/45 truncate text-[11px]">
                                  {getCoworkerRunStatusLabel(run.status)}
                                </span>
                              </Link>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className={cn(
                                      "text-sidebar-foreground/60 hover:text-sidebar-foreground absolute top-1/2 right-1 z-10 h-6 w-6 -translate-y-1/2 rounded-sm opacity-0 transition-opacity",
                                      "pointer-events-none group-hover:pointer-events-auto focus-visible:pointer-events-auto data-[state=open]:pointer-events-auto",
                                      "group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                                      "before:pointer-events-none before:absolute before:-inset-y-1 before:-left-9 before:w-9 before:bg-gradient-to-l before:to-transparent",
                                      pathname === runPath
                                        ? "before:from-sidebar-accent"
                                        : "before:from-sidebar",
                                    )}
                                    aria-label="Run actions"
                                  >
                                    <MoreHorizontal className="mx-auto h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" side="right">
                                  <DropdownMenuItem
                                    data-conversation-id={run.conversationId ?? ""}
                                    data-run-title={run.coworkerName}
                                    onClick={handleRunUsageMenuClick}
                                  >
                                    <BarChart3 className="h-4 w-4" />
                                    <span>Show usage</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                        {(hasNextCoworkerRunsPage || isFetchingNextCoworkerRunsPage) && (
                          <div
                            ref={recentCoworkerRunsLoadMoreRef}
                            className="text-sidebar-foreground/45 px-2.5 py-2 text-[12px]"
                          >
                            {isFetchingNextCoworkerRunsPage
                              ? "Loading older runs..."
                              : "Scroll for older runs"}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Admin mode panel */}
            <div
              className={cn(
                "absolute inset-x-2.5 top-1 flex flex-col gap-5 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                !isAdminRoute && adminAnimState === "idle" && "pointer-events-none invisible",
              )}
              style={adminPanelStyle}
            >
              {clientEditionCapabilities.hasSupportAdmin ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Users & Access</SectionLabel>
                    <div className="flex flex-col gap-0.5">
                      {adminUsersItems.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(item.href)} />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Configuration</SectionLabel>
                    <div className="flex flex-col gap-0.5">
                      {adminConfigItems.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(item.href)} />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Billing & Usage</SectionLabel>
                    <div className="flex flex-col gap-0.5">
                      {adminBillingItems.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(item.href)} />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Monitoring & Ops</SectionLabel>
                    <div className="flex flex-col gap-0.5">
                      {adminMonitoringItems.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(item.href)} />
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                adminInstanceItems.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Admin</SectionLabel>
                    <div className="flex flex-col gap-0.5">
                      {adminInstanceItems.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(item.href)} />
                      ))}
                    </div>
                  </div>
                )
              )}
              <div className="flex flex-col gap-0.5">
                <NavButton icon={ArrowLeft} label="Exit Admin" onClick={exitAdminMode} />
              </div>
            </div>
          </nav>
          {/* Fade overlay at bottom of nav */}
          <div className="from-sidebar pointer-events-none absolute right-0 bottom-0 left-0 h-14 bg-gradient-to-t to-transparent" />
        </div>

        {/* Footer: user card */}
        <div className="px-2 pb-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="bg-sidebar-accent/80 hover:bg-sidebar-accent border-sidebar-border flex h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 text-[13px] transition-colors"
                title={userEmail}
              >
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="bg-sidebar-primary text-sidebar-primary-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                    {avatarInitial}
                  </span>
                )}
                <span className="text-sidebar-foreground/80 truncate text-[13px] font-medium">
                  {userEmail || "Account"}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-48">
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
