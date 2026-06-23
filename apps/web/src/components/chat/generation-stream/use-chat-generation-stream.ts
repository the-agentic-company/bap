import { GENERATION_ERROR_PHASES } from "@bap/core/lib/generation-errors";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useChatSkillStore } from "../chat-skill-store";
import { mergePersistedConversationMessages } from "../chat-message-sync";
import {
  filterLocallyResolvedPendingApprovalSegments,
  filterResolvedDuplicateApprovalSegments,
} from "../approval-segment-filter";
import type { ActivityItemData } from "../activity-feed";
import type { ArmedDebugPreset, ChatDebugSnapshot } from "../chat-debug-popover";
import type { InputPrefillRequest, QueuedMessage } from "../chat-area-content";
import type { AttachmentData, Message, MessagePart, SandboxFileData } from "../message-list";
import { normalizeGenerationError } from "@/lib/generation-errors";
import type { RuntimeSnapshot } from "@/lib/generation-runtime";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { useUpdateAutoApprove } from "@/orpc/hooks/conversation";
import {
  useActiveGeneration,
  useCancelGeneration,
  useConversationQueuedMessages,
  useDetectUserMessageLanguage,
  useEnqueueConversationMessage,
  useGeneration,
  useRemoveConversationQueuedMessage,
  useSubmitApproval,
  useSubmitAuthResult,
  useUpdateConversationQueuedMessage,
  type GenerationFileAttachment,
} from "@/orpc/hooks/generation";
import { useGetAuthUrl } from "@/orpc/hooks/integrations";
import { useGenerationInitTracker } from "./chat-generation-init-tracker";
import {
  buildRunDeadlineResumeSegment,
  type ActivitySegment,
  type HistoricalActivityBlock,
  type PendingRunDeadlineResumeState,
} from "./chat-generation-interrupts";
import {
  mapPersistedMessageToChatMessage,
  type PersistedConversationMessage,
} from "./chat-message-mapping";
import { useChatGenerationActions } from "./use-chat-generation-actions";
import { useChatGenerationInterruptActions } from "./use-chat-generation-interrupt-actions";
import { useChatGenerationReconnect } from "./use-chat-generation-reconnect";
import { useChatGenerationRefs } from "./use-chat-generation-refs";
import { useChatGenerationRuntimeUi } from "./use-chat-generation-runtime-ui";

type TraceStatus = RuntimeSnapshot["traceStatus"];

type ExistingConversationForGenerationStream = {
  model?: string;
  authSource?: "user" | "shared" | null;
  autoApprove?: boolean;
  type?: "chat" | "coworker";
  messages?: PersistedConversationMessage[];
};

function mapQueuedFileAttachments(
  attachments: GenerationFileAttachment[] | undefined,
): AttachmentData[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  return attachments.map(
    (attachment): AttachmentData => ({
      fileAssetId: attachment.fileAssetId,
      name: attachment.name ?? "Attachment",
      mimeType: attachment.mimeType ?? "application/octet-stream",
      sizeBytes: attachment.sizeBytes,
    }),
  );
}

function mergeDebugSnapshot(
  previous: ChatDebugSnapshot,
  update: Partial<ChatDebugSnapshot>,
): ChatDebugSnapshot {
  return {
    ...previous,
    ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
  };
}

export type ChatGenerationStreamState = {
  agentInitStatus: string | null;
  armedDebugPreset: ArmedDebugPreset | null;
  autoApproveEnabled: boolean;
  chatDebugSnapshot: ChatDebugSnapshot;
  clearSelectedSkillSlugs: (scopeKey: string) => void;
  displaySegments: ActivitySegment[];
  draftConversationId?: string;
  handleArmDebugPreset: (preset: ArmedDebugPreset) => void;
  handleAuthCancel: () => void;
  handleAuthConnect: (integration: string) => void;
  handleAutoApproveChange: (checked: boolean) => void;
  handleClearDebugPreset: () => void;
  handleClearQueued: (queued: QueuedMessage) => void;
  handleEditQueuedMessage: (queued: QueuedMessage) => void;
  handleResumePausedRunDeadline: () => Promise<void>;
  handleSend: (content: string, attachments?: AttachmentData[]) => Promise<boolean>;
  handleSendFirstQueuedNow: () => void;
  handleSendQueuedNow: (queued: QueuedMessage) => void;
  handleStop: () => Promise<void>;
  historicalActivityBlocks: HistoricalActivityBlock[];
  initElapsedLabel: string | null;
  inputPrefillRequest: InputPrefillRequest | null;
  isApproving: boolean;
  isEmptyChat: boolean;
  isResumingPausedRunDeadline: boolean;
  isStreaming: boolean;
  isSubmittingAuth: boolean;
  messages: Message[];
  normalizedQueuedMessages: QueuedMessage[];
  queueingEnabled: boolean;
  segmentApproveHandlers: Map<string, () => void>;
  segmentDenyHandlers: Map<string, () => void>;
  segmentToggleHandlers: Map<string, () => void>;
  selectedSkillKeys: string[];
  setInputPrefillRequest: Dispatch<SetStateAction<InputPrefillRequest | null>>;
  skillSelectionScopeKey: string;
  streamElapsedMs: number | null;
  streamError: string | null;
  streamingParts: MessagePart[];
  suppressLiveActivity: boolean;
  toggleSelectedSkillSlug: (scopeKey: string, slug: string) => void;
  visibleActivityItemsBySegmentId: Map<string, ActivityItemData[]>;
};

export function useChatGenerationStream({
  authCompletion,
  conversationId,
  coworkerIdForSync,
  existingConversation,
  forceCoworkerQuerySync,
  initialPrefillText,
  isCoworkerConversation,
  normalizedSelectedModel,
  onCoworkerSync,
  selectedAuthSource,
  setSelection,
  setUserScrolledUpRef,
  skillSelectionScopeKeyOverride,
}: {
  authCompletion?: { integration: string; interruptId: string } | null;
  conversationId?: string;
  coworkerIdForSync?: string;
  existingConversation?: ExistingConversationForGenerationStream | null;
  forceCoworkerQuerySync: boolean;
  initialPrefillText?: string | null;
  isCoworkerConversation: boolean;
  normalizedSelectedModel: string;
  onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  selectedAuthSource?: "user" | "shared" | null;
  setSelection: (selection: { model: string; authSource?: "user" | "shared" | null }) => void;
  setUserScrolledUpRef: (scrolledUp: boolean) => void;
  skillSelectionScopeKeyOverride?: string;
}): ChatGenerationStreamState {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const { startGeneration, subscribeToGeneration, abort } = useGeneration();
  const { mutateAsync: submitApproval, isPending: isApproving } = useSubmitApproval();
  const { mutateAsync: submitAuthResult, isPending: isSubmittingAuth } = useSubmitAuthResult();
  const { mutateAsync: getAuthUrl } = useGetAuthUrl();
  const { mutateAsync: cancelGeneration } = useCancelGeneration();
  const { mutateAsync: detectUserMessageLanguage } = useDetectUserMessageLanguage();
  const { mutateAsync: enqueueConversationMessage } = useEnqueueConversationMessage();
  const { mutateAsync: removeConversationQueuedMessage } = useRemoveConversationQueuedMessage();
  const { mutateAsync: updateConversationQueuedMessage } = useUpdateConversationQueuedMessage();
  const { mutateAsync: updateAutoApprove } = useUpdateAutoApprove();
  const { data: activeGeneration } = useActiveGeneration(conversationId);
  const selectedSkillSlugsByScope = useChatSkillStore((state) => state.selectedSkillSlugsByScope);
  const toggleSelectedSkillSlug = useChatSkillStore((state) => state.toggleSelectedSkillSlug);
  const clearSelectedSkillSlugs = useChatSkillStore((state) => state.clearSelectedSkillSlugs);
  const {
    authCompletionRef,
    currentConversationIdRef,
    currentGenerationIdRef,
    incrementStreamScopeRef,
    locallyCompletedGenerationIdRef,
    locallyStoppedGenerationIdRef,
    runtimeRef,
    setAuthCompletionRef,
    setCurrentConversationIdRef,
    setCurrentGenerationIdRef,
    setLocallyCompletedGenerationIdRef,
    setLocallyStoppedGenerationIdRef,
    setRuntimeRef,
    setSuppressLiveActivityRef,
    setViewedConversationIdRef,
    streamScopeRef,
    suppressLiveActivityRef,
    viewedConversationIdRef,
  } = useChatGenerationRefs(conversationId);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [localAutoApprove, setLocalAutoApprove] = useState(false);
  const [inputPrefillRequest, setInputPrefillRequest] = useState<InputPrefillRequest | null>(null);
  const [armedDebugPreset, setArmedDebugPreset] = useState<ArmedDebugPreset | null>(null);
  const [locallyResolvedApprovalKeys, setLocallyResolvedApprovalKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [chatDebugSnapshot, setChatDebugSnapshot] = useState<ChatDebugSnapshot>({});
  const [isResumingPausedRunDeadline, setIsResumingPausedRunDeadline] = useState(false);
  const [pendingRunDeadlineResume, setPendingRunDeadlineResume] =
    useState<PendingRunDeadlineResumeState | null>(null);
  const [historicalActivityBlocks, setHistoricalActivityBlocks] = useState<
    HistoricalActivityBlock[]
  >([]);
  const [dismissedRunDeadlineGenerationId, setDismissedRunDeadlineGenerationId] = useState<
    string | null
  >(null);
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState<string | null>(null);
  const [draftConversationId, setDraftConversationId] = useState<string | undefined>(
    conversationId,
  );
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [, setIntegrationsUsed] = useState<Set<DisplayIntegrationType>>(new Set());
  const [, setTraceStatus] = useState<TraceStatus>("complete");
  const [resumeGenerationNonce, setResumeGenerationNonce] = useState(0);
  const [, setStreamingSandboxFiles] = useState<SandboxFileData[]>([]);
  const initialPrefillAppliedRef = useRef(false);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);

  const skillSelectionScopeKey = useMemo(
    () => skillSelectionScopeKeyOverride ?? draftConversationId ?? conversationId ?? "new-chat",
    [conversationId, draftConversationId, skillSelectionScopeKeyOverride],
  );
  const selectedSkillKeys = selectedSkillSlugsByScope[skillSelectionScopeKey] ?? [];
  const queueingEnabled = true;
  const queueConversationId = draftConversationId ?? conversationId;
  const { data: queuedMessages } = useConversationQueuedMessages(queueConversationId);
  const normalizedQueuedMessages = useMemo<QueuedMessage[]>(
    () =>
      (queuedMessages ?? []).map((queuedMessage) => ({
        id: queuedMessage.id,
        content: queuedMessage.content,
        status: queuedMessage.status,
        attachments: mapQueuedFileAttachments(queuedMessage.fileAttachments),
        selectedPlatformSkillSlugs: queuedMessage.selectedPlatformSkillSlugs,
      })),
    [queuedMessages],
  );
  const autoApproveEnabled = useMemo(() => localAutoApprove, [localAutoApprove]);
  const updateChatDebugSnapshot = useCallback((update: Partial<ChatDebugSnapshot>) => {
    setChatDebugSnapshot((previous) => mergeDebugSnapshot(previous, update));
  }, []);
  const getCurrentConversationId = useCallback(
    () => currentConversationIdRef.current,
    [currentConversationIdRef],
  );
  const getCurrentGenerationId = useCallback(
    () => currentGenerationIdRef.current,
    [currentGenerationIdRef],
  );
  const {
    agentInitStatus,
    beginInitTracking,
    initElapsedLabel,
    markInitMissingAtEnd,
    markInitSignal,
    resetInitTracking,
    setAgentInitStatus,
    streamElapsedMs,
  } = useGenerationInitTracker({
    isStreaming,
    hasActivitySegments: segments.length > 0,
    currentConversationId: getCurrentConversationId,
    currentGenerationId: getCurrentGenerationId,
    normalizedSelectedModel,
    posthog,
  });
  const {
    clearTrackedCoworkerEditToolUses,
    handleGenerationCancelledUi,
    handleGenerationDoneUi,
    handleInitStatusChange,
    handleVisibleGenerationError,
    hydrateAssistantMessage,
    isStreamEventForActiveScope,
    optimisticallyResumeInterruptedGeneration,
    persistInterruptedRuntimeMessage,
    syncConversationForNewChat,
    syncCoworkerAfterToolResult,
    syncFromRuntime,
    trackCoworkerEditToolUse,
    triggerCoworkerSync,
    upsertMessageById,
  } = useChatGenerationRuntimeUi({
    activeGeneration,
    armedDebugPreset,
    authCompletion,
    beginInitTracking,
    conversationId,
    coworkerIdForSync,
    currentConversationIdRef,
    currentGenerationIdRef,
    draftConversationId,
    forceCoworkerQuerySync,
    markInitMissingAtEnd,
    markInitSignal,
    navigate,
    normalizedSelectedModel,
    onCoworkerSync,
    posthog,
    queryClient,
    resetInitTracking,
    runtimeRef,
    setAgentInitStatus,
    setAuthCompletionRef,
    setCurrentConversationIdRef,
    setCurrentGenerationIdRef,
    setDismissedRunDeadlineGenerationId,
    setDraftConversationId,
    setHistoricalActivityBlocks,
    setIntegrationsUsed,
    setIsStreaming,
    setMessages,
    setPendingRunDeadlineResume,
    setResumeGenerationNonce,
    setRuntimeRef,
    setSegments,
    setStreamError,
    setStreamingParts,
    setStreamingSandboxFiles,
    setTraceStatus,
    setSuppressLiveActivityRef,
    streamScopeRef,
    updateChatDebugSnapshot,
    viewedConversationIdRef,
  });
  const interactiveConversationId =
    currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null;
  const runDeadlineResumeState = useMemo<PendingRunDeadlineResumeState | null>(() => {
    if (
      pendingRunDeadlineResume &&
      pendingRunDeadlineResume.generationId !== dismissedRunDeadlineGenerationId
    ) {
      return pendingRunDeadlineResume;
    }

    if (
      activeGeneration?.status === "paused" &&
      activeGeneration.pauseReason === "run_deadline" &&
      activeGeneration.generationId &&
      activeGeneration.generationId !== dismissedRunDeadlineGenerationId
    ) {
      return {
        generationId: activeGeneration.generationId,
        debugRunDeadlineMs: activeGeneration.debugRunDeadlineMs ?? null,
      };
    }

    return null;
  }, [
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    dismissedRunDeadlineGenerationId,
    pendingRunDeadlineResume,
  ]);
  const displaySegments = useMemo(() => {
    const filteredSegments = filterLocallyResolvedPendingApprovalSegments(
      filterResolvedDuplicateApprovalSegments(segments),
      locallyResolvedApprovalKeys,
    );
    return runDeadlineResumeState
      ? [...filteredSegments, buildRunDeadlineResumeSegment(runDeadlineResumeState)]
      : filteredSegments;
  }, [locallyResolvedApprovalKeys, runDeadlineResumeState, segments]);
  const visibleActivityItemsBySegmentId = useMemo(
    () =>
      new Map<string, ActivityItemData[]>(
        displaySegments.map((segment) => [segment.id, segment.items]),
      ),
    [displaySegments],
  );

  useEffect(() => {
    setViewedConversationIdRef(conversationId);
  }, [conversationId, setViewedConversationIdRef]);

  useEffect(() => {
    if (initialPrefillAppliedRef.current) {
      return;
    }
    const text = initialPrefillText?.trim();
    if (!text) {
      return;
    }
    initialPrefillAppliedRef.current = true;
    setInputPrefillRequest({
      id: `initial-prefill-${Date.now()}`,
      text,
    });
  }, [initialPrefillText]);

  useEffect(() => {
    queuedMessagesRef.current = normalizedQueuedMessages;
  }, [normalizedQueuedMessages]);

  useEffect(() => {
    if (
      editingQueuedMessageId &&
      !normalizedQueuedMessages.some((queuedMessage) => queuedMessage.id === editingQueuedMessageId)
    ) {
      setEditingQueuedMessageId(null);
    }
  }, [editingQueuedMessageId, normalizedQueuedMessages]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    if (existingConversation?.model) {
      setSelection({
        model: existingConversation.model,
        authSource: existingConversation.authSource,
      });
    }
    if (typeof existingConversation?.autoApprove === "boolean") {
      setLocalAutoApprove(
        existingConversation.type === "coworker" ? false : existingConversation.autoApprove,
      );
    }

    if (existingConversation?.messages) {
      const persistedMessages = existingConversation.messages.map((message) =>
        mapPersistedMessageToChatMessage(message),
      );
      setMessages((previousMessages) =>
        mergePersistedConversationMessages({
          currentMessages: previousMessages,
          persistedMessages,
          preserveOptimisticMessages: isStreaming || currentGenerationIdRef.current !== undefined,
        }),
      );
    }
  }, [currentGenerationIdRef, existingConversation, conversationId, isStreaming, setSelection]);

  useEffect(() => {
    incrementStreamScopeRef();
    abort();
    setSuppressLiveActivityRef(false);
    setCurrentConversationIdRef(conversationId);
    setDraftConversationId(conversationId);
    setRuntimeRef(null);
    setStreamingParts([]);
    setSegments([]);
    setIntegrationsUsed(new Set());
    setTraceStatus("complete");
    setIsStreaming(false);
    setStreamError(null);
    setStreamingSandboxFiles([]);
    setCurrentGenerationIdRef(undefined);
    setLocallyCompletedGenerationIdRef(null);
    setPendingRunDeadlineResume(null);
    setHistoricalActivityBlocks([]);
    setDismissedRunDeadlineGenerationId(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();

    if (!conversationId) {
      setMessages([]);
      setLocalAutoApprove(false);
    }
  }, [
    abort,
    clearTrackedCoworkerEditToolUses,
    conversationId,
    incrementStreamScopeRef,
    resetInitTracking,
    setCurrentConversationIdRef,
    setCurrentGenerationIdRef,
    setLocallyCompletedGenerationIdRef,
    setRuntimeRef,
    setSuppressLiveActivityRef,
  ]);

  useEffect(() => {
    const handleNewChat = () => {
      incrementStreamScopeRef();
      abort();
      setSuppressLiveActivityRef(false);
      setRuntimeRef(null);
      setMessages([]);
      setStreamingParts([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("complete");
      setIsStreaming(false);
      setStreamError(null);
      setStreamingSandboxFiles([]);
      setCurrentGenerationIdRef(undefined);
      setLocallyStoppedGenerationIdRef(null);
      setLocallyCompletedGenerationIdRef(null);
      setCurrentConversationIdRef(undefined);
      setViewedConversationIdRef(undefined);
      setDraftConversationId(undefined);
      setLocalAutoApprove(false);
      setArmedDebugPreset(null);
      setChatDebugSnapshot({});
      setIsResumingPausedRunDeadline(false);
      setPendingRunDeadlineResume(null);
      setHistoricalActivityBlocks([]);
      setDismissedRunDeadlineGenerationId(null);
      clearTrackedCoworkerEditToolUses();
      resetInitTracking();
    };
    window.addEventListener("new-chat", handleNewChat);
    return () => window.removeEventListener("new-chat", handleNewChat);
  }, [
    abort,
    clearTrackedCoworkerEditToolUses,
    incrementStreamScopeRef,
    resetInitTracking,
    setCurrentConversationIdRef,
    setCurrentGenerationIdRef,
    setLocallyCompletedGenerationIdRef,
    setLocallyStoppedGenerationIdRef,
    setRuntimeRef,
    setSuppressLiveActivityRef,
    setViewedConversationIdRef,
  ]);

  useChatGenerationReconnect({
    activeGeneration,
    authCompletionRef,
    autoApproveEnabled,
    beginInitTracking,
    conversationId,
    currentGenerationIdRef,
    forceCoworkerQuerySync,
    handleGenerationCancelledUi,
    handleGenerationDoneUi,
    handleInitStatusChange,
    handleVisibleGenerationError,
    hydrateAssistantMessage,
    isStreamEventForActiveScope,
    locallyCompletedGenerationIdRef,
    locallyStoppedGenerationIdRef,
    markInitMissingAtEnd,
    markInitSignal,
    persistInterruptedRuntimeMessage,
    queryClient,
    resumeGenerationNonce,
    runtimeRef,
    segments,
    setCurrentGenerationIdRef,
    setIsStreaming,
    setRuntimeRef,
    setSuppressLiveActivityRef,
    setTraceStatus,
    streamScopeRef,
    submitApproval,
    subscribeToGeneration,
    suppressLiveActivityRef,
    syncConversationForNewChat,
    syncCoworkerAfterToolResult,
    syncFromRuntime,
    trackCoworkerEditToolUse,
    triggerCoworkerSync,
    upsertMessageById,
  });

  useEffect(() => {
    if (activeGeneration?.status !== "error") {
      return;
    }
    handleVisibleGenerationError(
      normalizeGenerationError(
        activeGeneration.errorMessage,
        GENERATION_ERROR_PHASES.PERSISTED_ERROR,
      ),
    );
  }, [activeGeneration?.errorMessage, activeGeneration?.status, handleVisibleGenerationError]);

  const {
    handleArmDebugPreset,
    handleAutoApproveChange,
    handleClearDebugPreset,
    handleClearQueued,
    handleEditQueuedMessage,
    handleResumePausedRunDeadline,
    handleSend,
    handleSendFirstQueuedNow,
    handleSendQueuedNow,
    handleStop,
    segmentToggleHandlers,
  } = useChatGenerationActions({
    abort,
    activeGeneration,
    armedDebugPreset,
    authCompletionRef,
    autoApproveEnabled,
    beginInitTracking,
    cancelGeneration,
    chatExternalSendEvent: "chat:external-send",
    clearSelectedSkillSlugs,
    clearTrackedCoworkerEditToolUses,
    conversationId,
    coworkerIdForSync,
    currentConversationIdRef,
    currentGenerationIdRef,
    detectUserMessageLanguage,
    draftConversationId,
    editingQueuedMessageId,
    enqueueConversationMessage,
    forceCoworkerQuerySync,
    handleGenerationCancelledUi,
    handleGenerationDoneUi,
    handleInitStatusChange,
    handleVisibleGenerationError,
    hydrateAssistantMessage,
    isCoworkerConversation,
    isStreamEventForActiveScope,
    isStreaming,
    locallyCompletedGenerationIdRef,
    locallyStoppedGenerationIdRef,
    markInitMissingAtEnd,
    markInitSignal,
    normalizedSelectedModel,
    pendingRunDeadlineResume,
    persistInterruptedRuntimeMessage,
    queryClient,
    queueConversationId,
    queuedMessagesRef,
    queueingEnabled,
    removeConversationQueuedMessage,
    resetInitTracking,
    runtimeRef,
    selectedAuthSource,
    selectedSkillKeys,
    segments,
    setArmedDebugPreset,
    setCurrentGenerationIdRef,
    setDismissedRunDeadlineGenerationId,
    setEditingQueuedMessageId,
    setHistoricalActivityBlocks,
    setInputPrefillRequest,
    setIntegrationsUsed,
    setIsResumingPausedRunDeadline,
    setIsStreaming,
    setLocallyCompletedGenerationIdRef,
    setLocallyStoppedGenerationIdRef,
    setLocalAutoApprove,
    setMessages,
    setPendingRunDeadlineResume,
    setRuntimeRef,
    setSegments,
    setStreamError,
    setStreamingParts,
    setStreamingSandboxFiles,
    setSuppressLiveActivityRef,
    setTraceStatus,
    setUserScrolledUpRef,
    skillSelectionScopeKey,
    startGeneration,
    streamScopeRef,
    submitApproval,
    suppressLiveActivityRef,
    syncConversationForNewChat,
    syncCoworkerAfterToolResult,
    syncFromRuntime,
    trackCoworkerEditToolUse,
    triggerCoworkerSync,
    updateAutoApprove,
    updateChatDebugSnapshot,
    updateConversationQueuedMessage,
    upsertMessageById,
  });

  const { handleAuthCancel, handleAuthConnect, segmentApproveHandlers, segmentDenyHandlers } =
    useChatGenerationInterruptActions({
      activeGeneration,
      displaySegments,
      getAuthUrl,
      handleResumePausedRunDeadline,
      interactiveConversationId,
      optimisticallyResumeInterruptedGeneration,
      pendingRunDeadlineResume,
      runtimeRef,
      setDismissedRunDeadlineGenerationId,
      setHistoricalActivityBlocks,
      setLocallyResolvedApprovalKeys,
      setPendingRunDeadlineResume,
      setStreamError,
      submitApproval,
      submitAuthResult,
      syncFromRuntime,
    });

  return {
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
    isEmptyChat: messages.length === 0 && !isStreaming,
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
    suppressLiveActivity: suppressLiveActivityRef.current,
    toggleSelectedSkillSlug,
    visibleActivityItemsBySegmentId,
  };
}
