import { T } from "gt-react";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useChatHeaderActions } from "@/components/chat/chat-header-actions-context";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useConversation } from "@/orpc/hooks/conversation";
import { usePlatformSkillList, useSkillList } from "@/orpc/hooks/skills";
import { AgenticAppPanel } from "./agentic-app-panel";
import { findLatestAgenticAppFile } from "./agentic-app-selection";
import { ChatAreaContent } from "./chat-area-content";
import { useChatAreaControls } from "./chat-area-controls";
import { shouldRenderInitialLiveActivity, shouldRenderLiveActivity } from "./chat-live-activity";
import { useChatAreaModelSelection } from "./chat-area-model-selection";
import { useChatAreaTranscriptNodes } from "./chat-area-transcript";
import { useChatAreaVoice } from "./chat-area-voice";
import { useChatGenerationStream } from "./generation-stream/use-chat-generation-stream";

export type ChatAreaProps = {
  conversationId?: string;
  forceCoworkerQuerySync?: boolean;
  coworkerIdForSync?: string;
  onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  skillSelectionScopeKey?: string;
  initialPrefillText?: string | null;
  authCompletion?: { integration: string; interruptId: string } | null;
  enableAgenticApp?: boolean;
  compact?: boolean;
  transcriptFooter?: React.ReactNode;
};

export const CHAT_EXTERNAL_SEND_EVENT = "chat:external-send";

export function ChatAreaImpl({
  conversationId,
  forceCoworkerQuerySync = false,
  coworkerIdForSync,
  onCoworkerSync,
  skillSelectionScopeKey: skillSelectionScopeKeyOverride,
  initialPrefillText,
  authCompletion,
  enableAgenticApp = false,
  compact = false,
  transcriptFooter,
}: ChatAreaProps) {
  const { setHeaderActions } = useChatHeaderActions();
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } = usePlatformSkillList();
  const { data: accessibleSkills, isLoading: isAccessibleSkillsLoading } = useSkillList();
  const { data: existingConversation, isLoading } = useConversation(conversationId);
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const {
    isCoworkerConversation,
    normalizedSelectedModel,
    providerAvailability,
    selectedAuthSource,
    setSelection,
    showModelSwitchWarning,
  } = useChatAreaModelSelection({
    conversationId,
    existingConversation,
    isAdmin,
    isAdminLoading,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const userScrolledUpRef = useRef(false);
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(false);
  const [isAgenticAppCollapsed, setIsAgenticAppCollapsed] = useState(false);
  const setUserScrolledUpRef = useCallback((scrolledUp: boolean) => {
    userScrolledUpRef.current = scrolledUp;
  }, []);

  const {
    agentInitStatus,
    armedDebugPreset,
    autoApproveEnabled,
    chatDebugSnapshot,
    clearSelectedSkillSlugs,
    displaySegments,
    draftConversationId,
    handleArmDebugPreset,
    handleAuthCancel,
    handleAuthConnect,
    handleAutoApproveChange,
    handleClearDebugPreset,
    handleClearQueued,
    handleEditQueuedMessage,
    handleResumePausedRunDeadline,
    handleSend,
    handleSendFirstQueuedNow,
    handleSendQueuedNow,
    handleStop,
    historicalActivityBlocks,
    initElapsedLabel,
    inputPrefillRequest,
    isApproving,
    isEmptyChat,
    isResumingPausedRunDeadline,
    isStreaming,
    isSubmittingAuth,
    messages,
    normalizedQueuedMessages,
    queueingEnabled,
    segmentApproveHandlers,
    segmentDenyHandlers,
    segmentToggleHandlers,
    selectedSkillKeys,
    setInputPrefillRequest,
    skillSelectionScopeKey,
    streamElapsedMs,
    streamError,
    streamingParts,
    suppressLiveActivity,
    toggleSelectedSkillSlug,
    visibleActivityItemsBySegmentId,
  } = useChatGenerationStream({
    authCompletion,
    conversationId,
    coworkerIdForSync,
    existingConversation: existingConversation as Parameters<
      typeof useChatGenerationStream
    >[0]["existingConversation"],
    forceCoworkerQuerySync,
    initialPrefillText,
    isCoworkerConversation,
    normalizedSelectedModel,
    onCoworkerSync,
    selectedAuthSource,
    setSelection,
    setUserScrolledUpRef,
    skillSelectionScopeKeyOverride,
  });

  const agenticAppStorageKey = useMemo(() => {
    if (!enableAgenticApp) {
      return null;
    }
    return `chat-agentic-app:${draftConversationId ?? conversationId ?? "new-chat"}`;
  }, [conversationId, draftConversationId, enableAgenticApp]);

  useEffect(() => {
    if (!isEmptyChat && isDiscoverOpen) {
      setIsDiscoverOpen(false);
    }
  }, [isDiscoverOpen, isEmptyChat]);

  const handleStarterSelect = useCallback(
    (prompt: string) => {
      setInputPrefillRequest({
        id: `starter-${Date.now()}`,
        text: prompt,
      });
    },
    [setInputPrefillRequest],
  );

  const handleStarterButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const prompt = event.currentTarget.dataset.prompt;
      if (!prompt) {
        return;
      }
      handleStarterSelect(prompt);
    },
    [handleStarterSelect],
  );

  const handleToggleDiscover = useCallback(() => {
    setIsDiscoverOpen((open) => !open);
  }, []);

  const handleCloseDiscover = useCallback(() => {
    setIsDiscoverOpen(false);
  }, []);

  const {
    handleStartRecording,
    isProcessingVoice,
    isRecording,
    stopRecordingAndTranscribe,
    voiceError,
  } = useChatAreaVoice({
    isStreaming,
    setInputPrefillRequest,
  });

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const threshold = 100;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;

    if (isNearBottomRef.current) {
      userScrolledUpRef.current = false;
    }
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleUserScroll = () => {
      requestAnimationFrame(() => {
        if (!isNearBottomRef.current) {
          userScrolledUpRef.current = true;
        }
      });
    };

    container.addEventListener("wheel", handleUserScroll, { passive: true });
    container.addEventListener("touchmove", handleUserScroll, {
      passive: true,
    });
    return () => {
      container.removeEventListener("wheel", handleUserScroll);
      container.removeEventListener("touchmove", handleUserScroll);
    };
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && !userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingParts]);

  const { autoApprovalNode, modelSelectorNode, skillsMenuNode } = useChatAreaControls({
    accessibleSkills,
    armedDebugPreset,
    autoApproveEnabled,
    chatDebugSnapshot,
    clearSelectedSkillSlugs,
    handleArmDebugPreset,
    handleAutoApproveChange,
    handleClearDebugPreset,
    handleResumePausedRunDeadline,
    isAccessibleSkillsLoading,
    isPlatformSkillsLoading,
    isAdmin,
    isAdminLoading,
    isCoworkerConversation,
    isResumingPausedRunDeadline,
    isStreaming,
    normalizedSelectedModel,
    platformSkills,
    providerAvailability,
    selectedAuthSource,
    selectedSkillKeys,
    setHeaderActions,
    setSelection,
    skillSelectionScopeKey,
    toggleSelectedSkillSlug,
  });

  const transcriptNodes = useChatAreaTranscriptNodes({
    historicalActivityBlocks,
    messages,
  });
  const showLiveActivity = shouldRenderLiveActivity({
    displaySegmentCount: displaySegments.length,
    isStreaming,
    suppressLiveActivity,
  });
  const showInitialLiveActivity = shouldRenderInitialLiveActivity({
    displaySegmentCount: displaySegments.length,
    isStreaming,
    suppressLiveActivity,
  });
  const latestAgenticAppFile = useMemo(
    () => (enableAgenticApp ? findLatestAgenticAppFile(messages) : null),
    [enableAgenticApp, messages],
  );

  useEffect(() => {
    if (!agenticAppStorageKey || !latestAgenticAppFile || typeof window === "undefined") {
      return;
    }

    setIsAgenticAppCollapsed(window.localStorage.getItem(agenticAppStorageKey) === "collapsed");
  }, [latestAgenticAppFile, agenticAppStorageKey]);

  const handleAgenticAppCollapsedChange = useCallback(
    (collapsed: boolean) => {
      setIsAgenticAppCollapsed(collapsed);
      if (agenticAppStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(agenticAppStorageKey, collapsed ? "collapsed" : "open");
      }
    },
    [agenticAppStorageKey],
  );
  const handleCloseAgenticApp = useCallback(() => {
    handleAgenticAppCollapsedChange(true);
  }, [handleAgenticAppCollapsedChange]);

  useHotkeys(
    "mod+enter",
    () => {
      handleSendFirstQueuedNow();
    },
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [handleSendFirstQueuedNow],
  );

  const chatContent = createElement(ChatAreaContent, {
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
  });
  const agenticAppPanel = useMemo(() => {
    if (!latestAgenticAppFile) {
      return null;
    }

    return (
      <AgenticAppPanel
        key={latestAgenticAppFile.fileId}
        outputFile={latestAgenticAppFile}
        onClose={handleCloseAgenticApp}
        onSendPrompt={handleSend}
      />
    );
  }, [handleCloseAgenticApp, handleSend, latestAgenticAppFile]);

  if (conversationId && isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">
          <T>Loading conversation...</T>
        </div>
      </div>
    );
  }

  if (enableAgenticApp && latestAgenticAppFile && agenticAppPanel) {
    return (
      <DualPanelWorkspace
        storageKey="chat-agentic-app-panels-v1"
        defaultRightWidth={42}
        minRightWidth={34}
        collapsible
        collapsedSidebar
        showExpandedCollapseButton={false}
        showTitles={false}
        rightCollapsed={isAgenticAppCollapsed}
        onRightCollapsedChange={handleAgenticAppCollapsedChange}
        leftTitle="Chat"
        rightTitle="output.html"
        leftPanelClassName="border-0 rounded-none"
        separatorClassName="bg-muted/30"
        rightPanelClassName="border-0 rounded-none bg-muted/30 md:min-w-[28rem]"
        left={chatContent}
        right={agenticAppPanel}
      />
    );
  }

  return chatContent;
}
