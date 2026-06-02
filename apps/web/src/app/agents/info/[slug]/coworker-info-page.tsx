"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  FileText,
  History,
  Loader2,
  MessageSquareText,
  Pencil,
  Play,
  RefreshCw,
  Timer,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ChatArea } from "@/components/chat/chat-area";
import { MessageBubble } from "@/components/chat/message-bubble";
import { findLatestOutputHtmlFile } from "@/components/chat/output-preview-selection";
import { mapPersistedMessagesToChatMessages } from "@/components/chat/persisted-message-mapper";
import type { Message, MessagePart, SandboxFileData } from "@/components/chat/message-list";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { RunDebugDetails } from "@/components/coworkers/run-debug-details";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { Button } from "@/components/ui/button";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AnimatedTab, AnimatedTabs } from "@/components/ui/tabs";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { cn } from "@/lib/utils";
import {
  useConversation,
  useCoworker,
  useCoworkerList,
  useCoworkerRun,
  useCoworkerRuns,
  useDownloadSandboxFile,
  useOutputHtmlPreview,
  useTriggerCoworker,
} from "@/orpc/hooks";

type Props = {
  coworkerSlug: string;
};

type InfoTab = "summary" | "chat";

type HistoryRunItem = {
  id: string;
  status: string;
  startedAt?: Date | string | null;
};

type RunEventSummary = {
  type: string;
  payload: unknown;
};

type ToolSummaryItem = {
  name: string;
  count: number;
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
  if (
    status === "running" ||
    status === "awaiting_approval" ||
    status === "awaiting_auth" ||
    status === "needs_user_input"
  ) {
    return "border-brand-muted bg-brand-light text-brand-dark";
  }
  if (status === "error" || status === "cancelled") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  return "border-border bg-muted text-muted-foreground";
}

function isCompletedStatus(status?: string | null) {
  return status === "completed" || status === "success";
}

function getInfoTab(value: string | null): InfoTab {
  return value === "chat" ? "chat" : "summary";
}

function toDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(startedAt?: Date | string | null, finishedAt?: Date | string | null) {
  const start = toDate(startedAt);
  if (!start) {
    return "Not available";
  }

  const finish = toDate(finishedAt) ?? new Date();
  const durationMs = Math.max(0, finish.getTime() - start.getTime());
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatFileSize(sizeBytes?: number | null) {
  if (!sizeBytes) {
    return "size unknown";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readableToolName(part: MessagePart) {
  if (part.type === "tool_call") {
    if (part.integration && part.operation) {
      return `${part.integration}.${part.operation}`;
    }
    return part.name;
  }
  if (part.type === "approval") {
    if (part.integration && part.operation) {
      return `${part.integration}.${part.operation}`;
    }
    return part.toolName;
  }
  return null;
}

function getPayloadRecord(payload: unknown) {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function getEventToolName(event: RunEventSummary) {
  if (event.type !== "tool_use" && event.type !== "tool_result") {
    return null;
  }

  const payload = getPayloadRecord(event.payload);
  if (!payload) {
    return null;
  }

  const toolName = payload.toolName ?? payload.tool_name ?? payload.name;
  return typeof toolName === "string" && toolName.trim() ? toolName.trim() : null;
}

function collectToolSummary(messages: Message[], events?: RunEventSummary[]): ToolSummaryItem[] {
  const counts = new Map<string, number>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const name = readableToolName(part);
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) {
    for (const event of events ?? []) {
      const name = getEventToolName(event);
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function collectSandboxFiles(messages: Message[]) {
  const files = new Map<string, SandboxFileData>();

  for (const message of messages) {
    for (const file of message.sandboxFiles ?? []) {
      files.set(file.fileId, file);
    }
  }

  return Array.from(files.values()).toSorted((left, right) =>
    left.filename.localeCompare(right.filename),
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[24rem] items-center justify-center">
      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
    </div>
  );
}

function EmptyPreview({ latestMessage }: { latestMessage?: string }) {
  if (latestMessage?.trim()) {
    return (
      <div className="bg-background h-full overflow-auto p-5">
        <div className="mx-auto max-w-3xl">
          <div className="border-border/70 mb-4 flex h-11 items-center gap-2 border-b">
            <MessageSquareText className="text-muted-foreground h-4 w-4" />
            <p className="text-sm font-medium">Latest coworker message</p>
          </div>
          <MessageBubble role="assistant" content={latestMessage} />
        </div>
      </div>
    );
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

function OutputHtmlFrame({ outputFile }: { outputFile: SandboxFileData }) {
  const preview = useOutputHtmlPreview(outputFile.fileId);
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
          aria-label="Refresh output preview"
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
              <p className="text-sm font-medium">Preview unavailable</p>
              <p className="text-muted-foreground text-xs">
                Download output.html to inspect the generated file.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            title="output.html preview"
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={preview.data?.html ?? ""}
          />
        )}
      </div>
    </div>
  );
}

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

function RunSummaryPanel({
  status,
  startedAt,
  finishedAt,
  events,
  messages,
}: {
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  events?: RunEventSummary[];
  messages: Message[];
}) {
  const completed = isCompletedStatus(status);
  const tools = useMemo(() => collectToolSummary(messages, events), [events, messages]);
  const files = useMemo(() => collectSandboxFiles(messages), [messages]);
  const duration = useMemo(() => formatDuration(startedAt, finishedAt), [finishedAt, startedAt]);

  return (
    <div className="space-y-5 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="border-border/70 rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Status
          </div>
          <p className="mt-2 truncate text-sm font-medium">
            {completed ? "Completed" : (status ?? "Unknown")}
          </p>
        </div>
        <div className="border-border/70 rounded-lg border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Timer className="h-3.5 w-3.5" />
            Time taken
          </div>
          <p className="mt-2 truncate text-sm font-medium">{duration}</p>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Wrench className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">Tools used</h2>
        </div>
        {tools.length > 0 ? (
          <div className="space-y-1.5">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="border-border/70 flex items-center justify-between gap-3 rounded-md border px-2.5 py-2"
              >
                <span className="min-w-0 truncate font-mono text-xs">{tool.name}</span>
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[11px]">
                  {tool.count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            No tool usage recorded for this Generation.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">Output files</h2>
        </div>
        {files.length > 0 ? (
          <div className="space-y-1.5">
            {files.map((file) => (
              <div key={file.fileId} className="border-border/70 rounded-md border px-2.5 py-2">
                <p className="truncate text-xs font-medium">{file.filename}</p>
                <p className="text-muted-foreground mt-1 truncate text-[11px]">
                  {formatFileSize(file.sizeBytes)} · {file.path}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            No output files were created by this Generation.
          </p>
        )}
      </section>
    </div>
  );
}

function OutputPanel({
  outputFile,
  latestCoworkerMessage,
}: {
  outputFile?: SandboxFileData | null;
  latestCoworkerMessage?: string;
}) {
  return outputFile ? (
    <OutputHtmlFrame outputFile={outputFile} />
  ) : (
    <EmptyPreview latestMessage={latestCoworkerMessage} />
  );
}

function RunDetailsPanel({
  activeTab,
  onTabChange,
  isFetchingConversation,
  run,
  messages,
  conversationId,
}: {
  activeTab: InfoTab;
  onTabChange: (nextTab: string) => void;
  isFetchingConversation: boolean;
  run: {
    status?: string | null;
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
    events?: RunEventSummary[];
  };
  messages: Message[];
  conversationId?: string;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-border/80 flex min-h-12 shrink-0 flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <AnimatedTabs activeKey={activeTab} onTabChange={onTabChange}>
          <AnimatedTab value="summary">Summary</AnimatedTab>
          <AnimatedTab value="chat">Chat</AnimatedTab>
        </AnimatedTabs>
        {activeTab === "chat" && isFetchingConversation ? (
          <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "summary" ? (
          <div className="h-full overflow-auto">
            <RunSummaryPanel
              status={run.status}
              startedAt={run.startedAt}
              finishedAt={run.finishedAt}
              events={run.events}
              messages={messages}
            />
          </div>
        ) : conversationId ? (
          <div className="flex h-full min-h-0 overflow-hidden">
            <ChatArea conversationId={conversationId} />
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
            No linked chat messages.
          </div>
        )}
      </div>
    </aside>
  );
}

export function CoworkerInfoPage({ coworkerSlug }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const activeTab = getInfoTab(searchParams.get("tab"));
  const isRunLoading =
    coworkerList.isLoading || coworkerRuns.isLoading || Boolean(selectedRunId && run.isLoading);
  const conversationId = run.data?.conversationId ?? undefined;
  const conversation = useConversation(conversationId);

  const messages = useMemo(
    () => mapPersistedMessagesToChatMessages(conversation.data?.messages ?? []),
    [conversation.data?.messages],
  );
  const outputFile = useMemo(() => findLatestOutputHtmlFile(messages), [messages]);
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
  const detailsRun = useMemo(
    () => ({
      status: run.data?.status,
      startedAt: run.data?.startedAt,
      finishedAt: run.data?.finishedAt,
      events: run.data?.events,
    }),
    [run.data?.events, run.data?.finishedAt, run.data?.startedAt, run.data?.status],
  );
  const outputPanel = useMemo(
    () => <OutputPanel outputFile={outputFile} latestCoworkerMessage={latestCoworkerMessage} />,
    [latestCoworkerMessage, outputFile],
  );

  const handleHistorySelect = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("run", runId);
      router.push(`/agents/info/${resolvedCoworkerSlug}?${params.toString()}`);
    },
    [resolvedCoworkerSlug, router, searchParams],
  );

  const handleTabChange = useCallback(
    (nextTab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const infoTab = getInfoTab(nextTab);
      if (infoTab === "summary") {
        params.delete("tab");
      } else {
        params.set("tab", infoTab);
      }
      const query = params.toString();
      router.push(`/agents/info/${resolvedCoworkerSlug}${query ? `?${query}` : ""}`);
    },
    [resolvedCoworkerSlug, router, searchParams],
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
      toast.success(result.generationId ? "Generation started." : "Needs your input.");
      router.push(`/agents/info/${resolvedCoworkerSlug}`);
    } catch (error) {
      toast.error(normalizeGenerationError(error, "start_rpc").message);
    }
  }, [resolvedCoworkerId, resolvedCoworkerSlug, router, triggerCoworker]);

  const detailsPanel = useMemo(
    () => (
      <RunDetailsPanel
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isFetchingConversation={conversation.isFetching}
        run={detailsRun}
        messages={messages}
        conversationId={conversationId}
      />
    ),
    [activeTab, conversation.isFetching, conversationId, detailsRun, handleTabChange, messages],
  );

  if (isRunLoading) {
    return <LoadingState />;
  }

  if (!resolvedCoworkerId) {
    return (
      <main className="flex min-h-[24rem] items-center justify-center p-6">
        <div className="border-border bg-card max-w-md rounded-xl border p-5 text-center">
          <AlertCircle className="text-muted-foreground mx-auto mb-3 h-5 w-5" />
          <p className="text-sm font-medium">Coworker not found</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Use a coworker id or username in the page URL.
          </p>
        </div>
      </main>
    );
  }

  if (!run.data && !coworkerRuns.data?.length) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <Button
          type="button"
          onClick={handleRunNow}
          disabled={triggerCoworker.isPending}
          className="bg-foreground text-background hover:bg-foreground/90 inline-flex h-10 items-center justify-center rounded-lg px-6 text-sm font-medium transition-colors"
        >
          {triggerCoworker.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run now
        </Button>
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
  const status = run.data?.status ?? coworkerRuns.data?.[0]?.status;
  const startedAt = formatRunDate(run.data?.startedAt ?? coworkerRuns.data?.[0]?.startedAt);

  return (
    <main className="bg-background flex h-dvh min-h-0 flex-col overflow-hidden">
      <section className="border-border/80 bg-background/95 z-10 shrink-0 border-b px-4 py-4 backdrop-blur-sm md:px-6">
        <div className="mx-auto flex max-w-[92rem] flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {status ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    getStatusClassName(status),
                  )}
                >
                  {status}
                </span>
              ) : null}
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Clock className="h-3.5 w-3.5" />
                Launched {startedAt}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link
                  href={getCoworkerEditHref({
                    id: resolvedCoworkerId,
                    username: coworkerUsername,
                  })}
                >
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
                    <p className="text-sm font-medium">Previous Generations</p>
                    <p className="text-muted-foreground text-xs">
                      Switch this page to an older Generation.
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

            <Button
              type="button"
              variant="brand"
              size="sm"
              onClick={handleRunNow}
              disabled={triggerCoworker.isPending}
              className="w-fit"
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
      </section>

      <div className="mx-auto flex min-h-0 w-full max-w-[92rem] flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
        <RemoteRunSourceBanner source={remoteRunSource} />

        {(run.data?.status === "error" || run.data?.status === "cancelled") && (
          <section className="border-border bg-card rounded-xl border p-4">
            <p className="text-muted-foreground text-sm">
              {run.data.status === "cancelled"
                ? (run.data.errorMessage ?? "Generation cancelled.")
                : (run.data.errorMessage ?? "Generation failed.")}
            </p>
            <RunDebugDetails
              debugInfo={run.data.debugInfo}
              fallbackTimestamp={run.data.finishedAt ?? run.data.startedAt}
            />
          </section>
        )}

        <DualPanelWorkspace
          storageKey="agent-info-output-details-width-v1"
          defaultRightWidth={32}
          minLeftWidth={40}
          minRightWidth={24}
          showTitles={false}
          leftTitle="Output"
          rightTitle="Details"
          leftPanelClassName="bg-card rounded-xl"
          rightPanelClassName="bg-card rounded-xl"
          separatorClassName="bg-muted/40"
          left={outputPanel}
          right={detailsPanel}
        />

        {run.data ? (
          <div className="shrink-0 self-end">
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`/agents/runs/${run.data.id}`}>Open current Generation</a>
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
