import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  AlertCircle,
  Download,
  FileCode2,
  Globe,
  History,
  Info,
  MessageSquareText,
} from "lucide-react";
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { findLatestAgenticAppFile } from "@/components/chat/agentic-app-selection";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MessageList, type SandboxFileData } from "@/components/chat/message-list";
import { mapPersistedMessagesToChatMessages } from "@/components/chat/persisted-message-mapper";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Button } from "@/components/ui/button";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  HistoryRunButton,
  RunSummaryPanel,
  type MobilePanel,
  getMobilePanel,
} from "@/routes/agents/-components/coworker-info-panels";
import { loadPublicCoworkerRoute, type PublicCoworkerPageData } from "@/lib/public-coworker-loader";

export const Route = createFileRoute("/share/agents/$slug")({
  validateSearch: (search: Record<string, unknown>): { run?: string; tab?: string } => ({
    run: typeof search.run === "string" ? search.run : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  loaderDeps: ({ search }) => ({ runId: search.run }),
  loader: loadPublicCoworkerRoute,
  head: ({ loaderData }) => {
    const page = loaderData as unknown as PublicCoworkerPageData | undefined;
    return { meta: [{ title: `${page?.coworker.name ?? "Coworker"} | Bap` }] };
  },
  notFoundComponent: PublicCoworkerNotFound,
  component: PublicCoworkerRoute,
});

function PublicCoworkerNotFound() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <AlertCircle className="text-muted-foreground h-5 w-5" />
      <p className="text-sm font-medium">
        <T>Public coworker not found</T>
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        <T>This coworker may be private, unshared, or the link may be invalid.</T>
      </p>
    </div>
  );
}

function PublicOutputPanel({
  outputHtml,
  outputFile,
  latestCoworkerMessage,
  runStatus,
}: {
  outputHtml: string | null;
  outputFile: PublicCoworkerPageData["outputFile"] | SandboxFileData;
  latestCoworkerMessage?: string;
  runStatus?: string | null;
}) {
  if (outputHtml && outputFile) {
    return <PublicHtmlOutputPanel outputHtml={outputHtml} outputFile={outputFile} />;
  }

  if (latestCoworkerMessage?.trim()) {
    return <PublicLatestMessagePanel latestCoworkerMessage={latestCoworkerMessage} />;
  }

  return <PublicEmptyOutputPanel runStatus={runStatus} />;
}

function PublicHtmlOutputPanel({
  outputHtml,
  outputFile,
}: {
  outputHtml: string;
  outputFile: NonNullable<PublicCoworkerPageData["outputFile"]> | SandboxFileData;
}) {
  const t = useGT();

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border/70 flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FileCode2 className="text-muted-foreground h-4 w-4" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          <T>output.html</T>
        </p>
        {outputFile.downloadUrl ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={outputFile.downloadUrl} download={outputFile.filename} target="_blank">
              <Download className="h-4 w-4" />
              <span className="sr-only">{t("Download output.html")}</span>
            </a>
          </Button>
        ) : null}
      </div>
      <div className="bg-muted/30 min-h-0 flex-1">
        <iframe
          title={t("output.html Agentic-App")}
          className="bg-background h-full w-full border-0"
          sandbox="allow-scripts allow-forms"
          srcDoc={outputHtml}
        />
      </div>
    </div>
  );
}

function PublicLatestMessagePanel({ latestCoworkerMessage }: { latestCoworkerMessage: string }) {
  return (
    <div className="bg-background h-full overflow-auto p-5">
      <div className="mx-auto max-w-3xl">
        <div className="border-border/70 mb-4 flex h-11 items-center gap-2 border-b">
          <MessageSquareText className="text-muted-foreground h-4 w-4" />
          <p className="text-sm font-medium">
            <T>Latest coworker message</T>
          </p>
        </div>
        <MessageBubble messageRole="assistant" content={latestCoworkerMessage} />
      </div>
    </div>
  );
}

function PublicEmptyOutputPanel({ runStatus }: { runStatus?: string | null }) {
  return (
    <div className="bg-muted/25 flex h-full min-h-[22rem] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <FileCode2 className="text-muted-foreground mx-auto mb-3 h-6 w-6" />
        <p className="text-sm font-medium">
          {runStatus === "running" ? <T>Coworker is running</T> : <T>No output yet</T>}
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          <T>This public page will show the coworker's latest visible output when it exists.</T>
        </p>
      </div>
    </div>
  );
}

function PublicChatPanel({
  messages,
}: {
  messages: ReturnType<typeof mapPersistedMessagesToChatMessages>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-border bg-muted/35 shrink-0 border-b px-4 py-3">
        <p className="text-sm font-medium">
          <T>You don't have access to use this coworker.</T>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          <T>
            You can read the shared chat, but starting runs and sending messages require access.
          </T>
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {messages.length > 0 ? (
          <MessageList messages={messages} />
        ) : (
          <p className="text-muted-foreground p-4 text-center text-sm">
            <T>No linked chat messages.</T>
          </p>
        )}
      </div>
    </div>
  );
}

function PublicDetailsPanel({
  activeTab,
  chatPanel,
  onChatTabClick,
  onSummaryTabClick,
  summaryPanel,
}: {
  activeTab: "summary" | "chat";
  chatPanel: ReactNode;
  onChatTabClick: () => void;
  onSummaryTabClick: () => void;
  summaryPanel: ReactNode;
}) {
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-12 shrink-0 items-center justify-between px-3 py-2">
        <div className="inline-flex rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={onSummaryTabClick}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              activeTab === "summary" ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            <T>Summary</T>
          </button>
          <button
            type="button"
            onClick={onChatTabClick}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              activeTab === "chat" ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            <T>Chat</T>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          chatPanel
        ) : (
          <div className="h-full overflow-auto">{summaryPanel}</div>
        )}
      </div>
    </aside>
  );
}

type PublicChatMessages = ReturnType<typeof mapPersistedMessagesToChatMessages>;

function getPublicCoworkerSlug(coworker: PublicCoworkerPageData["coworker"]): string {
  return coworker.username ?? coworker.id;
}

function findLatestCoworkerMessage(messages: PublicChatMessages): string | undefined {
  return messages
    .toReversed()
    .find((message) => message.role === "assistant" && message.content.trim())?.content;
}

function PublicCoworkerHeader({
  coworker,
  onHistorySelect,
  runs,
  selectedRunId,
}: {
  coworker: PublicCoworkerPageData["coworker"];
  onHistorySelect: (runId: string) => void;
  runs: PublicCoworkerPageData["runs"];
  selectedRunId?: string;
}) {
  return (
    <section className="bg-background/95 z-10 shrink-0 border-b px-4 py-3 backdrop-blur-sm md:px-6">
      <div className="flex min-h-10 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-visible">
          <CoworkerAvatar
            username={coworker.username}
            size={44}
            scale={82}
            className="rounded-none"
          />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base leading-tight font-semibold md:text-lg">
              {coworker.name}
            </h1>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
              <Globe className="h-3.5 w-3.5" />
              <T>Public</T>
            </span>
          </div>
          {coworker.username ? (
            <p className="text-muted-foreground truncate font-mono text-xs">@{coworker.username}</p>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                <Info className="h-4 w-4" />
                <span className="sr-only">
                  <T>Show coworker description</T>
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <p className="text-sm font-medium">
                <T>Coworker description</T>
              </p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {coworker.description || "No description set."}
              </p>
            </PopoverContent>
          </Popover>
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
                  <T>Previous Runs</T>
                </p>
                <p className="text-muted-foreground text-xs">
                  <T>Switch this page to an older run.</T>
                </p>
              </div>
              <div className="mt-1 max-h-80 space-y-1 overflow-auto">
                {runs.length > 0 ? (
                  runs.map((run) => (
                    <HistoryRunButton
                      key={run.id}
                      run={run}
                      selected={run.id === selectedRunId}
                      onSelect={onHistorySelect}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                    <T>No previous Coworker Runs.</T>
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </section>
  );
}

function PublicMobilePanels({
  chatPanel,
  mobilePanel,
  onMobilePanelClick,
  outputPanel,
  summaryPanel,
}: {
  chatPanel: ReactNode;
  mobilePanel: MobilePanel;
  onMobilePanelClick: (event: MouseEvent<HTMLButtonElement>) => void;
  outputPanel: ReactNode;
  summaryPanel: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <div
        role="tablist"
        className="border-border bg-background grid shrink-0 grid-cols-3 border-b"
      >
        {(["summary", "app", "chat"] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            data-panel={panel}
            role="tab"
            aria-selected={mobilePanel === panel}
            onClick={onMobilePanelClick}
            className={cn(
              "relative flex h-12 items-center justify-center text-sm font-medium capitalize transition-colors",
              mobilePanel === panel
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {panel}
            {mobilePanel === panel ? (
              <span className="bg-foreground absolute inset-x-6 bottom-0 h-px" />
            ) : null}
          </button>
        ))}
      </div>
      <section className="min-h-0 flex-1 overflow-hidden">
        {mobilePanel === "app" ? outputPanel : mobilePanel === "chat" ? chatPanel : summaryPanel}
      </section>
    </div>
  );
}

function usePublicCoworkerSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr), [searchStr]);
}

function usePublicMobilePanel(searchParams: URLSearchParams) {
  return useState<MobilePanel>(() => getMobilePanel(searchParams.get("tab") ?? "app"));
}

function usePublicHistorySelect(coworkerSlug: string, searchParams: URLSearchParams) {
  const navigate = useNavigate();

  return useCallback(
    (runId: string) => {
      void navigate({
        to: "/share/agents/$slug",
        params: { slug: coworkerSlug },
        search: {
          run: runId,
          tab: searchParams.get("tab") ?? undefined,
        },
      });
    },
    [coworkerSlug, navigate, searchParams],
  );
}

function usePublicTabChange(coworkerSlug: string, searchParams: URLSearchParams) {
  const navigate = useNavigate();

  return useCallback(
    (nextTab: string) => {
      const next = nextTab === "chat" ? "chat" : "summary";
      void navigate({
        to: "/share/agents/$slug",
        params: { slug: coworkerSlug },
        search: {
          run: searchParams.get("run") ?? undefined,
          tab: next === "summary" ? undefined : next,
        },
      });
    },
    [coworkerSlug, navigate, searchParams],
  );
}

function usePublicMobilePanelChange({
  coworkerSlug,
  searchParams,
  setMobilePanel,
}: {
  coworkerSlug: string;
  searchParams: URLSearchParams;
  setMobilePanel: (mobilePanel: MobilePanel) => void;
}) {
  const navigate = useNavigate();

  return useCallback(
    (nextPanelValue: string) => {
      const next = getMobilePanel(nextPanelValue);
      setMobilePanel(next);
      void navigate({
        to: "/share/agents/$slug",
        params: { slug: coworkerSlug },
        search: {
          run: searchParams.get("run") ?? undefined,
          tab: next === "app" ? undefined : next,
        },
      });
    },
    [coworkerSlug, navigate, searchParams, setMobilePanel],
  );
}

function usePublicMobilePanelClick(handleMobilePanelChange: (nextPanelValue: string) => void) {
  return useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const panel = event.currentTarget.dataset.panel;
      if (panel) {
        handleMobilePanelChange(panel);
      }
    },
    [handleMobilePanelChange],
  );
}

function getPublicDetailsTab(searchParams: URLSearchParams): "summary" | "chat" {
  return searchParams.get("tab") === "chat" ? "chat" : "summary";
}

function getPublicOutputFile(
  outputFile: PublicCoworkerPageData["outputFile"],
  fallbackOutputFile: SandboxFileData | null,
) {
  return outputFile ?? fallbackOutputFile;
}

function usePublicCoworkerPanels({
  activeTab,
  latestCoworkerMessage,
  messages,
  outputFile,
  outputHtml,
  run,
  onChatTabClick,
  onSummaryTabClick,
}: {
  activeTab: "summary" | "chat";
  latestCoworkerMessage?: string;
  messages: PublicChatMessages;
  outputFile: PublicCoworkerPageData["outputFile"] | SandboxFileData;
  outputHtml: string | null;
  run: PublicCoworkerPageData["selectedRun"];
  onChatTabClick: () => void;
  onSummaryTabClick: () => void;
}) {
  const outputPanel = useMemo(
    () => (
      <PublicOutputPanel
        outputHtml={outputHtml}
        outputFile={outputFile}
        latestCoworkerMessage={latestCoworkerMessage}
        runStatus={run?.status}
      />
    ),
    [latestCoworkerMessage, outputFile, outputHtml, run?.status],
  );
  const summaryPanel = useMemo(
    () => (
      <RunSummaryPanel
        status={run?.status}
        startedAt={run?.startedAt}
        finishedAt={run?.finishedAt}
        messages={messages}
      />
    ),
    [messages, run?.finishedAt, run?.startedAt, run?.status],
  );
  const chatPanel = useMemo(() => <PublicChatPanel messages={messages} />, [messages]);
  const detailsPanel = useMemo(
    () => (
      <PublicDetailsPanel
        activeTab={activeTab}
        chatPanel={chatPanel}
        onChatTabClick={onChatTabClick}
        onSummaryTabClick={onSummaryTabClick}
        summaryPanel={summaryPanel}
      />
    ),
    [activeTab, chatPanel, onChatTabClick, onSummaryTabClick, summaryPanel],
  );

  return { chatPanel, detailsPanel, outputPanel, summaryPanel };
}

function PublicCoworkerRoute() {
  const page = Route.useLoaderData() as unknown as PublicCoworkerPageData;
  return <PublicCoworkerPage page={page} />;
}

function PublicCoworkerPage({ page }: { page: PublicCoworkerPageData }) {
  const searchParams = usePublicCoworkerSearchParams();
  const [mobilePanel, setMobilePanel] = usePublicMobilePanel(searchParams);

  const activeTab = getPublicDetailsTab(searchParams);
  const messages = useMemo(
    () => mapPersistedMessagesToChatMessages(page.messages),
    [page.messages],
  );
  const fallbackOutputFile = useMemo(() => findLatestAgenticAppFile(messages), [messages]);
  const outputFile = getPublicOutputFile(page.outputFile, fallbackOutputFile);
  const latestCoworkerMessage = useMemo(() => findLatestCoworkerMessage(messages), [messages]);
  const coworkerSlug = getPublicCoworkerSlug(page.coworker);
  const selectedRun = page.selectedRun;

  const handleHistorySelect = usePublicHistorySelect(coworkerSlug, searchParams);
  const handleTabChange = usePublicTabChange(coworkerSlug, searchParams);
  const handleMobilePanelChange = usePublicMobilePanelChange({
    coworkerSlug,
    searchParams,
    setMobilePanel,
  });
  const handleMobilePanelClick = usePublicMobilePanelClick(handleMobilePanelChange);

  const handleSummaryTabClick = useCallback(() => {
    handleTabChange("summary");
  }, [handleTabChange]);

  const handleChatTabClick = useCallback(() => {
    handleTabChange("chat");
  }, [handleTabChange]);

  const { chatPanel, detailsPanel, outputPanel, summaryPanel } = usePublicCoworkerPanels({
    activeTab,
    latestCoworkerMessage,
    messages,
    outputFile,
    outputHtml: page.outputHtml,
    run: selectedRun,
    onChatTabClick: handleChatTabClick,
    onSummaryTabClick: handleSummaryTabClick,
  });

  return (
    <main className="bg-background flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden">
      <PublicCoworkerHeader
        coworker={page.coworker}
        runs={page.runs}
        selectedRunId={selectedRun?.id}
        onHistorySelect={handleHistorySelect}
      />
      <PublicMobilePanels
        chatPanel={chatPanel}
        mobilePanel={mobilePanel}
        onMobilePanelClick={handleMobilePanelClick}
        outputPanel={outputPanel}
        summaryPanel={summaryPanel}
      />

      <div className="hidden min-h-0 min-w-0 flex-1 md:flex md:p-6">
        <DualPanelWorkspace
          storageKey="public-coworker-details-output-width-v1"
          defaultRightWidth={72}
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
    </main>
  );
}
