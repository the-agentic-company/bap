import { T, msg, useGT, useMessages } from "gt-react";
import { AlertCircle, Activity, ListTree, Sparkles, Timer, Trash2, PenLine } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback } from "react";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BottomActionBar } from "./bottom-action-bar";
import type { ActivityItemData } from "./activity-feed";
import { ActivityFeed } from "./activity-feed";
import { AuthRequestCard } from "./auth-request-card";
import type { ActivitySegment } from "./generation-stream/chat-generation-interrupts";
import { EMPTY_ACTIVITY_ITEMS } from "./generation-stream/chat-generation-interrupts";
import type { AttachmentData } from "./message-list";
import { ToolApprovalCard } from "./tool-approval-card";
import { VoiceIndicator } from "./voice-indicator";

type ChatStarter = {
  label: string;
  prompt: string;
};

type ChatStarterSection = {
  title: string;
  description: string;
  items: ChatStarter[];
};

export type QueuedMessage = {
  id: string;
  content: string;
  status: "queued" | "processing";
  attachments?: AttachmentData[];
  selectedPlatformSkillSlugs?: string[];
};

export type InputPrefillRequest = {
  id: string;
  text: string;
  mode?: "replace" | "append";
};

const CHAT_PLACEHOLDER_PROMPTS = [
  "What are my latest unread emails?",
  "Summarize unread Slack messages mentioning me",
  "What meetings do I have today and what should I know first?",
  "Every morning, send me a digest of unread emails and urgent Slack threads",
  "When a customer email sounds urgent, tag it and alert me in Slack",
  "Every afternoon, summarize calendar changes and open follow-ups",
];

const CHAT_QUICK_STARTERS: ChatStarter[] = [
  {
    label: msg("Latest emails"),
    prompt:
      "What are my latest unread emails? Group them by urgency and tell me what needs a reply first.",
  },
  {
    label: msg("Unread Slack"),
    prompt:
      "Show unread Slack messages and mentions that likely need my attention. Summarize each thread in one line.",
  },
  {
    label: msg("Today's meetings"),
    prompt:
      "What meetings do I have today? List the time, attendees, and any preparation I should do before each one.",
  },
  {
    label: msg("Daily digest"),
    prompt:
      "Create a daily digest workflow that sends me a morning summary of unread emails, important Slack threads, and today's meetings.",
  },
];

const CHAT_DISCOVER_SECTIONS: ChatStarterSection[] = [
  {
    title: msg("Ask Right Now"),
    description: msg("One-shot prompts that pull from connected tools immediately."),
    items: [
      {
        label: msg("Inbox triage"),
        prompt:
          "Review my latest unread emails, highlight the critical ones, and draft short reply points for the top 3.",
      },
      {
        label: msg("Slack catch-up"),
        prompt:
          "Catch me up on unread Slack threads, especially anything blocking me or asking for a decision.",
      },
      {
        label: msg("Meeting prep"),
        prompt:
          "Look at today's calendar and give me a prep brief for each meeting with likely action items.",
      },
      {
        label: msg("Follow-up list"),
        prompt:
          "Find emails and messages from the last 48 hours that I should follow up on but have not answered yet.",
      },
    ],
  },
  {
    title: msg("Automate For Me"),
    description: msg("Recurring or triggered workflows you can turn into a coworker."),
    items: [
      {
        label: msg("Morning brief"),
        prompt:
          "Every morning at 8am, send me a digest of unread emails, urgent Slack threads, and today's meetings.",
      },
      {
        label: msg("Urgent email routing"),
        prompt:
          "When a new email sounds urgent or frustrated, summarize it, suggest a reply, and alert me in Slack.",
      },
      {
        label: msg("Post-meeting recap"),
        prompt:
          "After each calendar event ends, generate a recap draft with next steps and send it to me for review.",
      },
      {
        label: msg("End-of-day wrap-up"),
        prompt:
          "Every weekday at 5pm, summarize what changed across email, Slack, and calendar and list unresolved items.",
      },
    ],
  },
];

const CHAT_STARTER_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, delay: index * 0.04 },
  }),
} as const;

const CHAT_DISCOVER_PANEL_VARIANTS = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.25, ease: "easeInOut" },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.25, ease: "easeInOut" },
  },
} as const;

const CHAT_DISCOVER_ITEM_VARIANTS = {
  hidden: { opacity: 0, x: -4 },
  visible: (index: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.2, delay: index * 0.03 },
  }),
} as const;

const NOOP_APPROVAL = () => {};
const NOOP_APPROVAL_WITH_ANSWERS = (() => {}) as (questionAnswers?: string[][]) => void;

function getQueuedMessageSummary(queuedMessage: QueuedMessage): string {
  if (queuedMessage.content) {
    return queuedMessage.content;
  }

  const attachmentCount = queuedMessage.attachments?.length ?? 0;
  return `${attachmentCount} queued attachment${attachmentCount === 1 ? "" : "s"}`;
}

function QueuedMessageRow({
  queuedMessage,
  index,
  onSend,
  onClear,
  onEdit,
}: {
  queuedMessage: QueuedMessage;
  index: number;
  onSend: (queuedMessage: QueuedMessage) => void;
  onClear: (queuedMessage: QueuedMessage) => void;
  onEdit: (queuedMessage: QueuedMessage) => void;
}) {
  const isQueued = queuedMessage.status === "queued";
  const handleSend = useCallback(() => {
    onSend(queuedMessage);
  }, [onSend, queuedMessage]);
  const handleClear = useCallback(() => {
    onClear(queuedMessage);
  }, [onClear, queuedMessage]);
  const handleEdit = useCallback(() => {
    onEdit(queuedMessage);
  }, [onEdit, queuedMessage]);

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {index + 1}. {getQueuedMessageSummary(queuedMessage)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {queuedMessage.status === "processing"
            ? "Starting now."
            : "Queued and waiting for its turn."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {index === 0 ? (
          <Button
            size="sm"
            className="h-8 rounded-full px-3"
            variant="secondary"
            onClick={handleSend}
            disabled={!isQueued}
          >
            <T>Steer</T>
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleEdit}
          aria-label={`Edit queued message ${index + 1}`}
          className="rounded-full"
          disabled={!isQueued}
        >
          <PenLine className="h-4 w-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleClear}
          aria-label={`Delete queued message ${index + 1}`}
          className="rounded-full"
          disabled={!isQueued}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ChatAreaContent({
  agentInitStatus,
  autoApprovalNode,
  compact,
  displaySegments,
  draftConversationId,
  handleAuthCancel,
  handleAuthConnect,
  handleClearQueued,
  handleCloseDiscover,
  handleEditQueuedMessage,
  handleScroll,
  handleSend,
  handleSendQueuedNow,
  handleStartRecording,
  handleStarterButtonClick,
  handleStop,
  handleToggleDiscover,
  initElapsedLabel,
  inputPrefillRequest,
  interimTranscript,
  isApproving,
  isDiscoverOpen,
  isEmptyChat,
  isProcessingVoice,
  isRecording,
  isStreaming,
  isSubmittingAuth,
  messagesEndRef,
  modelSelectorNode,
  normalizedQueuedMessages,
  queueingEnabled,
  scrollContainerRef,
  segmentApproveHandlers,
  segmentDenyHandlers,
  segmentToggleHandlers,
  showInitialLiveActivity,
  showLiveActivity,
  showModelSwitchWarning,
  skillsMenuNode,
  stopRecordingAndTranscribe,
  streamElapsedMs,
  streamError,
  transcriptFooter,
  transcriptNodes,
  visibleActivityItemsBySegmentId,
  voiceError,
}: {
  agentInitStatus: string | null;
  autoApprovalNode: React.ReactNode;
  compact: boolean;
  displaySegments: ActivitySegment[];
  draftConversationId?: string;
  handleAuthCancel: () => void;
  handleAuthConnect: (integration: string) => void;
  handleClearQueued: (queuedMessage: QueuedMessage) => void;
  handleCloseDiscover: () => void;
  handleEditQueuedMessage: (queuedMessage: QueuedMessage) => void;
  handleScroll: () => void;
  handleSend: (content: string, attachments?: AttachmentData[]) => Promise<boolean | undefined>;
  handleSendQueuedNow: (queuedMessage: QueuedMessage) => void;
  handleStartRecording: () => void;
  handleStarterButtonClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleStop: () => void;
  handleToggleDiscover: () => void;
  initElapsedLabel: string | null;
  inputPrefillRequest: InputPrefillRequest | null;
  interimTranscript: string;
  isApproving: boolean;
  isDiscoverOpen: boolean;
  isEmptyChat: boolean;
  isProcessingVoice: boolean;
  isRecording: boolean;
  isStreaming: boolean;
  isSubmittingAuth: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  modelSelectorNode: React.ReactNode;
  normalizedQueuedMessages: QueuedMessage[];
  queueingEnabled: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  segmentApproveHandlers: Map<string, (questionAnswers?: string[][]) => void>;
  segmentDenyHandlers: Map<string, () => void>;
  segmentToggleHandlers: Map<string, () => void>;
  showInitialLiveActivity: boolean;
  showLiveActivity: boolean;
  showModelSwitchWarning: boolean;
  skillsMenuNode: React.ReactNode;
  stopRecordingAndTranscribe: () => void;
  streamElapsedMs: number | null;
  streamError: string | null;
  transcriptFooter?: React.ReactNode;
  transcriptNodes: React.ReactNode[];
  visibleActivityItemsBySegmentId: Map<string, ActivityItemData[]>;
  voiceError: string | null;
}) {
  const t = useGT();
  const m = useMessages();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          "h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
          compact ? "p-3" : "p-4",
        )}
      >
        <div className={cn("mx-auto w-full min-w-0", compact ? "max-w-full" : "max-w-3xl")}>
          {showModelSwitchWarning && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <T>Changing model mid-conversation can degrade performance.</T>
              </span>
            </div>
          )}
          {streamError && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{streamError}</span>
            </div>
          )}
          {transcriptNodes.length > 0 && transcriptNodes}
          {transcriptFooter ? (
            <div className={cn("mx-auto w-full", compact ? "max-w-full" : "max-w-3xl")}>
              {transcriptFooter}
            </div>
          ) : null}

          {isEmptyChat ? null : (
            <>
              {showLiveActivity && (
                <div className="max-w-full min-w-0 space-y-4 py-4">
                  {showInitialLiveActivity && (
                    <div className="border-border/50 bg-muted/30 max-w-full min-w-0 overflow-hidden rounded-lg border">
                      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <Activity className="text-muted-foreground h-4 w-4 shrink-0" />
                        <span className="text-muted-foreground min-w-0 truncate text-sm">
                          {getAgentInitLabel(agentInitStatus)}
                        </span>
                        <div className="min-w-0 flex-1" />
                        {initElapsedLabel && (
                          <div className="text-muted-foreground/70 inline-flex min-w-0 shrink items-center gap-1 text-xs">
                            <Timer className="h-3 w-3 shrink-0" />
                            <span className="truncate">{initElapsedLabel}</span>
                          </div>
                        )}
                        <div className="flex shrink-0 gap-1">
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full" />
                        </div>
                      </div>
                    </div>
                  )}
                  {displaySegments.map((segment, index) => {
                    const visibleSegmentItems =
                      visibleActivityItemsBySegmentId.get(segment.id) ?? EMPTY_ACTIVITY_ITEMS;
                    const segmentIntegrations = Array.from(
                      new Set(
                        visibleSegmentItems
                          .filter((item) => item.integration)
                          .map((item) => item.integration as DisplayIntegrationType),
                      ),
                    );

                    return (
                      <div key={segment.id} className="max-w-full min-w-0 space-y-4">
                        {visibleSegmentItems.length > 0 && (
                          <ActivityFeed
                            items={visibleSegmentItems}
                            isStreaming={
                              isStreaming &&
                              index === displaySegments.length - 1 &&
                              !segment.approval &&
                              !segment.auth
                            }
                            isExpanded={segment.isExpanded}
                            onToggleExpand={segmentToggleHandlers.get(segment.id)!}
                            integrationsUsed={segmentIntegrations}
                            elapsedMs={streamElapsedMs ?? undefined}
                          />
                        )}

                        {segment.auth && segment.auth.status !== "pending" && (
                          <AuthRequestCard
                            integrations={segment.auth.integrations}
                            connectedIntegrations={segment.auth.connectedIntegrations}
                            reason={segment.auth.reason}
                            status={segment.auth.status}
                            isLoading={isSubmittingAuth}
                            onConnect={handleAuthConnect}
                            onCancel={handleAuthCancel}
                          />
                        )}
                        {segment.approval && segment.approval.status !== "pending" && (
                          <ToolApprovalCard
                            toolUseId={segment.approval.toolUseId}
                            toolName={segment.approval.toolName}
                            toolInput={segment.approval.toolInput}
                            integration={segment.approval.integration}
                            operation={segment.approval.operation}
                            command={segment.approval.command}
                            status={segment.approval.status}
                            questionAnswers={segment.approval.questionAnswers}
                            onApprove={
                              segmentApproveHandlers.get(segment.id) ?? NOOP_APPROVAL_WITH_ANSWERS
                            }
                            onDeny={segmentDenyHandlers.get(segment.id) ?? NOOP_APPROVAL}
                            readonly
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className={cn("bg-background mt-auto min-w-0 shrink-0", compact ? "p-3" : "p-4")}>
        <div
          className={cn("mx-auto w-full min-w-0 space-y-2", compact ? "max-w-full" : "max-w-4xl")}
        >
          {isEmptyChat && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {CHAT_QUICK_STARTERS.map((starter, i) => (
                  <motion.div
                    key={starter.label}
                    custom={i}
                    variants={CHAT_STARTER_VARIANTS}
                    initial="hidden"
                    animate="visible"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      data-prompt={starter.prompt}
                      onClick={handleStarterButtonClick}
                    >
                      {m(starter.label)}
                    </Button>
                  </motion.div>
                ))}
                <motion.div
                  custom={CHAT_QUICK_STARTERS.length}
                  variants={CHAT_STARTER_VARIANTS}
                  initial="hidden"
                  animate="visible"
                >
                  <Button
                    type="button"
                    variant={isDiscoverOpen ? "outline" : "secondary"}
                    size="sm"
                    className="gap-1.5 rounded-full"
                    onClick={handleToggleDiscover}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <T>Discover</T>
                  </Button>
                </motion.div>
              </div>

              <AnimatePresence>
                {isDiscoverOpen && (
                  <motion.div
                    variants={CHAT_DISCOVER_PANEL_VARIANTS}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="overflow-hidden"
                  >
                    <div className="rounded-2xl border bg-stone-50/60 p-3">
                      <div className="mb-2.5 flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground -mr-1 h-7 rounded-full px-2 text-xs"
                          onClick={handleCloseDiscover}
                        >
                          <T>Close</T>
                        </Button>
                      </div>

                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {CHAT_DISCOVER_SECTIONS.map((section, sectionIdx) => (
                          <div key={section.title}>
                            <p className="mb-1.5 text-xs font-medium tracking-wide text-stone-500 uppercase">
                              {m(section.title)}
                            </p>
                            <div className="flex flex-col gap-1">
                              {section.items.map((item, itemIdx) => (
                                <motion.button
                                  key={item.label}
                                  type="button"
                                  custom={sectionIdx * 2 + itemIdx}
                                  variants={CHAT_DISCOVER_ITEM_VARIANTS}
                                  initial="hidden"
                                  animate="visible"
                                  className="hover:bg-background group rounded-xl px-2.5 py-2 text-left transition-colors"
                                  data-prompt={item.prompt}
                                  onClick={handleStarterButtonClick}
                                >
                                  <span className="block text-sm font-medium">{m(item.label)}</span>
                                  <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs leading-relaxed">
                                    {m(item.prompt)}
                                  </span>
                                </motion.button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {(isRecording || isProcessingVoice || voiceError) && (
            <VoiceIndicator
              isRecording={isRecording}
              isProcessing={isProcessingVoice}
              error={voiceError}
              recordingLabel={interimTranscript || t("Listening… tap the mic to stop")}
            />
          )}
          {normalizedQueuedMessages.length > 0 && (
            <div className="from-muted/75 to-background rounded-3xl border bg-gradient-to-b px-4 py-3 shadow-[0_1px_0_0_hsl(var(--background))_inset,0_12px_24px_-22px_hsl(var(--foreground)/0.5)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="bg-background/80 border-border/70 inline-flex size-7 items-center justify-center rounded-full border">
                    <ListTree className="text-muted-foreground h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-none font-medium">
                      {normalizedQueuedMessages.length} <T>queued message</T>
                      {normalizedQueuedMessages.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {queueingEnabled
                        ? t("They run in order as soon as the current response finishes.")
                        : t("Queueing is off for new messages.")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {normalizedQueuedMessages.map((queuedMessage, index) => (
                  <QueuedMessageRow
                    key={queuedMessage.id}
                    queuedMessage={queuedMessage}
                    index={index}
                    onSend={handleSendQueuedNow}
                    onClear={handleClearQueued}
                    onEdit={handleEditQueuedMessage}
                  />
                ))}
              </div>
            </div>
          )}

          <BottomActionBar
            segments={displaySegments}
            segmentApproveHandlers={segmentApproveHandlers}
            segmentDenyHandlers={segmentDenyHandlers}
            isApproving={isApproving}
            handleAuthConnect={handleAuthConnect}
            handleAuthCancel={handleAuthCancel}
            isSubmittingAuth={isSubmittingAuth}
            onSubmit={handleSend}
            onStop={handleStop}
            disabled={isRecording || isProcessingVoice}
            isStreaming={isStreaming}
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={stopRecordingAndTranscribe}
            voiceInteractionMode="toggle"
            prefillRequest={inputPrefillRequest}
            conversationId={draftConversationId}
            placeholder="Send a message..."
            animatedPlaceholders={CHAT_PLACEHOLDER_PROMPTS}
            shouldAnimatePlaceholder={isEmptyChat}
            renderSkills={skillsMenuNode}
            renderModelSelector={modelSelectorNode}
            renderAutoApproval={autoApprovalNode}
          />
        </div>
      </div>
    </div>
  );
}

function getAgentInitLabel(status: string | null): string {
  switch (status) {
    case "sandbox_init_started":
      return "Preparing sandbox...";
    case "sandbox_init_checking_cache":
      return "Checking sandbox...";
    case "sandbox_init_reused":
      return "Reusing sandbox...";
    case "sandbox_init_creating":
      return "Creating sandbox...";
    case "sandbox_init_created":
      return "Sandbox created...";
    case "sandbox_init_failed":
      return "Sandbox initialization failed...";
    case "agent_init_started":
      return "Preparing agent...";
    case "agent_init_opencode_starting":
      return "Starting agent server...";
    case "agent_init_opencode_waiting_ready":
      return "Waiting for agent server...";
    case "agent_init_opencode_ready":
      return "Agent server ready...";
    case "agent_init_session_reused":
      return "Reusing agent session...";
    case "agent_init_session_creating":
      return "Creating agent session...";
    case "agent_init_session_created":
      return "Agent session created...";
    case "agent_init_session_replay_started":
      return "Restoring previous context...";
    case "agent_init_session_replay_completed":
      return "Context restored...";
    case "agent_init_session_init_completed":
      return "Finalizing agent...";
    case "agent_init_ready":
      return "Agent ready...";
    case "agent_init_failed":
      return "Agent initialization failed...";
    default:
      return "Creating agent...";
  }
}
