import {
  BarChart3,
  CheckCheck,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Check,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/animate-ui/components/radix/sheet";
import { AppLink } from "@/components/app-link";
import { useChatDraftStore } from "@/components/chat/chat-draft-store";
import { ConversationUsageDialog } from "@/components/conversation-usage-dialog";
import { usePathname, useRouter } from "@/components/next-navigation-compat";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { hasUnreadConversationResults } from "@/lib/conversation-seen";
import { flattenCoworkerRecentRuns } from "@/lib/coworker-recent-runs";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import {
  useConversationList,
  useDeleteConversation,
  useMarkAllConversationsSeen,
  useUpdateConversationPinned,
  useUpdateConversationTitle,
} from "@/orpc/hooks/conversation";
import { useCoworkerList } from "@/orpc/hooks/coworkers";

const RUNNING_CONVERSATION_STATUSES = new Set(["generating"]);
const HUMAN_INPUT_CONVERSATION_STATUSES = new Set(["awaiting_approval", "awaiting_auth", "paused"]);
const RECENT_CHATS_LOAD_MORE_THRESHOLD_PX = 24;

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
    <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-label="Needs human input" />
  );
}

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

type MobileRecentDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "chats" | "coworkers";
};

export function MobileRecentDrawer({ open, onOpenChange, mode }: MobileRecentDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const recentScrollRef = useRef<HTMLDivElement | null>(null);
  const recentChatsLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const {
    data: rawConversationData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useConversationList();
  const conversationData = rawConversationData as ConversationListData | undefined;
  const { data: coworkers } = useCoworkerList();
  const deleteConversation = useDeleteConversation();
  const markAllConversationsSeenMutation = useMarkAllConversationsSeen();
  const updateConversationPinned = useUpdateConversationPinned();
  const updateConversationTitle = useUpdateConversationTitle();

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [usageConversation, setUsageConversation] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const conversations = conversationData?.conversations ?? [];
  const recentCoworkerRuns = flattenCoworkerRecentRuns(coworkers).slice(0, 10);
  const unreadCount = conversations.filter(
    (c) => c.messageCount > (c.seenMessageCount ?? 0),
  ).length;

  const isActive = useCallback(
    (href: string) => {
      return pathname === href || pathname.startsWith(href + "/");
    },
    [pathname],
  );

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

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

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0 || markAllConversationsSeenMutation.isPending) {
      return;
    }
    await markAllConversationsSeenMutation.mutateAsync();
  }, [markAllConversationsSeenMutation, unreadCount]);

  const handleMarkAllReadClick = useCallback(() => {
    void handleMarkAllRead();
  }, [handleMarkAllRead]);

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

  const handleRenameModalOpenChange = useCallback((o: boolean) => {
    setIsRenameModalOpen(o);
    if (!o) {
      setRenameConversationId(null);
      setRenameTitle("");
    }
  }, []);

  const handleRenameFormSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void handleRenameSubmit();
    },
    [handleRenameSubmit],
  );

  const handleRenameTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRenameTitle(e.target.value);
  }, []);

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
    setUsageConversation({ id, title });
  }, []);

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

  const handleUsageDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setUsageConversation(null);
    }
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || mode !== "chats" || !open) {
      return;
    }

    const root = recentScrollRef.current;
    const node = recentChatsLoadMoreRef.current;
    if (!root || !node || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      {
        root,
        rootMargin: "200px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, mode, open]);

  useEffect(() => {
    if (mode !== "chats" || !open || conversationsLoading || isFetchingNextPage || !hasNextPage) {
      return;
    }

    const root = recentScrollRef.current;
    if (!root || root.scrollHeight > root.clientHeight) {
      return;
    }

    void fetchNextPage();
  }, [conversationsLoading, fetchNextPage, hasNextPage, isFetchingNextPage, mode, open]);

  const handleRecentChatsScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (mode !== "chats" || !open || !hasNextPage || isFetchingNextPage) {
        return;
      }

      const node = event.currentTarget;
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (distanceFromBottom <= RECENT_CHATS_LOAD_MORE_THRESHOLD_PX) {
        void fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage, mode, open],
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          title={mode === "chats" ? "Recent Chats" : "Recent Runs"}
          showCloseButton={false}
          className="w-[280px] p-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">
              {mode === "chats" ? "Recent Chats" : "Recent Runs"}
            </h2>
            {mode === "chats" && unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllReadClick}
                disabled={markAllConversationsSeenMutation.isPending}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
              >
                {markAllConversationsSeenMutation.isPending ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div
            ref={recentScrollRef}
            onScroll={handleRecentChatsScroll}
            className="flex-1 overflow-y-auto py-2"
          >
            {mode === "chats" ? (
              conversationsLoading ? (
                <p className="text-muted-foreground px-4 py-3 text-xs">Loading...</p>
              ) : conversations.length === 0 ? (
                <p className="text-muted-foreground px-4 py-6 text-center text-xs">
                  No conversations yet
                </p>
              ) : (
                <>
                  {conversations.map((conversation) => {
                    const active = isActive(`/chat/${conversation.id}`);
                    const isRunning = RUNNING_CONVERSATION_STATUSES.has(
                      conversation.generationStatus,
                    );
                    const needsHumanInput = HUMAN_INPUT_CONVERSATION_STATUSES.has(
                      conversation.generationStatus,
                    );
                    const hasUnread = hasUnreadConversationResults({
                      isConversationActive: active,
                      isConversationRunning: isRunning,
                      messageCount: conversation.messageCount,
                      serverSeenCount: conversation.seenMessageCount,
                    });

                    return (
                      <div
                        key={conversation.id}
                        className={cn("group relative flex items-center px-2")}
                      >
                        <AppLink
                          href={`/chat/${conversation.id}`}
                          onClick={handleClose}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground/70 hover:bg-accent/50",
                          )}
                        >
                          {isRunning ? (
                            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          ) : needsHumanInput ? (
                            <HumanInputDot />
                          ) : hasUnread ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">
                            {conversation.title || "Untitled"}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-[11px] group-hover:hidden">
                            {formatRelativeShort(new Date(conversation.updatedAt))}
                          </span>
                        </AppLink>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-sm group-hover:flex"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            <DropdownMenuItem
                              data-conversation-id={conversation.id}
                              data-conversation-pinned={conversation.isPinned ? "true" : "false"}
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
                      className="text-muted-foreground px-4 py-3 text-xs"
                    >
                      {isFetchingNextPage ? "Loading older chats..." : "Scroll for older chats"}
                    </div>
                  ) : null}
                </>
              )
            ) : recentCoworkerRuns.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-xs">No runs yet</p>
            ) : (
              recentCoworkerRuns.map((run) => {
                const runPath = `/agents/runs/${run.id}`;

                return (
                  <AppLink
                    key={run.id}
                    href={runPath}
                    onClick={handleClose}
                    className={cn(
                      "mx-2 flex flex-col gap-1 rounded-md px-2 py-2 text-sm transition-colors",
                      pathname === runPath
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/70 hover:bg-accent/50",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{run.coworkerName}</span>
                      <span className="text-muted-foreground shrink-0 text-[11px]">
                        {formatRelativeShortNullable(run.startedAt)}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {getCoworkerRunStatusLabel(run.status)}
                    </span>
                  </AppLink>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Rename modal */}
      <AlertDialog open={isRenameModalOpen} onOpenChange={handleRenameModalOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename chat</AlertDialogTitle>
          </AlertDialogHeader>
          <form className="space-y-4" onSubmit={handleRenameFormSubmit}>
            <Input
              value={renameTitle}
              onChange={handleRenameTitleChange}
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
        open={Boolean(usageConversation)}
        onOpenChange={handleUsageDialogOpenChange}
        conversationId={usageConversation?.id}
        entityTitle={usageConversation?.title}
      />
    </>
  );
}
