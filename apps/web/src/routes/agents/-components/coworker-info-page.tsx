import { useNavigate, useRouterState } from "@tanstack/react-router";
import { T } from "gt-react";
import { AlertCircle, ArrowLeft, Download, History, Loader2, Pencil, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ChatArea } from "@/components/chat/chat-area";
import { findLatestAgenticAppFile } from "@/components/chat/agentic-app-selection";
import { mapPersistedMessagesToChatMessages } from "@/components/chat/persisted-message-mapper";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { Button } from "@/components/ui/button";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { triggerBrowserDownload } from "@/lib/download-file";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { cn } from "@/lib/utils";
import { useConversation, useDownloadSandboxFile } from "@/orpc/hooks/conversation";
import {
  useCoworker,
  useCoworkerList,
  useCoworkerRun,
  useCoworkerRuns,
  useTriggerCoworker,
} from "@/orpc/hooks/coworkers";
import { AppLink as Link } from "../-lib/app-link";
import { CoworkerInfoEmptyOutput } from "./coworker-info-empty-state";
import {
  formatDuration,
  formatHeaderTimestamp,
  formatLiveDuration,
  getRunStatusPresentation,
  getAdjacentMobilePanel,
  getMobilePanel,
  HistoryRunButton,
  isUuidRouteSlug,
  LoadingState,
  MOBILE_PANEL_ORDER,
  MOBILE_PANEL_SWIPE_THRESHOLD,
  MOBILE_PANEL_TRANSITION,
  MOBILE_PANEL_VARIANTS,
  OutputPanel,
  RunDetailsPanel,
  type MobilePanel,
} from "./coworker-info-panels";

type Props = {
  coworkerSlug: string;
};

export function CoworkerInfoPage({ coworkerSlug }: Props) {
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
  const latestKnownRunId = coworkerListItem?.recentRuns?.[0]?.id;
  const selectedRunId =
    coworkerRuns.data?.some((candidate) => candidate.id === requestedRunId) && requestedRunId
      ? requestedRunId
      : coworkerRuns.data?.[0]?.id ?? latestKnownRunId;
  const run = useCoworkerRun(selectedRunId, {
    enabled: Boolean(selectedRunId),
  });
  const coworker = useCoworker(resolvedCoworkerId);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(() =>
    getMobilePanel(searchParams.get("tab") ?? "chat"),
  );
  const [mobilePanelDirection, setMobilePanelDirection] = useState(0);
  const [runClockNow, setRunClockNow] = useState(() => Date.now());
  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shouldWaitForCoworkerList = !routeCoworkerId;
  const shouldWaitForCoworkerRuns = Boolean(requestedRunId || latestKnownRunId);
  const isRunSelectionLoading = shouldWaitForCoworkerRuns && !selectedRunId && coworkerRuns.isLoading;
  const isRunLoading =
    (shouldWaitForCoworkerList && coworkerList.isLoading) ||
    isRunSelectionLoading ||
    Boolean(selectedRunId && run.isLoading);
  const conversationId = run.data?.conversationId ?? undefined;
  const conversation = useConversation(conversationId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloadingOutput } =
    useDownloadSandboxFile();

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

  useEffect(() => {
    if (run.data?.status !== "running") {
      return;
    }

    setRunClockNow(Date.now());
    const interval = window.setInterval(() => {
      setRunClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [run.data?.status]);

  const headerRunMeta = useMemo(
    () => ({
      launchedAtLabel: formatHeaderTimestamp(run.data?.startedAt),
      durationLabel:
        run.data?.status === "running"
          ? formatLiveDuration(run.data?.startedAt, runClockNow)
          : formatDuration(run.data?.startedAt, run.data?.finishedAt),
      statusPresentation: getRunStatusPresentation(run.data?.status),
      runStatus: run.data?.status,
    }),
    [run.data?.finishedAt, run.data?.startedAt, run.data?.status, runClockNow],
  );
  const shouldShowHeaderRunMeta = Boolean(run.data?.startedAt || run.data?.status);
  const hiddenErrorMessageContents = useMemo(() => {
    if (!run.data?.errorMessage) {
      return undefined;
    }

    return [run.data.errorMessage, `Error : ${run.data.errorMessage}`];
  }, [run.data?.errorMessage]);
  const outputPanel = useMemo(
    () => (
      <OutputPanel
        outputFile={outputFile}
        conversationId={conversationId}
        latestCoworkerMessage={latestCoworkerMessage}
        runStatus={run.data?.status}
        runErrorMessage={run.data?.errorMessage}
        showOutputToolbar={false}
      />
    ),
    [
      conversationId,
      latestCoworkerMessage,
      outputFile,
      run.data?.errorMessage,
      run.data?.status,
    ],
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

  const handleDownloadOutput = useCallback(async () => {
    if (!outputFile) {
      return;
    }

    const result = await downloadSandboxFile(outputFile.fileId);
    await triggerBrowserDownload(result.url, outputFile.filename);
  }, [downloadSandboxFile, outputFile]);

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
      toast.success(result.generationId ? "Run started." : "Needs your input.");
      void navigate({ to: "/agents/info/$slug", params: { slug: resolvedCoworkerSlug } });
    } catch (error) {
      toast.error(normalizeGenerationError(error, "start_rpc").message);
    }
  }, [navigate, resolvedCoworkerId, resolvedCoworkerSlug, triggerCoworker]);

  const coworkerName =
    coworker.data?.name || coworkerListItem?.name || run.data?.coworkerName || "Coworker";
  const coworkerUsername =
    coworker.data?.username ?? coworkerListItem?.username ?? run.data?.coworkerUsername;
  const coworkerDefinition =
    coworker.data?.description?.trim() || coworkerListItem?.description?.trim();
  const backToCoworkersHref = useMemo(() => {
    const folderId = coworker.data?.folderId ?? coworkerListItem?.folderId ?? null;
    return folderId ? `/agents/folders/${folderId}` : "/agents";
  }, [coworker.data?.folderId, coworkerListItem?.folderId]);

  const detailsPanel = useMemo(
    () => (
      <RunDetailsPanel
        conversationId={conversationId}
        hiddenMessageContents={hiddenErrorMessageContents}
      />
    ),
    [conversationId, hiddenErrorMessageContents],
  );
  const emptyOutputPanel = useMemo(
    () => (
      <CoworkerInfoEmptyOutput
        coworkerDescription={coworkerDefinition}
        onRunNow={handleRunNow}
        isRunning={triggerCoworker.isPending}
      />
    ),
    [coworkerDefinition, handleRunNow, triggerCoworker.isPending],
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

  const headerSection = (
    <section className="bg-background/95 z-10 hidden shrink-0 px-3 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 backdrop-blur-sm md:block md:px-6 md:py-3">
      <div className="flex min-h-10 items-center gap-2 md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            asChild
          >
            <Link href={backToCoworkersHref} aria-label="Back to coworkers">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
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
          {shouldShowHeaderRunMeta ? (
            <p className="text-muted-foreground min-w-0 shrink truncate text-sm">
              {headerRunMeta.launchedAtLabel} ·{" "}
              {headerRunMeta.runStatus === "running"
                ? headerRunMeta.durationLabel
                : `duration ${headerRunMeta.durationLabel}`}{" "}
              ·{" "}
              <span className={cn("font-semibold", headerRunMeta.statusPresentation.className)}>
                {headerRunMeta.statusPresentation.label}
              </span>
            </p>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
          {outputFile ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={handleDownloadOutput}
                disabled={isDownloadingOutput}
              >
                {isDownloadingOutput ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <T>Download output</T>
              </Button>
              <ChatShareControls
                conversationId={conversationId}
                triggerVariant="button"
                outputLabel
                className="h-8 rounded-xl px-3"
              />
            </>
          ) : null}
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
                  <T>Previous Runs</T>
                </p>
                <p className="text-muted-foreground text-xs">
                  <T>Switch this page to an older run.</T>
                </p>
              </div>
              <div className="mt-1 max-h-80 space-y-1 overflow-auto">
                {(coworkerRuns.data ?? []).length > 0 ? (
                  (coworkerRuns.data ?? []).map((historyRun) => (
                    <HistoryRunButton
                      key={historyRun.id}
                      run={historyRun}
                      selected={historyRun.id === selectedRunId}
                      onSelect={handleHistorySelect}
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
  );

  const mobileHeaderSection = (
    <section className="bg-background/95 z-10 shrink-0 px-4 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 backdrop-blur-sm md:hidden">
      <div className="flex min-h-10 items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          asChild
        >
          <Link href={backToCoworkersHref} aria-label="Back to coworkers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-visible">
          <CoworkerAvatar
            username={coworkerUsername}
            size={40}
            scale={82}
            className="rounded-none"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm leading-tight font-semibold">{coworkerName}</h1>
          {shouldShowHeaderRunMeta ? (
            <p className="text-muted-foreground truncate text-xs">
              {headerRunMeta.statusPresentation.label}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );

  if (!run.data && !coworkerRuns.data?.length) {
    return (
      <main className="bg-background flex h-[calc(100dvh-4rem-var(--safe-area-inset-bottom))] min-h-0 min-w-0 flex-col overflow-hidden md:h-dvh">
        {headerSection}

        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden px-0 pt-[max(0.25rem,var(--safe-area-inset-top))] pb-0 md:gap-4 md:px-6 md:pt-3 md:pb-6">
          {mobileHeaderSection}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto md:hidden">
            <div className="px-4 pt-4 pb-4">
              <div className="border-border bg-card min-h-[26rem] rounded-xl border">
                <CoworkerInfoEmptyOutput
                  coworkerDescription={coworkerDefinition}
                  onRunNow={handleRunNow}
                  isRunning={triggerCoworker.isPending}
                />
              </div>
            </div>
          </div>

          <div className="hidden min-h-0 min-w-0 flex-1 md:flex">
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
              right={emptyOutputPanel}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-background flex h-[calc(100dvh-4rem-var(--safe-area-inset-bottom))] min-h-0 min-w-0 flex-col overflow-hidden md:h-dvh">
      {headerSection}

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden px-0 pt-[max(0.25rem,var(--safe-area-inset-top))] pb-0 md:gap-4 md:px-6 md:pt-3 md:pb-6">
        <RemoteRunSourceBanner source={remoteRunSource} />
        {mobileHeaderSection}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:hidden">
          <div
            role="tablist"
            className="border-border bg-background grid shrink-0 grid-cols-2 border-b"
          >
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
            className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                {mobilePanel === "app" ? (
                  outputPanel
                ) : conversationId ? (
                  <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
                    <ChatArea
                      conversationId={conversationId}
                      compact
                      hideStreamError
                      hiddenMessageContents={hiddenErrorMessageContents}
                    />
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

        <div className="hidden min-h-0 min-w-0 flex-1 md:flex">
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
