"use client";

import { Menu } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatHeaderActionsProvider } from "@/app/chat/chat-header-actions-context";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { RecentChatsSidebar } from "@/components/recent-chats-sidebar";
import { useCurrentUser, useSetUserTimezone } from "@/orpc/hooks";

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const routeConversationId = params?.conversationId as string | undefined;
  const [liveConversationId, setLiveConversationId] = useState<string | undefined>(
    routeConversationId,
  );
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const headerActionsContextValue = useMemo(() => ({ setHeaderActions }), []);
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const setTimezoneMutation = useSetUserTimezone();
  const lastTimezoneSyncRef = useRef<string | null>(null);
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const openRecentDrawer = useCallback(() => {
    setRecentDrawerOpen(true);
  }, []);

  useEffect(() => {
    setLiveConversationId(routeConversationId);
  }, [routeConversationId]);

  useEffect(() => {
    const handleConversationIdSync = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId) {
        setLiveConversationId(detail.conversationId);
      }
    };

    window.addEventListener(CHAT_CONVERSATION_ID_SYNC_EVENT, handleConversationIdSync);
    return () =>
      window.removeEventListener(CHAT_CONVERSATION_ID_SYNC_EVENT, handleConversationIdSync);
  }, []);

  useEffect(() => {
    if (userLoading || !user) {
      return;
    }

    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTimezone || user.timezone) {
      return;
    }

    if (setTimezoneMutation.isPending || lastTimezoneSyncRef.current === browserTimezone) {
      return;
    }

    lastTimezoneSyncRef.current = browserTimezone;
    setTimezoneMutation.mutate(browserTimezone, {
      onError: () => {
        lastTimezoneSyncRef.current = null;
      },
    });
  }, [userLoading, user, setTimezoneMutation]);

  return (
    <ChatHeaderActionsProvider value={headerActionsContextValue}>
      <div className="flex h-full min-h-0 overflow-hidden pb-[calc(3.5rem+var(--safe-area-inset-bottom))] md:pb-0">
        <RecentChatsSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="bg-background flex shrink-0 items-center gap-2 px-4 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 md:h-14 md:pt-0 md:pb-0">
            <button
              type="button"
              onClick={openRecentDrawer}
              className="text-muted-foreground hover:text-foreground -ml-1 flex h-9 w-9 items-center justify-center rounded-xl md:hidden"
              aria-label="Recent chats"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="ml-auto flex items-center gap-2">
              {headerActions}
              <ChatCopyButton conversationId={liveConversationId} />
              <ChatShareControls conversationId={liveConversationId} />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          <MobileRecentDrawer
            open={recentDrawerOpen}
            onOpenChange={setRecentDrawerOpen}
            mode="chats"
          />
        </div>
      </div>
    </ChatHeaderActionsProvider>
  );
}
