import { T, useGT } from "gt-react";
import {
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  FileText,
  Loader2,
  Maximize2,
  MessageSquareText,
  RefreshCw,
  Timer,
  Wrench,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { Message, MessagePart, SandboxFileData } from "@/components/chat/message-list";
import { useAgenticAppPromptBridge } from "@/components/chat/use-agentic-app-prompt-bridge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnimatedTab, AnimatedTabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAgenticAppHtml, useDownloadSandboxFile } from "@/orpc/hooks/conversation";
import { useSendAgenticAppPrompt } from "@/orpc/hooks/generation";

export type InfoTab = "summary" | "chat";
export type MobilePanel = "app" | InfoTab;

export const MOBILE_PANEL_ORDER: MobilePanel[] = ["summary", "app", "chat"];
export const MOBILE_PANEL_SWIPE_THRESHOLD = 48;
export const MOBILE_PANEL_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
export const MOBILE_PANEL_VARIANTS = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? 32 : -32,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? -32 : 32,
  }),
} as const;

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

export function getInfoTab(value: string | null): InfoTab {
  return value === "chat" ? "chat" : "summary";
}

export function getMobilePanel(value: string): MobilePanel {
  return value === "summary" || value === "chat" ? value : "app";
}

export function getAdjacentMobilePanel(current: MobilePanel, direction: "next" | "previous") {
  const currentIndex = MOBILE_PANEL_ORDER.indexOf(current);
  const nextIndex =
    direction === "next"
      ? Math.min(MOBILE_PANEL_ORDER.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);

  return MOBILE_PANEL_ORDER[nextIndex] ?? current;
}

export function isUuidRouteSlug(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

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

function isCompletedStatus(status?: string | null) {
  return status === "completed" || status === "success";
}

function isInProgressStatus(status?: string | null) {
  return status === "running";
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

export function LoadingState() {
  return (
    <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      <p className="text-muted-foreground text-sm">
        <T>Generating output ...</T>
      </p>
    </div>
  );
}

function formatErrorMessage(message?: string | null, fallback = "Run failed.") {
  const trimmed = message?.trim();
  if (!trimmed) {
    return `Error : ${fallback}`;
  }
  return trimmed.startsWith("Error :") ? trimmed : `Error : ${trimmed}`;
}

function EmptyPreview({
  latestMessage,
  runStatus,
  errorMessage,
}: {
  latestMessage?: string;
  runStatus?: string | null;
  errorMessage?: string | null;
}) {
  if (runStatus === "error" || runStatus === "cancelled") {
    const fallback = runStatus === "cancelled" ? "Run cancelled." : "Run failed.";

    return (
      <div className="bg-background h-full overflow-auto p-5">
        <div className="mx-auto max-w-3xl rounded-xl border border-red-300 bg-red-50/80 p-4">
          <div className="mb-3 flex items-center gap-2 border-b border-red-200 pb-3">
            <MessageSquareText className="h-4 w-4 text-red-600" />
            <p className="text-sm font-medium text-red-700">
              <T>Error</T>
            </p>
          </div>
          <MessageBubble
            messageRole="assistant"
            content={formatErrorMessage(errorMessage, fallback)}
          />
        </div>
      </div>
    );
  }

  if (latestMessage?.trim()) {
    return (
      <div className="bg-background h-full overflow-auto p-5">
        <div className="mx-auto max-w-3xl">
          <div className="border-border/70 mb-4 flex h-11 items-center gap-2 border-b">
            <MessageSquareText className="text-muted-foreground h-4 w-4" />
            <p className="text-sm font-medium">
              <T>Latest coworker message</T>
            </p>
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
        <p className="text-sm font-medium">
          <T>No output.html found</T>
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          <T>The linked conversation has not produced an output.html artifact yet.</T>
        </p>
      </div>
    </div>
  );
}

function AgenticAppFrame({
  outputFile,
  onSendPrompt,
  showToolbar = true,
}: {
  outputFile: SandboxFileData;
  onSendPrompt: (prompt: string) => Promise<unknown> | unknown;
  showToolbar?: boolean;
}) {
  const t = useGT();

  const preview = useAgenticAppHtml(outputFile.fileId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloading } = useDownloadSandboxFile();
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const {
    iframeRef: inlineIframeRef,
    handleIframeLoad: handleInlineIframeLoad,
    recordGesture: recordInlineGesture,
  } = useAgenticAppPromptBridge({
    outputFileId: outputFile.fileId,
    onSendPrompt,
  });
  const {
    iframeRef: fullscreenIframeRef,
    handleIframeLoad: handleFullscreenIframeLoad,
    recordGesture: recordFullscreenGesture,
  } = useAgenticAppPromptBridge({
    outputFileId: outputFile.fileId,
    onSendPrompt,
  });

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
  const handleOpenFullscreen = useCallback(() => {
    setFullscreenOpen(true);
  }, []);

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      onPointerDownCapture={recordInlineGesture}
      onPointerMoveCapture={recordInlineGesture}
      onKeyDownCapture={recordInlineGesture}
    >
      {showToolbar ? (
        <div className="border-border/70 flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <FileCode2 className="text-muted-foreground h-4 w-4" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            <T>output.html</T>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleRefresh}
            disabled={preview.isFetching}
            aria-label={t("Refresh Agentic-App")}
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
            aria-label={t("Download output.html")}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : null}
      <div className="bg-muted/30 relative min-h-0 flex-1">
        {preview.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : preview.isError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              <p className="text-sm font-medium">
                <T>Agentic-App unavailable</T>
              </p>
              <p className="text-muted-foreground text-xs">
                {showToolbar
                  ? "Download output.html to inspect the generated file."
                  : "The generated Agentic-App could not be loaded."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="bg-background/90 absolute top-3 right-3 z-10 hidden h-8 w-8 border shadow-sm md:inline-flex"
              onClick={handleOpenFullscreen}
              aria-label={t("Open Agentic-App fullscreen")}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <iframe
              ref={inlineIframeRef}
              title={t("output.html Agentic-App")}
              className="bg-background h-full w-full border-0"
              sandbox="allow-scripts allow-forms"
              srcDoc={preview.data?.html ?? ""}
              onLoad={handleInlineIframeLoad}
              onPointerDownCapture={recordInlineGesture}
              onPointerMoveCapture={recordInlineGesture}
              onKeyDownCapture={recordInlineGesture}
            />
          </>
        )}
      </div>
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent
          className="h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none gap-0 overflow-hidden p-0 sm:rounded-xl"
          showCloseButton
          onPointerDownCapture={recordFullscreenGesture}
          onPointerMoveCapture={recordFullscreenGesture}
          onKeyDownCapture={recordFullscreenGesture}
        >
          <DialogTitle className="sr-only">
            <T>output.html Agentic-App fullscreen</T>
          </DialogTitle>
          <DialogDescription className="sr-only">
            <T>Fullscreen view of the generated output.html file.</T>
          </DialogDescription>
          <iframe
            ref={fullscreenIframeRef}
            title={t("output.html Agentic-App fullscreen")}
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={preview.data?.html ?? ""}
            onLoad={handleFullscreenIframeLoad}
            onPointerDownCapture={recordFullscreenGesture}
            onPointerMoveCapture={recordFullscreenGesture}
            onKeyDownCapture={recordFullscreenGesture}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function HistoryRunButton({
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

export function RunSummaryPanel({
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
  const launched = useMemo(() => formatRunDate(startedAt), [startedAt]);

  return (
    <div className="space-y-5 p-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="border-border/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <CheckCircle2 className={cn("h-3 w-3", completed && "text-emerald-600")} />
            <T>Status</T>
          </div>
          <p className={cn("mt-0.5 truncate text-sm font-medium", completed && "text-emerald-700")}>
            {completed ? "Completed" : (status ?? "Unknown")}
          </p>
        </div>
        <div className="border-border/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Clock className="h-3 w-3" />
            <T>Launched</T>
          </div>
          <p className="mt-0.5 truncate text-sm font-medium">{launched}</p>
        </div>
        <div className="border-border/70 rounded-md border px-2.5 py-1.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Timer className="h-3 w-3" />
            <T>Time taken</T>
          </div>
          <p className="mt-0.5 truncate text-sm font-medium">{duration}</p>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Wrench className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">
            <T>Tools used</T>
          </h2>
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
            <T>No tool usage recorded for this run.</T>
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">
            <T>Output files</T>
          </h2>
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
            <T>No output files were created by this run.</T>
          </p>
        )}
      </section>
    </div>
  );
}

export function OutputPanel({
  outputFile,
  conversationId,
  latestCoworkerMessage,
  runStatus,
  runErrorMessage,
  showOutputToolbar = true,
}: {
  outputFile?: SandboxFileData | null;
  conversationId?: string;
  latestCoworkerMessage?: string;
  runStatus?: string | null;
  runErrorMessage?: string | null;
  showOutputToolbar?: boolean;
}) {
  const sendAgenticAppPrompt = useSendAgenticAppPrompt(conversationId);

  return outputFile ? (
    <AgenticAppFrame
      key={outputFile.fileId}
      outputFile={outputFile}
      onSendPrompt={sendAgenticAppPrompt}
      showToolbar={showOutputToolbar}
    />
  ) : (
    <EmptyPreview
      latestMessage={latestCoworkerMessage}
      runStatus={runStatus}
      errorMessage={runErrorMessage}
    />
  );
}

export function RunDetailsPanel({
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
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-12 min-w-0 shrink-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <AnimatedTabs activeKey={activeTab} onTabChange={onTabChange}>
          <AnimatedTab value="summary">
            <T>Summary</T>
          </AnimatedTab>
          <AnimatedTab value="chat">
            <T>Chat</T>
          </AnimatedTab>
        </AnimatedTabs>
        {activeTab === "chat" && isFetchingConversation ? (
          <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <T>Updating</T>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeTab === "summary" ? (
          <div className="h-full min-w-0 overflow-auto">
            <RunSummaryPanel
              status={run.status}
              startedAt={run.startedAt}
              finishedAt={run.finishedAt}
              events={run.events}
              messages={messages}
            />
          </div>
        ) : conversationId ? (
          <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
            <ChatArea conversationId={conversationId} compact />
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
            <T>No linked chat messages.</T>
          </div>
        )}
      </div>
    </aside>
  );
}
