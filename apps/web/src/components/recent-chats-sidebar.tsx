"use client";

import {
  BarChart3,
  Check,
  CheckCheck,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { hasUnreadConversationResults } from "@/lib/conversation-seen";
import { cn } from "@/lib/utils";
import {
  useConversationList,
  useDeleteConversation,
  useMarkAllConversationsSeen,
  useUpdateConversationPinned,
  useUpdateConversationTitle,
} from "@/orpc/hooks";

const RUNNING_CONVERSATION_STATUSES = new Set(["generating"]);
const HUMAN_INPUT_CONVERSATION_STATUSES = new Set(["awaiting_approval", "awaiting_auth", "paused"]);
const LOAD_MORE_THRESHOLD_PX = 24;

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

function HumanInputDot() {
  return (
    <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-label="Needs human input" />
  );
}

type ConversationRowProps = {
  conversation: ConversationListData["conversations"][number];
  active: boolean;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, isPinned: boolean) => Promise<void>;
  onRename: (id: string, title: string) => void;
  onUsage: (id: string, title: string) => void;
};

function ConversationRow({
  conversation,
  active,
  onDelete,
  onPin,
  onRename,
  onUsage,
}: ConversationRowProps) {
  const isRunning = RUNNING_CONVERSATION_STATUSES.has(conversation.generationStatus);
  const needsHumanInput = HUMAN_INPUT_CONVERSATION_STATUSES.has(conversation.generationStatus);
  const hasUnread = hasUnreadConversationResults({
    isConversationActive: active,
    isConversationRunning: isRunning,
    messageCount: conversation.messageCount,
    serverSeenCount: conversation.seenMessageCount,
  });

  const handlePin = useCallback(() => {
    void onPin(conversation.id, conversation.isPinned);
  }, [conversation.id, conversation.isPinned, onPin]);

  const handleUsage = useCallback(() => {
    onUsage(conversation.id, conversation.title ?? "Untitled");
  }, [conversation.id, conversation.title, onUsage]);

  const handleRename = useCallback(() => {
    onRename(conversation.id, conversation.title ?? "");
  }, [conversation.id, conversation.title, onRename]);

  const handleDelete = useCallback(() => {
    void onDelete(conversation.id);
  }, [conversation.id, onDelete]);

  return (
    <div className="group relative flex items-center px-2">
      <Link
        href={`/chat/${conversation.id}`}
        prefetch={false}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
        )}
      >
        {isRunning ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : needsHumanInput ? (
          <HumanInputDot />
        ) : hasUnread ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread results" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{conversation.title || "Untitled"}</span>
        <span className="text-sidebar-foreground/45 shrink-0 text-[11px] group-hover:hidden">
          {formatRelativeShort(new Date(conversation.updatedAt))}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-sm group-hover:flex"
            aria-label="Conversation actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="right">
          <DropdownMenuItem onClick={handlePin}>
            {conversation.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            <span>{conversation.isPinned ? "Unpin" : "Pin"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleUsage}>
            <BarChart3 className="h-4 w-4" />
            <span>Show usage</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleRename}>
            <Pencil className="h-4 w-4" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type RecentChatsSidebarProps = {
  className?: string;
};

export function RecentChatsSidebar({ className }: RecentChatsSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const {
    data: rawConversationData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useConversationList();
  const conversationData = rawConversationData as ConversationListData | undefined;
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
  const unreadCount = conversations.filter(
    (conversation) => conversation.messageCount > (conversation.seenMessageCount ?? 0),
  ).length;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const root = scrollRef.current;
    const node = loadMoreRef.current;
    if (!root || !node || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root, rootMargin: "200px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (isLoading || isFetchingNextPage || !hasNextPage) {
      return;
    }

    const root = scrollRef.current;
    if (!root || root.scrollHeight > root.clientHeight) {
      return;
    }

    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isLoading]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasNextPage || isFetchingNextPage) {
        return;
      }

      const node = event.currentTarget;
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (distanceFromBottom <= LOAD_MORE_THRESHOLD_PX) {
        void fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

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

  const handlePinConversation = useCallback(
    async (id: string, isPinned: boolean) => {
      await updateConversationPinned.mutateAsync({ id, isPinned: !isPinned });
    },
    [updateConversationPinned],
  );

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setRenameConversationId(id);
    setRenameTitle(title);
    setIsRenameModalOpen(true);
  }, []);

  const handleUsageConversation = useCallback((id: string, title: string) => {
    setUsageConversation({ id, title });
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0 || markAllConversationsSeenMutation.isPending) {
      return;
    }
    await markAllConversationsSeenMutation.mutateAsync();
  }, [markAllConversationsSeenMutation, unreadCount]);

  const handleMarkAllReadClick = useCallback(() => {
    void handleMarkAllRead();
  }, [handleMarkAllRead]);

  const handleRenameModalOpenChange = useCallback((open: boolean) => {
    setIsRenameModalOpen(open);
    if (!open) {
      setRenameConversationId(null);
      setRenameTitle("");
    }
  }, []);

  const handleRenameTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRenameTitle(event.target.value);
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

  const handleRenameFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleRenameSubmit();
    },
    [handleRenameSubmit],
  );

  const handleUsageDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setUsageConversation(null);
    }
  }, []);

  return (
    <>
      <aside
        className={cn(
          "hidden h-full w-[248px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex",
          className,
        )}
      >
        <div className="border-sidebar-border flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
          <h2 className="text-[13px] font-semibold">Recent chats</h2>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllReadClick}
              disabled={markAllConversationsSeenMutation.isPending}
              className="text-sidebar-foreground/55 hover:text-sidebar-foreground flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[11px] transition-colors disabled:opacity-50"
            >
              {markAllConversationsSeenMutation.isPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              <span>Read</span>
            </button>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto py-2"
        >
          {isLoading ? (
            <p className="text-sidebar-foreground/55 px-4 py-3 text-xs">Loading...</p>
          ) : conversations.length === 0 ? (
            <p className="text-sidebar-foreground/45 px-4 py-6 text-center text-xs">
              No conversations yet
            </p>
          ) : (
            <>
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={pathname === `/chat/${conversation.id}`}
                  onDelete={handleDeleteConversation}
                  onPin={handlePinConversation}
                  onRename={handleRenameConversation}
                  onUsage={handleUsageConversation}
                />
              ))}
              {hasNextPage ? (
                <div ref={loadMoreRef} className="text-sidebar-foreground/45 px-4 py-3 text-xs">
                  {isFetchingNextPage ? "Loading older chats..." : "Scroll for older chats"}
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>

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
