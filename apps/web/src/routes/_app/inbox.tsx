"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Search } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  InboxCoworkerItem,
  InboxItem,
  InboxItemStatus,
  ToolApprovalData,
} from "@/components/inbox/types";
import { InboxAgentFilter } from "@/components/inbox/inbox-agent-filter";
import { InboxList } from "@/components/inbox/inbox-list";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { client } from "@/orpc/client";
import {
  useCancelGeneration,
  useCoworkerList,
  useEnqueueConversationMessage,
  useGetAuthUrl,
  useGetOrCreateBuilderConversation,
  useInboxEditApprovalAndResend,
  useInfiniteInboxItems,
  useInboxMarkAsRead,
  useSubmitApproval,
  useSubmitAuthResult,
} from "@/orpc/hooks";

type InboxSearch = {
  auth_complete?: string;
  interrupt_id?: string;
};

export const Route = createFileRoute("/_app/inbox")({
  // OAuth completion flags resume the auth flow after an integration connect redirect.
  validateSearch: (search: Record<string, unknown>): InboxSearch => {
    const authComplete = typeof search.auth_complete === "string" ? search.auth_complete : undefined;
    const interruptId = typeof search.interrupt_id === "string" ? search.interrupt_id : undefined;
    return {
      ...(authComplete ? { auth_complete: authComplete } : {}),
      ...(interruptId ? { interrupt_id: interruptId } : {}),
    };
  },
  head: () => ({
    meta: [{ title: "Inbox | CmdClaw" }],
  }),
  component: InboxPage,
});

const ALL_STATUSES: InboxItemStatus[] = [
  "needs_user_input",
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "completed",
  "error",
  "cancelled",
];
const DEFAULT_STATUS_FILTERS: InboxItemStatus[] = ALL_STATUSES;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeInboxItems(items: InboxItem[] | undefined): InboxItem[] {
  const normalized: InboxItem[] = [];
  for (const item of items ?? []) {
    if (item.kind === "coworker") {
      normalized.push({
        kind: "coworker",
        id: item.id,
        runId: item.runId,
        coworkerId: item.coworkerId,
        coworkerName: item.coworkerName,
        builderAvailable: item.builderAvailable,
        title: item.title,
        status: item.status,
        updatedAt: toDate(item.updatedAt),
        createdAt: toDate(item.createdAt),
        generationId: item.generationId,
        conversationId: item.conversationId,
        lastAgentMessage: item.lastAgentMessage,
        errorMessage: item.errorMessage,
        pauseReason: item.pauseReason,
        pendingApproval: item.pendingApproval,
        pendingAuth: item.pendingAuth,
      });
      continue;
    }
  }
  return normalized;
}

function InboxPageContent() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const authCallbackHandledRef = useRef<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<InboxItemStatus[]>(DEFAULT_STATUS_FILTERS);
  const [sourceCoworkerId, setSourceCoworkerId] = useState<string | undefined>(undefined);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const inboxQuery = useInfiniteInboxItems({
    limit: 50,
    type: "coworkers",
    statuses: statusFilters,
    sourceCoworkerId,
    query: deferredSearchQuery,
  });
  const coworkersQuery = useCoworkerList();
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = inboxQuery;
  const submitApproval = useSubmitApproval();
  const submitAuthResult = useSubmitAuthResult();
  const cancelGeneration = useCancelGeneration();
  const enqueueConversationMessage = useEnqueueConversationMessage();
  const getAuthUrl = useGetAuthUrl();
  const getOrCreateBuilderConversation = useGetOrCreateBuilderConversation();
  const editApprovalAndResend = useInboxEditApprovalAndResend();
  const markInboxItemAsRead = useInboxMarkAsRead();

  useEffect(() => {
    const authComplete = search.auth_complete;
    const interruptId = search.interrupt_id;
    if (!authComplete || !interruptId) {
      return;
    }

    const handledKey = `${interruptId}:${authComplete}`;
    if (authCallbackHandledRef.current === handledKey) {
      return;
    }
    authCallbackHandledRef.current = handledKey;

    submitAuthResult
      .mutateAsync({
        interruptId,
        integration: authComplete,
        success: true,
      })
      .then(() => {
        void navigate({ to: "/inbox", replace: true });
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to resume auth flow.");
      });
  }, [navigate, search.auth_complete, search.interrupt_id, submitAuthResult]);

  const items = useMemo(
    () => normalizeInboxItems(inboxQuery.data?.items as InboxItem[] | undefined),
    [inboxQuery.data?.items],
  );
  const coworkers = useMemo(
    () =>
      (
        (coworkersQuery.data ?? []) as Array<{
          id: string;
          name?: string | null;
          username?: string | null;
          description?: string | null;
          status: "on" | "off";
          triggerType: string;
          isPinned?: boolean;
          sharedAt?: Date | string | null;
          recentRuns?: { id?: string; status: string; startedAt?: Date | string | null }[];
        }>
      ).map((coworker) => ({
        id: coworker.id,
        name: coworker.name,
        username: coworker.username,
        description: coworker.description,
        status: coworker.status,
        triggerType: coworker.triggerType,
        isPinned: coworker.isPinned,
        sharedAt: coworker.sharedAt,
        recentRuns: coworker.recentRuns,
      })),
    [coworkersQuery.data],
  );

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const toggleEditing = useCallback((id: string) => {
    setEditingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleStatus = useCallback((status: InboxItemStatus) => {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        const next = current.filter((value) => value !== status);
        return next.length > 0 ? next : ALL_STATUSES;
      }
      return [...current, status];
    });
  }, []);
  const handleLoadMoreClick = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const runItemAction = useCallback(async (itemId: string, action: () => Promise<void>) => {
    setBusyItemId(itemId);
    try {
      await action();
    } finally {
      setBusyItemId(null);
    }
  }, []);

  const handleApprove = useCallback(
    async (item: InboxItem, questionAnswers?: string[][]) => {
      const pendingApproval = item.pendingApproval;
      if (!pendingApproval) {
        return;
      }

      await runItemAction(item.id, async () => {
        await submitApproval.mutateAsync({
          interruptId: pendingApproval.interruptId,
          decision: "approve",
          questionAnswers,
        });
      });
    },
    [runItemAction, submitApproval],
  );

  const handleDeny = useCallback(
    async (item: InboxItem) => {
      const pendingApproval = item.pendingApproval;
      if (!pendingApproval) {
        return;
      }

      await runItemAction(item.id, async () => {
        await submitApproval.mutateAsync({
          interruptId: pendingApproval.interruptId,
          decision: "deny",
        });
      });
    },
    [runItemAction, submitApproval],
  );

  const handleStop = useCallback(
    async (item: InboxItem) => {
      if (item.kind === "coworker" && item.status === "needs_user_input") {
        await runItemAction(item.id, async () => {
          await client.inbox.dismissCoworkerRun({ id: item.runId });
        });
        return;
      }
      if (!item.generationId) {
        return;
      }

      await runItemAction(item.id, async () => {
        await cancelGeneration.mutateAsync(item.generationId!);
      });
    },
    [cancelGeneration, runItemAction],
  );

  const handleContinue = useCallback(
    async (item: InboxItem) => {
      if (!item.generationId) {
        toast.error("This item cannot be continued because it has no paused generation.");
        return;
      }

      const conversationId = item.kind === "chat" ? item.conversationId : item.conversationId;
      if (!conversationId) {
        toast.error("This item cannot be continued because it has no linked conversation.");
        return;
      }

      await runItemAction(item.id, async () => {
        await client.generation.startGeneration({
          conversationId,
          content: "continue",
          resumePausedGenerationId: item.generationId!,
        });

        void navigate({
          to: item.kind === "chat" ? `/chat/${conversationId}` : `/agents/runs/${item.runId}`,
        });
      });
    },
    [navigate, runItemAction],
  );

  const handleAuthConnect = useCallback(
    async (item: InboxItem, integration: string) => {
      const interruptId = item.pendingAuth?.interruptId;
      if (!interruptId) {
        return;
      }

      await runItemAction(item.id, async () => {
        const result = await getAuthUrl.mutateAsync({
          type: integration as
            | "google_gmail"
            | "outlook"
            | "outlook_calendar"
            | "google_calendar"
            | "google_docs"
            | "google_sheets"
            | "google_drive"
            | "notion"
            | "github"
            | "airtable"
            | "slack"
            | "hubspot"
            | "linkedin"
            | "salesforce"
            | "dynamics"
            | "reddit"
            | "twitter",
          redirectUrl: `${window.location.origin}/inbox?auth_complete=${integration}&interrupt_id=${interruptId}`,
        });
        window.location.href = result.authUrl;
      });
    },
    [getAuthUrl, runItemAction],
  );

  const handleAuthCancel = useCallback(
    async (item: InboxItem) => {
      const integration = item.pendingAuth?.integrations[0];
      const interruptId = item.pendingAuth?.interruptId;
      if (!integration || !interruptId) {
        return;
      }

      await runItemAction(item.id, async () => {
        await submitAuthResult.mutateAsync({
          interruptId,
          integration,
          success: false,
        });
      });
    },
    [runItemAction, submitAuthResult],
  );

  const handleSaveEdit = useCallback(
    async (item: InboxItem, updated: ToolApprovalData) => {
      if (!item.generationId || !item.pendingApproval) {
        return;
      }

      await runItemAction(item.id, async () => {
        if (item.kind === "coworker") {
          await editApprovalAndResend.mutateAsync({
            kind: "coworker",
            generationId: item.generationId!,
            toolUseId: item.pendingApproval!.toolUseId,
            updatedToolInput: updated.toolInput,
            conversationId: item.conversationId ?? "",
            runId: item.runId,
          });
        } else {
          await editApprovalAndResend.mutateAsync({
            kind: "chat",
            generationId: item.generationId!,
            toolUseId: item.pendingApproval!.toolUseId,
            updatedToolInput: updated.toolInput,
            conversationId: item.conversationId,
          });
        }

        setEditingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      });
    },
    [editApprovalAndResend, runItemAction],
  );

  const handleReply = useCallback(
    async (item: InboxItem, message: string) => {
      const conversationId = item.conversationId;
      if (!conversationId) {
        toast.error("This item does not have a linked conversation yet.");
        return;
      }

      await runItemAction(item.id, async () => {
        await enqueueConversationMessage.mutateAsync({
          conversationId,
          content: message,
          replaceExisting: false,
        });
        void navigate({
          to: item.kind === "chat" ? `/chat/${conversationId}` : `/agents/runs/${item.runId}`,
        });
      });
    },
    [enqueueConversationMessage, navigate, runItemAction],
  );

  const handleOpenTarget = useCallback(
    (item: InboxItem) => {
      if (item.kind === "chat") {
        void navigate({ to: `/chat/${item.conversationId}` });
        return;
      }

      void navigate({ to: `/agents/runs/${item.runId}` });
    },
    [navigate],
  );

  const handleOpenBuilder = useCallback(
    async (item: InboxCoworkerItem) => {
      await runItemAction(item.id, async () => {
        await getOrCreateBuilderConversation.mutateAsync(item.coworkerId);
        const coworker = (
          (coworkersQuery.data ?? []) as Array<{ id: string; username?: string | null }>
        ).find((candidate) => candidate.id === item.coworkerId);
        void navigate({ to: getCoworkerEditHref(coworker ?? { id: item.coworkerId }) });
      });
    },
    [coworkersQuery.data, getOrCreateBuilderConversation, navigate, runItemAction],
  );
  const handleMarkAsRead = useCallback(
    async (item: InboxItem) => {
      await runItemAction(item.id, async () => {
        await markInboxItemAsRead.mutateAsync({
          kind: item.kind,
          id: item.id,
        });
      });

      setEditingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    },
    [markInboxItemAsRead, runItemAction],
  );

  const handleApproveWithToast = useCallback(
    (item: InboxItem, questionAnswers?: string[][]) => {
      void handleApprove(item, questionAnswers).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to approve action.");
      });
    },
    [handleApprove],
  );
  const handleDenyWithToast = useCallback(
    (item: InboxItem) => {
      void handleDeny(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to deny action.");
      });
    },
    [handleDeny],
  );
  const handleStopWithToast = useCallback(
    (item: InboxItem) => {
      void handleStop(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to stop generation.");
      });
    },
    [handleStop],
  );
  const handleContinueWithToast = useCallback(
    (item: InboxItem) => {
      void handleContinue(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to continue paused run.");
      });
    },
    [handleContinue],
  );
  const handleAuthConnectWithToast = useCallback(
    (item: InboxItem, integration: string) => {
      void handleAuthConnect(item, integration).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to start integration connection.",
        );
      });
    },
    [handleAuthConnect],
  );
  const handleAuthCancelWithToast = useCallback(
    (item: InboxItem) => {
      void handleAuthCancel(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to cancel auth request.");
      });
    },
    [handleAuthCancel],
  );
  const handleSaveEditWithToast = useCallback(
    (item: InboxItem, updated: ToolApprovalData) => {
      void handleSaveEdit(item, updated).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to resend edited approval.");
      });
    },
    [handleSaveEdit],
  );
  const handleReplyWithToast = useCallback(
    (item: InboxItem, message: string) => {
      void handleReply(item, message).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to send reply.");
      });
    },
    [handleReply],
  );
  const handleOpenBuilderWithToast = useCallback(
    (item: InboxCoworkerItem) => {
      void handleOpenBuilder(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to open builder.");
      });
    },
    [handleOpenBuilder],
  );
  const handleMarkAsReadWithToast = useCallback(
    (item: InboxItem) => {
      void handleMarkAsRead(item).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to update inbox item.");
      });
    },
    [handleMarkAsRead],
  );

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto w-full max-w-[960px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
        <div className="border-border bg-card/60 mb-5 rounded-xl border p-3">
          <div className="space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground/50 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search inbox..."
                className="bg-background text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:ring-ring/50 h-10 w-full rounded-lg border pr-3 pl-9 text-sm transition-colors outline-none focus:ring-1"
              />
            </div>
            <div className="border-border/70 border-t pt-3">
              <InboxAgentFilter
                statusFilters={statusFilters}
                onToggleStatus={toggleStatus}
                sourceCoworkerId={sourceCoworkerId}
                onSourceCoworkerChange={setSourceCoworkerId}
                coworkers={coworkers}
                isLoadingCoworkers={coworkersQuery.isLoading}
              />
            </div>
          </div>
        </div>

        <InboxList
          items={items}
          editingIds={editingIds}
          busyItemId={busyItemId}
          onToggleEditing={toggleEditing}
          onApprove={handleApproveWithToast}
          onDeny={handleDenyWithToast}
          onStop={handleStopWithToast}
          onContinue={handleContinueWithToast}
          onAuthConnect={handleAuthConnectWithToast}
          onAuthCancel={handleAuthCancelWithToast}
          onSaveEdit={handleSaveEditWithToast}
          onReply={handleReplyWithToast}
          onOpenTarget={handleOpenTarget}
          onOpenBuilder={handleOpenBuilderWithToast}
          onMarkAsRead={handleMarkAsReadWithToast}
        />
        <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center py-4">
          {isFetchingNextPage ? (
            <div className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Loading older runs
            </div>
          ) : hasNextPage ? (
            <button
              type="button"
              onClick={handleLoadMoreClick}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-xs transition-colors"
            >
              Load older runs
            </button>
          ) : items.length > 0 ? (
            <p className="text-muted-foreground/60 text-xs">
              Showing coworker runs from the last 90 days
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function InboxPage() {
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950">
          Inbox is currently in beta and limited to admin users.
        </div>
      </div>
    );
  }

  return <InboxPageContent />;
}
