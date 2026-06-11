import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { RouterClient } from "@orpc/server";
import { useGT } from "gt-react";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppRouter } from "@/server/orpc";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatHeaderActionsProvider } from "@/components/chat/chat-header-actions-context";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
import { MobileRecentDrawer } from "@/components/mobile-recent-drawer";
import { RecentChatsSidebar } from "@/components/recent-chats-sidebar";
import type { ConversationListData } from "@/orpc/hooks/conversation";
import { useCurrentUser, useSetUserTimezone } from "@/orpc/hooks/user";

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";

type ConversationItem = ConversationListData[number];

function serializeDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  return typeof value === "string" || typeof value === "number" ? new Date(value) : new Date(0);
}

function serializeInitialConversation(row: Record<string, unknown>): ConversationItem {
  return {
    id: String(row.id),
    type: "chat",
    title: typeof row.title === "string" ? row.title : "New conversation",
    generationStatus: typeof row.generationStatus === "string" ? row.generationStatus : "idle",
    currentGenerationId:
      typeof row.currentGenerationId === "string" ? row.currentGenerationId : null,
    isPinned: row.isPinned === true,
    isShared: row.isShared === true,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    messageCount: typeof row.messageCount === "number" ? row.messageCount : 0,
    seenMessageCount: typeof row.seenMessageCount === "number" ? row.seenMessageCount : 0,
  };
}

const loadInitialConversations = createServerFn({ method: "GET" }).handler(async () => {
  const [{ createORPCClient }, { RPCLink }] = await Promise.all([
    import("@orpc/client"),
    import("@orpc/client/fetch"),
  ]);
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const requestUrl = new URL(request.url);
  const link = new RPCLink({
    url: `${requestUrl.origin}/api/rpc`,
    headers: () => ({
      cookie: request.headers.get("cookie") ?? "",
    }),
  });
  const serverClient: RouterClient<AppRouter> = createORPCClient(link);
  const page = await serverClient.conversation.list({ limit: 50 });

  return page.conversations.map((row) =>
    serializeInitialConversation(row as Record<string, unknown>),
  );
});

export const Route = createFileRoute("/_app/chat")({
  loader: () => loadInitialConversations(),
  component: ChatLayout,
});

function ChatLayout() {
  const t = useGT();
  const initialConversations = Route.useLoaderData();

  // The conversation id only exists on the `/chat/$conversationId` child route, so read
  // it loosely from the matched params (undefined on the `/chat` index route).
  const params = useParams({ strict: false });
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
        <RecentChatsSidebar initialConversations={initialConversations} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="bg-background flex shrink-0 items-center gap-2 px-4 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 md:h-14 md:pt-0 md:pb-0">
            <button
              type="button"
              onClick={openRecentDrawer}
              className="text-muted-foreground hover:text-foreground -ml-1 flex h-9 w-9 items-center justify-center rounded-xl md:hidden"
              aria-label={t("Recent chats")}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="ml-auto flex items-center gap-2">
              {headerActions}
              <ChatCopyButton conversationId={liveConversationId} />
              <ChatShareControls conversationId={liveConversationId} />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
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
