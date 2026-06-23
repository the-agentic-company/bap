import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle,
  Clock,
  Download,
  FileCode2,
  History,
  Loader2,
  MessageSquareText,
  Pencil,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { MessageList } from "@/components/chat/message-list";
import { MessageBubble } from "@/components/chat/message-bubble";
import { findLatestAgenticAppFile } from "@/components/chat/agentic-app-selection";
import { mapPersistedMessagesToChatMessages } from "@/components/chat/persisted-message-mapper";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { RunDebugDetails } from "@/components/coworkers/run-debug-details";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { cn } from "@/lib/utils";
import {
  useConversation,
  useDownloadSandboxFile,
  useAgenticAppHtml,
} from "@/orpc/hooks/conversation";
import {
  useCoworker,
  useCoworkerList,
  useCoworkerRun,
  useCoworkerRuns,
  useTriggerCoworker,
} from "@/orpc/hooks/coworkers";
import type { SandboxFileData } from "@/components/chat/message-list";
import { AppLink as Link } from "../../../-lib/app-link";

type Props = {
  coworkerSlug: string;
};

function formatRunDate(value?: Date | string | null) {
  if (!value) {
    return "not started";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffWeeks < 8) {
    return `${diffWeeks}w ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getStatusClassName(status?: string) {
  if (status === "completed" || status === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "running" || status === "awaiting_approval" || status === "awaiting_auth") {
    return "border-brand-muted bg-brand-light text-brand-dark";
  }
  if (status === "error" || status === "cancelled") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  return "border-border bg-muted text-muted-foreground";
}

function isInProgressStatus(status?: string | null) {
  return status === "running";
}

function EmptyPreview({
  latestMessage,
  runStatus,
}: {
  latestMessage?: string;
  runStatus?: string | null;
}) {
  if (latestMessage?.trim()) {
    return (
      <div className="bg-background h-full overflow-auto p-5">
        <div className="mx-auto max-w-3xl">
          <div className="border-border/70 mb-4 flex h-11 items-center gap-2 border-b">
            <MessageSquareText className="text-muted-foreground h-4 w-4" />
            <p className="text-sm font-medium">Latest coworker message</p>
          </div>
          <MessageBubble messageRole="assistant" content={latestMessage} />
        </div>
      </div>
    );
  }

  if (isInProgressStatus(runStatus)) {
    return <LoadingState />;
  }

  return (
    <div className="bg-muted/25 flex h-full min-h-[22rem] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <FileCode2 className="text-muted-foreground mx-auto mb-3 h-6 w-6" />
        <p className="text-sm font-medium">No output.html found</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          The linked conversation has not produced an output.html artifact yet.
        </p>
      </div>
    </div>
  );
}

function AgenticAppFrame({ outputFile }: { outputFile: SandboxFileData }) {
  const preview = useAgenticAppHtml(outputFile.fileId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloading } = useDownloadSandboxFile();

  const handleRefresh = useCallback(() => {
    void preview.refetch();
  }, [preview]);

  const handleDownload = useCallback(async () => {
    const result = await downloadSandboxFile(outputFile.fileId);
    const link = document.createElement("a");
    link.href = result.url;
    link.download = outputFile.filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [downloadSandboxFile, outputFile.fileId, outputFile.filename]);

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border/70 flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FileCode2 className="text-muted-foreground h-4 w-4" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">output.html</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={preview.isFetching}
          aria-label="Refresh Agentic-App"
        >
          {preview.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-label="Download output.html"
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="bg-muted/30 min-h-0 flex-1">
        {preview.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : preview.isError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              <p className="text-sm font-medium">Agentic-App unavailable</p>
              <p className="text-muted-foreground text-xs">
                Download output.html to inspect the generated file.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            title="output.html Agentic-App"
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={preview.data?.html ?? ""}
          />
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[24rem] items-center justify-center">
      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
    </div>
  );
}

type HistoryRunItem = {
  id: string;
  status: string;
  startedAt?: Date | string | null;
};

function HistoryRunButton({
  run,
  selected,
  onSelect,
}: {
  run: HistoryRunItem;
  selected: boolean;
  onSelect: (runId: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(run.id);
  }, [onSelect, run.id]);

  return (
    <button
      type="button"
      className={cn(
        "hover:bg-muted flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
        selected ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
      onClick={handleClick}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{formatRunDate(run.startedAt)}</span>
        <span className="block truncate text-xs">{run.status}</span>
      </span>
      {selected ? <span className="bg-brand h-1.5 w-1.5 shrink-0 rounded-full" /> : null}
    </button>
  );
}

export function CoworkerInfoPrototype({ coworkerSlug }: Props) {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const navigate = useNavigate();
  const triggerCoworker = useTriggerCoworker();
  const coworkerList = useCoworkerList();
  const coworkerListItem = useMemo(
    () =>
      coworkerList.data?.find(
        (item) => item.username === coworkerSlug || item.id === coworkerSlug,
      ) ?? null,
    [coworkerList.data, coworkerSlug],
  );
  const resolvedCoworkerId = coworkerListItem?.id;
  const resolvedCoworkerSlug = coworkerListItem?.username ?? coworkerSlug;
  const coworkerRuns = useCoworkerRuns(resolvedCoworkerId, 20, {
    enabled: Boolean(resolvedCoworkerId),
  });
  const requestedRunId = searchParams.get("run");
  const selectedRunId =
    coworkerRuns.data?.some((candidate) => candidate.id === requestedRunId) && requestedRunId
      ? requestedRunId
      : coworkerRuns.data?.[0]?.id;
  const run = useCoworkerRun(selectedRunId, {
    enabled: Boolean(selectedRunId),
  });
  const coworker = useCoworker(resolvedCoworkerId);
  const isRunLoading =
    coworkerList.isLoading || coworkerRuns.isLoading || Boolean(selectedRunId && run.isLoading);
  const conversationId = run.data?.conversationId ?? undefined;
  const conversation = useConversation(conversationId);

  const messages = useMemo(
    () => mapPersistedMessagesToChatMessages(conversation.data?.messages ?? []),
    [conversation.data?.messages],
  );
  const outputFile = useMemo(() => findLatestAgenticAppFile(messages), [messages]);
  const latestCoworkerMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant" && message.content.trim()) {
        return message.content;
      }
    }
    return undefined;
  }, [messages]);
  const remoteRunSource = run.data ? extractRemoteRunSourceDetails(run.data) : null;
  const handleHistorySelect = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("run", runId);
      void navigate({
        to: "/prototype/coworker/info/$slug",
        params: { slug: resolvedCoworkerSlug },
        search: { run: params.get("run") ?? undefined },
      });
    },
    [navigate, resolvedCoworkerSlug, searchParams],
  );
  const handleRunNow = useCallback(async () => {
    if (!resolvedCoworkerId || triggerCoworker.isPending) {
      return;
    }

    try {
      const result = await triggerCoworker.mutateAsync({
        id: resolvedCoworkerId,
        payload: {},
      });
      toast.success(result.generationId ? "Run started." : "Needs your input.");
      void navigate({
        to: "/prototype/coworker/info/$slug",
        params: { slug: resolvedCoworkerSlug },
      });
    } catch (error) {
      toast.error(normalizeGenerationError(error, "start_rpc").message);
    }
  }, [navigate, resolvedCoworkerId, resolvedCoworkerSlug, triggerCoworker]);

  if (isRunLoading) {
    return <LoadingState />;
  }

  if (!resolvedCoworkerId || (!run.data && !coworkerRuns.data?.length)) {
    return (
      <main className="flex min-h-[24rem] items-center justify-center p-6">
        <div className="border-border bg-card max-w-md rounded-xl border p-5 text-center">
          <AlertCircle className="text-muted-foreground mx-auto mb-3 h-5 w-5" />
          <p className="text-sm font-medium">
            {resolvedCoworkerId ? "No runs yet" : "Coworker not found"}
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {resolvedCoworkerId
              ? "Start a run from the coworker page to populate this prototype."
              : "This prototype expects the dynamic segment to be the coworker slug."}
          </p>
        </div>
      </main>
    );
  }

  const coworkerName =
    coworker.data?.name || coworkerListItem?.name || run.data?.coworkerName || "Coworker";
  const coworkerUsername =
    coworker.data?.username ?? coworkerListItem?.username ?? run.data?.coworkerUsername;
  const runLabel = coworkerUsername ? `@${coworkerUsername}` : coworkerName;
  const coworkerDescription =
    coworker.data?.description?.trim() || coworkerListItem?.description?.trim();
  const startedAt = formatRunDate(run.data?.startedAt ?? coworkerRuns.data?.[0]?.startedAt);

  return (
    <main className="bg-background min-h-dvh">
      <section className="border-border/80 bg-background/95 sticky top-0 z-10 border-b px-4 py-4 backdrop-blur-sm md:px-6">
        <div className="mx-auto flex max-w-[92rem] flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                  getStatusClassName(run.data?.status ?? coworkerRuns.data?.[0]?.status),
                )}
              >
                {run.data?.status ?? coworkerRuns.data?.[0]?.status}
              </span>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Clock className="h-3.5 w-3.5" />
                Launched {startedAt}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link href={`/agents/edit/${resolvedCoworkerId}`}>
                  <Pencil className="h-4 w-4" />
                  Configure
                </Link>
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    <History className="h-4 w-4" />
                    History
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-2">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">Previous runs</p>
                    <p className="text-muted-foreground text-xs">
                      Switch the page to an older run.
                    </p>
                  </div>
                  <div className="mt-1 max-h-80 space-y-1 overflow-auto">
                    {(coworkerRuns.data ?? []).map((historyRun) => (
                      <HistoryRunButton
                        key={historyRun.id}
                        run={historyRun}
                        selected={historyRun.id === selectedRunId}
                        onSelect={handleHistorySelect}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <CoworkerAvatar username={coworkerUsername} size={56} className="rounded-xl" />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl leading-tight font-semibold md:text-2xl">
                    {coworkerName}
                  </h1>
                  {coworkerUsername ? (
                    <span className="bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[11px]">
                      {runLabel}
                    </span>
                  ) : null}
                </div>
                {coworkerDescription ? (
                  <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-relaxed">
                    {coworkerDescription}
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
                    No description set.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={handleRunNow}
                disabled={triggerCoworker.isPending}
              >
                {triggerCoworker.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run now
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-[92rem] flex-col gap-4 p-4 md:p-6">
        <RemoteRunSourceBanner source={remoteRunSource} />

        {(run.data?.status === "error" || run.data?.status === "cancelled") && (
          <section className="border-border bg-card rounded-xl border p-4">
            <p className="text-muted-foreground text-sm">
              {run.data.status === "cancelled"
                ? (run.data.errorMessage ?? "Run cancelled.")
                : (run.data.errorMessage ?? "Run failed.")}
            </p>
            <RunDebugDetails
              debugInfo={run.data.debugInfo}
              fallbackTimestamp={run.data.finishedAt ?? run.data.startedAt}
            />
          </section>
        )}

        <section className="grid min-h-[calc(100dvh-13rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="border-border bg-card min-h-[34rem] overflow-hidden rounded-xl border">
            {outputFile ? (
              <AgenticAppFrame outputFile={outputFile} />
            ) : (
              <EmptyPreview latestMessage={latestCoworkerMessage} runStatus={run.data?.status} />
            )}
          </div>

          <aside className="border-border bg-card flex min-h-[28rem] flex-col overflow-hidden rounded-xl border">
            <div className="border-border/80 flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <MessageSquareText className="text-muted-foreground h-4 w-4" />
              <p className="truncate text-sm font-medium">Run chat</p>
              {conversation.isFetching ? (
                <Loader2 className="text-muted-foreground ml-auto h-3.5 w-3.5 animate-spin" />
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {conversation.isLoading ? (
                <LoadingState />
              ) : messages.length > 0 ? (
                <MessageList messages={messages} />
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
                  No linked chat messages.
                </div>
              )}
            </div>
          </aside>
        </section>

        {run.data ? (
          <div className="flex justify-end pb-6">
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`/agents/runs/${run.data.id}`}>Open current run view</a>
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
