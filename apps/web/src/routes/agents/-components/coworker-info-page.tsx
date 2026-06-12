import { useNavigate, useRouterState } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  FileText,
  History,
  Info,
  Loader2,
  Maximize2,
  MessageSquareText,
  Pencil,
  Play,
  RefreshCw,
  Timer,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Message, MessagePart, SandboxFileData } from "@/components/chat/message-list";
import { ChatArea } from "@/components/chat/chat-area";
import { MessageBubble } from "@/components/chat/message-bubble";
import { findLatestAgenticAppFile } from "@/components/chat/agentic-app-selection";
import { mapPersistedMessagesToChatMessages } from "@/components/chat/persisted-message-mapper";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { RunDebugDetails } from "@/components/coworkers/run-debug-details";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AnimatedTab, AnimatedTabs } from "@/components/ui/tabs";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
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
import { AppLink as Link } from "../-lib/app-link";

type Props = {
  coworkerSlug: string;
};

type InfoTab = "summary" | "chat";
type MobilePanel = "app" | InfoTab;

const MOBILE_PANEL_ORDER: MobilePanel[] = ["summary", "app", "chat"];
const MOBILE_PANEL_SWIPE_THRESHOLD = 48;
const MOBILE_PANEL_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
const MOBILE_PANEL_VARIANTS = {
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

function isCompletedStatus(status?: string | null) {
  return status === "completed" || status === "success";
}

function getInfoTab(value: string | null): InfoTab {
  return value === "chat" ? "chat" : "summary";
}

function getMobilePanel(value: string): MobilePanel {
  return value === "summary" || value === "chat" ? value : "app";
}

function getAdjacentMobilePanel(current: MobilePanel, direction: "next" | "previous") {
  const currentIndex = MOBILE_PANEL_ORDER.indexOf(current);
  const nextIndex =
    direction === "next"
      ? Math.min(MOBILE_PANEL_ORDER.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);

  return MOBILE_PANEL_ORDER[nextIndex] ?? current;
}

function isUuidRouteSlug(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
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
            <p className="text-sm font-medium">
              <T>Latest coworker message</T>
            </p>
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
  showToolbar = true,
}: {
  outputFile: SandboxFileData;
  showToolbar?: boolean;
}) {
  const t = useGT();

  const preview = useAgenticAppHtml(outputFile.fileId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloading } = useDownloadSandboxFile();
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

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
    <div className="bg-background flex h-full min-h-0 flex-col">
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
              title={t("output.html Agentic-App")}
              className="bg-background h-full w-full border-0"
              sandbox="allow-scripts allow-forms"
              srcDoc={preview.data?.html ?? ""}
            />
          </>
        )}
      </div>
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent
          className="h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none gap-0 overflow-hidden p-0 sm:rounded-xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">
            <T>output.html Agentic-App fullscreen</T>
          </DialogTitle>
          <DialogDescription className="sr-only">
            <T>Fullscreen view of the generated output.html file.</T>
          </DialogDescription>
          <iframe
            title={t("output.html Agentic-App fullscreen")}
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={preview.data?.html ?? ""}
          />
        </DialogContent>
      </Dialog>
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
            <T>No tool usage recorded for this Generation.</T>
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
            <T>No output files were created by this Generation.</T>
          </p>
        )}
      </section>
    </div>
  );
}

function OutputPanel({
  outputFile,
  latestCoworkerMessage,
  showOutputToolbar = true,
}: {
  outputFile?: SandboxFileData | null;
  latestCoworkerMessage?: string;
  showOutputToolbar?: boolean;
}) {
  return outputFile ? (
    <AgenticAppFrame outputFile={outputFile} showToolbar={showOutputToolbar} />
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
      <div className="flex min-h-12 shrink-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
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

export function CoworkerInfoPage({ coworkerSlug }: Props) {
  const t = useGT();

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
  const routeCoworkerId = isUuidRouteSlug(coworkerSlug) ? coworkerSlug : undefined;
  const resolvedCoworkerId = coworkerListItem?.id ?? routeCoworkerId;
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
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(() =>
    getMobilePanel(searchParams.get("tab") ?? "app"),
  );
  const [mobilePanelDirection, setMobilePanelDirection] = useState(0);
  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const handleDefinitionOpenChange = useCallback((open: boolean) => {
    setDefinitionOpen(open);
  }, []);
  const handleOpenDefinition = useCallback(() => {
    setDefinitionOpen(true);
  }, []);
  const handleToggleDefinition = useCallback(() => {
    setDefinitionOpen((open) => !open);
  }, []);
  const shouldWaitForCoworkerList = !routeCoworkerId;
  const shouldWaitForCoworkerRuns =
    Boolean(requestedRunId) || (coworkerListItem?.recentRuns?.length ?? 0) > 0;
  const isRunLoading =
    (shouldWaitForCoworkerList && coworkerList.isLoading) ||
    (shouldWaitForCoworkerRuns && coworkerRuns.isLoading) ||
    Boolean(selectedRunId && run.isLoading);
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
    () => (
      <OutputPanel
        outputFile={outputFile}
        latestCoworkerMessage={latestCoworkerMessage}
        showOutputToolbar={false}
      />
    ),
    [latestCoworkerMessage, outputFile],
  );

  const handleHistorySelect = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("run", runId);
      void navigate({
        to: "/agents/info/$slug",
        params: { slug: resolvedCoworkerSlug },
        search: {
          run: params.get("run") ?? undefined,
          tab: params.get("tab") ?? undefined,
        },
      });
    },
    [navigate, resolvedCoworkerSlug, searchParams],
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
      void navigate({
        to: "/agents/info/$slug",
        params: { slug: resolvedCoworkerSlug },
        search: {
          run: params.get("run") ?? undefined,
          tab: params.get("tab") ?? undefined,
        },
      });
    },
    [navigate, resolvedCoworkerSlug, searchParams],
  );

  const handleMobilePanelChange = useCallback(
    (nextPanelValue: string) => {
      const nextPanel = getMobilePanel(nextPanelValue);
      const currentIndex = MOBILE_PANEL_ORDER.indexOf(mobilePanel);
      const nextIndex = MOBILE_PANEL_ORDER.indexOf(nextPanel);
      setMobilePanelDirection(Math.sign(nextIndex - currentIndex));
      setMobilePanel(nextPanel);

      const params = new URLSearchParams(searchParams.toString());
      if (nextPanel === "app") {
        params.delete("tab");
      } else {
        params.set("tab", nextPanel);
      }
      void navigate({
        to: "/agents/info/$slug",
        params: { slug: resolvedCoworkerSlug },
        search: {
          run: params.get("run") ?? undefined,
          tab: params.get("tab") ?? undefined,
        },
      });
    },
    [mobilePanel, navigate, resolvedCoworkerSlug, searchParams],
  );
  const handleMobilePanelPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);

    mobileSwipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);
  const handleMobilePanelPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = mobileSwipeStartRef.current;
      mobileSwipeStartRef.current = null;

      if (!start) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (
        Math.abs(deltaX) < MOBILE_PANEL_SWIPE_THRESHOLD ||
        Math.abs(deltaX) < Math.abs(deltaY) * 1.2
      ) {
        return;
      }

      handleMobilePanelChange(
        getAdjacentMobilePanel(mobilePanel, deltaX < 0 ? "next" : "previous"),
      );
    },
    [handleMobilePanelChange, mobilePanel],
  );
  const handleMobilePanelPointerCancel = useCallback(() => {
    mobileSwipeStartRef.current = null;
  }, []);
  const handleSummaryPanelClick = useCallback(() => {
    handleMobilePanelChange("summary");
  }, [handleMobilePanelChange]);
  const handleAppPanelClick = useCallback(() => {
    handleMobilePanelChange("app");
  }, [handleMobilePanelChange]);
  const handleChatPanelClick = useCallback(() => {
    handleMobilePanelChange("chat");
  }, [handleMobilePanelChange]);

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
      void navigate({ to: "/agents/info/$slug", params: { slug: resolvedCoworkerSlug } });
    } catch (error) {
      toast.error(normalizeGenerationError(error, "start_rpc").message);
    }
  }, [navigate, resolvedCoworkerId, resolvedCoworkerSlug, triggerCoworker]);

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
          <p className="text-sm font-medium">
            <T>Coworker not found</T>
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            <T>Use a coworker id or username in the page URL.</T>
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
          <T>Run now</T>
        </Button>
      </main>
    );
  }

  const coworkerName =
    coworker.data?.name || coworkerListItem?.name || run.data?.coworkerName || "Coworker";
  const coworkerUsername =
    coworker.data?.username ?? coworkerListItem?.username ?? run.data?.coworkerUsername;
  const coworkerDefinition =
    coworker.data?.description?.trim() || coworkerListItem?.description?.trim();

  return (
    <main className="bg-background flex h-[calc(100dvh-4rem-var(--safe-area-inset-bottom))] min-h-0 flex-col overflow-hidden md:h-dvh">
      <section className="bg-background/95 z-10 hidden shrink-0 px-3 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 backdrop-blur-sm md:block md:px-6 md:py-3">
        <div className="flex min-h-10 items-center gap-2 md:gap-4">
          <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-visible">
              <CoworkerAvatar
                username={coworkerUsername}
                size={44}
                scale={82}
                className="rounded-none"
              />
            </div>
            <h1 className="truncate text-base leading-tight font-semibold md:text-lg">
              {coworkerName}
            </h1>
            <Popover open={definitionOpen} onOpenChange={handleDefinitionOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
                  onMouseEnter={handleOpenDefinition}
                  onClick={handleToggleDefinition}
                  aria-label={t("Show coworker definition")}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-3">
                <p className="text-sm font-medium">
                  <T>Coworker definition</T>
                </p>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {coworkerDefinition || "No definition set."}
                </p>
              </PopoverContent>
            </Popover>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:w-auto md:px-3"
              asChild
            >
              <Link
                href={getCoworkerEditHref({
                  id: resolvedCoworkerId,
                  username: coworkerUsername,
                })}
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden md:inline">
                  <T>Configure</T>
                </span>
              </Link>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:w-auto md:px-3"
                >
                  <History className="h-4 w-4" />
                  <span className="hidden md:inline">
                    <T>History</T>
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">
                    <T>Previous Generations</T>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    <T>Switch this page to an older Generation.</T>
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
            <Button
              type="button"
              variant="brand"
              size="icon"
              onClick={handleRunNow}
              disabled={triggerCoworker.isPending}
              className="h-8 w-8 shrink-0 md:w-auto md:px-3"
            >
              {triggerCoworker.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="hidden md:inline">
                <T>Run now</T>
              </span>
            </Button>
          </div>
        </div>
      </section>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden px-0 pt-[max(0.25rem,var(--safe-area-inset-top))] pb-0 md:gap-4 md:px-6 md:pt-3 md:pb-6">
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

        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <div
            role="tablist"
            className="border-border bg-background grid shrink-0 grid-cols-3 border-b"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mobilePanel === "summary"}
              onClick={handleSummaryPanelClick}
              className={cn(
                "relative flex h-12 items-center justify-center text-sm font-medium transition-colors",
                mobilePanel === "summary"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <T>Summary</T>
              {mobilePanel === "summary" ? (
                <span className="bg-foreground absolute inset-x-6 bottom-0 h-px" />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePanel === "app"}
              onClick={handleAppPanelClick}
              className={cn(
                "relative flex h-12 items-center justify-center text-sm font-medium transition-colors",
                mobilePanel === "app"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <T>App</T>
              {mobilePanel === "app" ? (
                <span className="bg-foreground absolute inset-x-6 bottom-0 h-px" />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePanel === "chat"}
              onClick={handleChatPanelClick}
              className={cn(
                "relative flex h-12 items-center justify-center text-sm font-medium transition-colors",
                mobilePanel === "chat"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <T>Chat</T>
              {mobilePanel === "chat" ? (
                <span className="bg-foreground absolute inset-x-6 bottom-0 h-px" />
              ) : null}
            </button>
          </div>

          <section
            data-testid="coworker-info-mobile-panel"
            className="bg-background relative flex min-h-0 flex-1 flex-col overflow-hidden"
            onPointerDown={handleMobilePanelPointerDown}
            onPointerUp={handleMobilePanelPointerUp}
            onPointerCancel={handleMobilePanelPointerCancel}
          >
            {mobilePanel === "app" ? (
              <>
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 z-10 w-6 touch-pan-y"
                  onPointerDown={handleMobilePanelPointerDown}
                  onPointerUp={handleMobilePanelPointerUp}
                  onPointerCancel={handleMobilePanelPointerCancel}
                />
                <div
                  aria-hidden
                  className="absolute inset-y-0 right-0 z-10 w-6 touch-pan-y"
                  onPointerDown={handleMobilePanelPointerDown}
                  onPointerUp={handleMobilePanelPointerUp}
                  onPointerCancel={handleMobilePanelPointerCancel}
                />
              </>
            ) : null}
            <AnimatePresence custom={mobilePanelDirection} initial={false} mode="wait">
              <motion.div
                key={mobilePanel}
                custom={mobilePanelDirection}
                variants={MOBILE_PANEL_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={MOBILE_PANEL_TRANSITION}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {mobilePanel === "app" ? (
                  outputPanel
                ) : mobilePanel === "summary" ? (
                  <div className="h-full overflow-auto">
                    <div className="space-y-3 px-4 pt-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-visible">
                          <CoworkerAvatar
                            username={coworkerUsername}
                            size={50}
                            scale={82}
                            className="rounded-none"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h1 className="truncate text-lg leading-tight font-semibold">
                            {coworkerName}
                          </h1>
                          {coworkerUsername ? (
                            <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                              @{coworkerUsername}
                            </p>
                          ) : null}
                        </div>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0"
                              aria-label={t("Show full coworker description")}
                            >
                              <Info className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-80 p-3">
                            <p className="text-sm font-medium">
                              <T>Coworker description</T>
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                              {coworkerDefinition || "No definition set."}
                            </p>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <Link
                            href={getCoworkerEditHref({
                              id: resolvedCoworkerId,
                              username: coworkerUsername,
                            })}
                          >
                            <Pencil className="h-4 w-4" />
                            <T>Edit</T>
                          </Link>
                        </Button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              <History className="h-4 w-4" />
                              <T>History</T>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="center" className="w-72 p-2">
                            <div className="px-2 py-1.5">
                              <p className="text-sm font-medium">
                                <T>Previous Generations</T>
                              </p>
                              <p className="text-muted-foreground text-xs">
                                <T>Switch this page to an older Generation.</T>
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
                          <T>Run</T>
                        </Button>
                      </div>
                    </div>
                    <RunSummaryPanel
                      status={detailsRun.status}
                      startedAt={detailsRun.startedAt}
                      finishedAt={detailsRun.finishedAt}
                      events={detailsRun.events}
                      messages={messages}
                    />
                  </div>
                ) : conversationId ? (
                  <div className="flex h-full min-h-0 overflow-hidden">
                    <ChatArea conversationId={conversationId} compact />
                  </div>
                ) : (
                  <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
                    <T>No linked chat messages.</T>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>

        <div className="hidden min-h-0 flex-1 md:flex">
          <DualPanelWorkspace
            storageKey="agent-info-details-output-width-v3"
            defaultRightWidth={75}
            minLeftWidth={25}
            minRightWidth={40}
            showTitles={false}
            leftTitle="Details"
            rightTitle="Output"
            leftPanelClassName="border-0 bg-background rounded-none"
            rightPanelClassName="bg-card rounded-xl"
            separatorClassName="bg-muted/40"
            allowLeftPanelDragCollapse
            left={detailsPanel}
            right={outputPanel}
          />
        </div>
      </div>
    </main>
  );
}
