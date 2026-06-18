import type { QueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { GenerationCallbacks } from "@/lib/generation-stream";
import {
  createGenerationRuntime,
  type GenerationRuntime,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { createChatGenerationStreamHandlers } from "./chat-generation-stream-handlers";
import {
  buildHistoricalActivityBlockFromContentParts,
  type ActivitySegment,
  type HistoricalActivityBlock,
  type PendingRunDeadlineResumeState,
} from "./chat-generation-interrupts";
import type { PersistedContentPart } from "./chat-message-mapping";
import type { AttachmentData, Message, MessagePart, SandboxFileData } from "../message-list";
import type { ArmedDebugPreset, ChatDebugSnapshot } from "../chat-debug-popover";
import type { QueuedMessage, InputPrefillRequest } from "../chat-area-content";
import { buildSkillInstructionBlock, CUSTOM_SKILL_PREFIX } from "../chat-area-controls";

type TraceStatus = RuntimeSnapshot["traceStatus"];

type ActiveGenerationForActions = {
  contentParts?: unknown;
  debugRunDeadlineMs?: number | null;
  generationId?: string | null;
  pauseReason?: string | null;
  status?: string | null;
};

type RunGenerationOptions = {
  selectedSkillKeysOverride?: string[];
  resumePausedGenerationId?: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
};

type StartGeneration = (
  input: {
    conversationId?: string;
    content: string;
    model: string;
    authSource?: "user" | "shared" | null;
    autoApprove: boolean;
    resumePausedGenerationId?: string;
    debugRunDeadlineMs?: number;
    debugApprovalHotWaitMs?: number;
    selectedPlatformSkillSlugs: string[];
    fileAttachments?: AttachmentData[];
  },
  callbacks: GenerationCallbacks,
) => unknown;

export function useChatGenerationActions({
  abort,
  activeGeneration,
  armedDebugPreset,
  authCompletionRef,
  autoApproveEnabled,
  beginInitTracking,
  cancelGeneration,
  chatExternalSendEvent,
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
}: {
  abort: () => void;
  activeGeneration?: ActiveGenerationForActions | null;
  armedDebugPreset: ArmedDebugPreset | null;
  authCompletionRef: MutableRefObject<{ integration: string; interruptId: string } | null>;
  autoApproveEnabled: boolean;
  beginInitTracking: (source: "new_generation" | "reconnect", startedAtMs?: number) => void;
  cancelGeneration: (generationId: string) => Promise<unknown>;
  chatExternalSendEvent: string;
  clearSelectedSkillSlugs: (scopeKey: string) => void;
  clearTrackedCoworkerEditToolUses: () => void;
  conversationId?: string;
  coworkerIdForSync?: string;
  currentConversationIdRef: MutableRefObject<string | undefined>;
  currentGenerationIdRef: MutableRefObject<string | undefined>;
  detectUserMessageLanguage: (input: { text: string }) => Promise<{ language: string }>;
  draftConversationId?: string;
  editingQueuedMessageId: string | null;
  enqueueConversationMessage: (input: {
    conversationId: string;
    content: string;
    selectedPlatformSkillSlugs: string[];
    fileAttachments?: AttachmentData[];
    replaceExisting: boolean;
  }) => Promise<unknown>;
  forceCoworkerQuerySync: boolean;
  handleGenerationCancelledUi: () => void;
  handleGenerationDoneUi: () => void;
  handleInitStatusChange: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["handleInitStatusChange"];
  handleVisibleGenerationError: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["handleVisibleGenerationError"];
  hydrateAssistantMessage: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["hydrateAssistantMessage"];
  isCoworkerConversation: boolean;
  isStreamEventForActiveScope: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["isStreamEventForActiveScope"];
  isStreaming: boolean;
  locallyCompletedGenerationIdRef: MutableRefObject<string | null>;
  locallyStoppedGenerationIdRef: MutableRefObject<string | null>;
  markInitMissingAtEnd: (endReason: string, metadata?: Record<string, unknown>) => void;
  markInitSignal: (eventType: string, metadata?: Record<string, unknown>) => void;
  normalizedSelectedModel: string;
  pendingRunDeadlineResume: PendingRunDeadlineResumeState | null;
  persistInterruptedRuntimeMessage: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["persistInterruptedRuntimeMessage"];
  queryClient: QueryClient;
  queueConversationId?: string;
  queuedMessagesRef: MutableRefObject<QueuedMessage[]>;
  queueingEnabled: boolean;
  removeConversationQueuedMessage: (input: {
    queuedMessageId: string;
    conversationId: string;
  }) => Promise<unknown>;
  resetInitTracking: () => void;
  runtimeRef: MutableRefObject<GenerationRuntime | null>;
  selectedAuthSource?: "user" | "shared" | null;
  selectedSkillKeys: string[];
  segments: ActivitySegment[];
  setArmedDebugPreset: Dispatch<SetStateAction<ArmedDebugPreset | null>>;
  setCurrentGenerationIdRef: (generationId: string | undefined) => void;
  setDismissedRunDeadlineGenerationId: Dispatch<SetStateAction<string | null>>;
  setEditingQueuedMessageId: Dispatch<SetStateAction<string | null>>;
  setHistoricalActivityBlocks: Dispatch<SetStateAction<HistoricalActivityBlock[]>>;
  setInputPrefillRequest: Dispatch<SetStateAction<InputPrefillRequest | null>>;
  setIntegrationsUsed: Dispatch<SetStateAction<Set<DisplayIntegrationType>>>;
  setIsResumingPausedRunDeadline: Dispatch<SetStateAction<boolean>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setLocalAutoApprove: Dispatch<SetStateAction<boolean>>;
  setLocallyCompletedGenerationIdRef: (generationId: string | null) => void;
  setLocallyStoppedGenerationIdRef: (generationId: string | null) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingRunDeadlineResume: Dispatch<SetStateAction<PendingRunDeadlineResumeState | null>>;
  setRuntimeRef: (runtime: GenerationRuntime | null) => void;
  setSegments: Dispatch<SetStateAction<ActivitySegment[]>>;
  setStreamError: Dispatch<SetStateAction<string | null>>;
  setStreamingParts: Dispatch<SetStateAction<MessagePart[]>>;
  setStreamingSandboxFiles: Dispatch<SetStateAction<SandboxFileData[]>>;
  setSuppressLiveActivityRef: (suppress: boolean) => void;
  setTraceStatus: Dispatch<SetStateAction<TraceStatus>>;
  setUserScrolledUpRef: (scrolledUp: boolean) => void;
  skillSelectionScopeKey: string;
  startGeneration: StartGeneration;
  streamScopeRef: MutableRefObject<number>;
  submitApproval: Parameters<typeof createChatGenerationStreamHandlers>[0]["submitApproval"];
  suppressLiveActivityRef: MutableRefObject<boolean>;
  syncConversationForNewChat: (id: string) => void;
  syncCoworkerAfterToolResult: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["syncCoworkerAfterToolResult"];
  syncFromRuntime: (runtime: GenerationRuntime) => void;
  trackCoworkerEditToolUse: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["trackCoworkerEditToolUse"];
  triggerCoworkerSync: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["triggerCoworkerSync"];
  updateAutoApprove: (input: { id: string; autoApprove: boolean }) => unknown;
  updateChatDebugSnapshot: (update: Partial<ChatDebugSnapshot>) => void;
  updateConversationQueuedMessage: (input: {
    queuedMessageId: string;
    conversationId: string;
    content: string;
    selectedPlatformSkillSlugs?: string[];
    fileAttachments?: AttachmentData[];
  }) => Promise<unknown>;
  upsertMessageById: Parameters<typeof createChatGenerationStreamHandlers>[0]["upsertMessageById"];
}) {
  const handleStop = useCallback(async () => {
    const runtime = runtimeRef.current;
    const generationId =
      currentGenerationIdRef.current ?? activeGeneration?.generationId ?? undefined;
    if (generationId) {
      setLocallyStoppedGenerationIdRef(generationId);
      queryClient.setQueryData(["generation", "active", conversationId], {
        generationId: null,
        startedAt: null,
        errorMessage: null,
        status: null,
        pauseReason: null,
        debugRunDeadlineMs: null,
        contentParts: null,
      });
    }
    if (runtime) {
      persistInterruptedRuntimeMessage(runtime);
    }
    setRuntimeRef(null);
    setCurrentGenerationIdRef(undefined);
    setSuppressLiveActivityRef(true);

    abort();
    if (generationId) {
      try {
        await cancelGeneration(generationId);
      } catch (err) {
        console.error("Failed to cancel generation:", err);
      }
    }

    setIsStreaming(false);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setSegments([]);
    setTraceStatus("complete");
    markInitMissingAtEnd("user_stopped", {
      generationId,
    });
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
  }, [
    abort,
    activeGeneration?.generationId,
    cancelGeneration,
    clearTrackedCoworkerEditToolUses,
    conversationId,
    currentGenerationIdRef,
    markInitMissingAtEnd,
    persistInterruptedRuntimeMessage,
    queryClient,
    resetInitTracking,
    runtimeRef,
    setCurrentGenerationIdRef,
    setIsStreaming,
    setLocallyStoppedGenerationIdRef,
    setRuntimeRef,
    setSegments,
    setStreamingParts,
    setStreamingSandboxFiles,
    setSuppressLiveActivityRef,
    setTraceStatus,
  ]);

  const toggleSegmentExpand = useCallback(
    (segmentId: string) => {
      setSegments((previousSegments) =>
        previousSegments.map((segment) =>
          segment.id === segmentId ? { ...segment, isExpanded: !segment.isExpanded } : segment,
        ),
      );
    },
    [setSegments],
  );

  const runGeneration = useCallback(
    async (content: string, attachments?: AttachmentData[], options?: RunGenerationOptions) => {
      setUserScrolledUpRef(false);
      setSuppressLiveActivityRef(false);
      setLocallyCompletedGenerationIdRef(null);
      setStreamError(null);
      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
        attachments,
      };
      setMessages((previousMessages) => [...previousMessages, userMessage]);
      setIsStreaming(true);
      setStreamingParts([]);
      setStreamingSandboxFiles([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("streaming");
      beginInitTracking("new_generation");
      clearTrackedCoworkerEditToolUses();
      setPendingRunDeadlineResume(null);
      setDismissedRunDeadlineGenerationId(null);
      if (!options?.resumePausedGenerationId) {
        setHistoricalActivityBlocks([]);
      }

      const runtime = createGenerationRuntime();
      setRuntimeRef(runtime);
      syncFromRuntime(runtime);
      const streamScope = streamScopeRef.current;
      let streamGenerationId: string | undefined;
      const generationRequestStartedAtMs = Date.now();

      const selectedKeys = options?.selectedSkillKeysOverride ?? selectedSkillKeys;
      const selectedPlatformSkillSlugs = selectedKeys.filter(
        (key) => !key.startsWith(CUSTOM_SKILL_PREFIX),
      );
      const effectiveConversationId = currentConversationIdRef.current ?? conversationId;
      const startInput = {
        conversationId: effectiveConversationId,
        content,
        model: normalizedSelectedModel,
        authSource: selectedAuthSource,
        autoApprove: autoApproveEnabled,
        resumePausedGenerationId: options?.resumePausedGenerationId,
        ...(options?.debugRunDeadlineMs !== undefined
          ? { debugRunDeadlineMs: options.debugRunDeadlineMs }
          : {}),
        ...(options?.debugApprovalHotWaitMs !== undefined
          ? { debugApprovalHotWaitMs: options.debugApprovalHotWaitMs }
          : {}),
        selectedPlatformSkillSlugs,
        fileAttachments: attachments,
      };
      void startGeneration(
        startInput,
        createChatGenerationStreamHandlers({
          activeConversationId: conversationId,
          autoApproveEnabled,
          authCompletionRef,
          currentGenerationIdRef,
          forceCoworkerQuerySync,
          generationRequestStartedAtMs,
          handleGenerationCancelledUi,
          handleGenerationDoneUi,
          handleInitStatusChange,
          handleVisibleGenerationError,
          hydrateAssistantMessage,
          invalidateConversationOnDone: true,
          isStreamEventForActiveScope,
          locallyCompletedGenerationIdRef,
          locallyStoppedGenerationIdRef,
          markInitMissingAtEnd,
          markInitSignal,
          onStarted: (generationId, newConversationId) => {
            if (streamScopeRef.current !== streamScope) {
              return;
            }
            streamGenerationId = generationId;
            setCurrentGenerationIdRef(generationId);
            setLocallyStoppedGenerationIdRef(null);
            updateChatDebugSnapshot({
              conversationId: newConversationId,
              generationId,
              status: "generating",
              pauseReason: null,
            });
            if (forceCoworkerQuerySync && coworkerIdForSync) {
              triggerCoworkerSync({ coworkerId: coworkerIdForSync });
            }
            console.info(
              `[AgentInit][Client] generation_started generationId=${generationId} conversationId=${newConversationId}`,
            );
            if (!conversationId && newConversationId) {
              syncConversationForNewChat(newConversationId);
            }
          },
          persistInterruptedRuntimeMessage,
          queryClient,
          runtime,
          runtimeRef,
          streamGenerationId,
          streamScope,
          submitApproval,
          suppressLiveActivityRef,
          syncConversationForNewChat,
          syncCoworkerAfterToolResult,
          syncFromRuntime,
          trackCoworkerEditToolUse,
          triggerCoworkerSync,
          upsertMessageById,
        }),
      );
    },
    [
      autoApproveEnabled,
      authCompletionRef,
      beginInitTracking,
      clearTrackedCoworkerEditToolUses,
      conversationId,
      coworkerIdForSync,
      currentConversationIdRef,
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
      normalizedSelectedModel,
      persistInterruptedRuntimeMessage,
      queryClient,
      runtimeRef,
      selectedAuthSource,
      selectedSkillKeys,
      setCurrentGenerationIdRef,
      setDismissedRunDeadlineGenerationId,
      setHistoricalActivityBlocks,
      setIntegrationsUsed,
      setIsStreaming,
      setLocallyCompletedGenerationIdRef,
      setLocallyStoppedGenerationIdRef,
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
      startGeneration,
      streamScopeRef,
      submitApproval,
      suppressLiveActivityRef,
      syncConversationForNewChat,
      syncCoworkerAfterToolResult,
      syncFromRuntime,
      trackCoworkerEditToolUse,
      triggerCoworkerSync,
      updateChatDebugSnapshot,
      upsertMessageById,
    ],
  );

  const buildOutgoingContent = useCallback(
    async (content: string, selectedSkillNames: string[]): Promise<string> => {
      if (selectedSkillNames.length === 0) {
        return content;
      }

      let isFrench = false;
      try {
        const result = await detectUserMessageLanguage({ text: content });
        isFrench = result.language === "french";
      } catch (error) {
        console.error("Failed to detect user message language:", error);
      }

      const instructions = buildSkillInstructionBlock(selectedSkillNames, isFrench);
      return `${content}\n\n${instructions}`;
    },
    [detectUserMessageLanguage],
  );

  const handleArmDebugPreset = useCallback(
    (preset: ArmedDebugPreset) => {
      setArmedDebugPreset(preset);
      setInputPrefillRequest({
        id: `debug-preset-${preset.key}-${Date.now()}`,
        text: preset.prompt,
        mode: "replace",
      });
    },
    [setArmedDebugPreset, setInputPrefillRequest],
  );

  const handleClearDebugPreset = useCallback(() => {
    setArmedDebugPreset(null);
  }, [setArmedDebugPreset]);

  const handleResumePausedRunDeadline = useCallback(async () => {
    if (isStreaming) {
      return;
    }

    const pausedGenerationId =
      pendingRunDeadlineResume?.generationId ??
      (activeGeneration?.status === "paused" && activeGeneration.pauseReason === "run_deadline"
        ? activeGeneration.generationId
        : null);

    if (!pausedGenerationId) {
      return;
    }
    setIsResumingPausedRunDeadline(true);
    setPendingRunDeadlineResume(null);
    setDismissedRunDeadlineGenerationId(null);
    setHistoricalActivityBlocks((current) =>
      current.map((block) =>
        block.generationId === pausedGenerationId ? { ...block, awaitingResume: false } : block,
      ),
    );
    try {
      await runGeneration("continue", undefined, {
        resumePausedGenerationId: pausedGenerationId,
      });
    } finally {
      setIsResumingPausedRunDeadline(false);
    }
  }, [
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    isStreaming,
    pendingRunDeadlineResume?.generationId,
    runGeneration,
    setDismissedRunDeadlineGenerationId,
    setHistoricalActivityBlocks,
    setIsResumingPausedRunDeadline,
    setPendingRunDeadlineResume,
  ]);

  const handleSend = useCallback(
    async (content: string, attachments?: AttachmentData[]) => {
      try {
        const armedPresetSnapshot = armedDebugPreset;
        const selectedSkillKeysSnapshot = [...selectedSkillKeys];
        const selectedPlatformSkillSlugs = selectedSkillKeysSnapshot.filter(
          (key) => !key.startsWith(CUSTOM_SKILL_PREFIX),
        );
        const selectedSkillNamesSnapshot = selectedSkillKeysSnapshot.map((key) =>
          key.startsWith(CUSTOM_SKILL_PREFIX) ? key.slice(CUSTOM_SKILL_PREFIX.length) : key,
        );
        const outgoingContent = await buildOutgoingContent(content, selectedSkillNamesSnapshot);
        const editingQueuedMessage = editingQueuedMessageId
          ? queuedMessagesRef.current.find(
              (queuedMessage) => queuedMessage.id === editingQueuedMessageId,
            )
          : null;

        if (editingQueuedMessage) {
          const targetConversationId = currentConversationIdRef.current ?? queueConversationId;
          if (!targetConversationId) {
            setStreamError("Queue is not ready yet for this chat. Please retry in a second.");
            return false;
          }
          await updateConversationQueuedMessage({
            queuedMessageId: editingQueuedMessage.id,
            conversationId: targetConversationId,
            content: outgoingContent,
            selectedPlatformSkillSlugs: editingQueuedMessage.selectedPlatformSkillSlugs,
            fileAttachments: editingQueuedMessage.attachments,
          });
          setEditingQueuedMessageId(null);
          clearSelectedSkillSlugs(skillSelectionScopeKey);
          return true;
        }

        if (isStreaming) {
          if (!queueingEnabled) {
            setStreamError("Queueing is off. Wait for the current response or stop it first.");
            return false;
          }
          const targetConversationId = currentConversationIdRef.current ?? queueConversationId;
          if (!targetConversationId) {
            setStreamError("Queue is not ready yet for this new chat. Please retry in a second.");
            return false;
          }
          await enqueueConversationMessage({
            conversationId: targetConversationId,
            content: outgoingContent,
            selectedPlatformSkillSlugs,
            fileAttachments: attachments,
            replaceExisting: false,
          });
          clearSelectedSkillSlugs(skillSelectionScopeKey);
          return true;
        }

        clearSelectedSkillSlugs(skillSelectionScopeKey);
        setArmedDebugPreset(null);
        await runGeneration(outgoingContent, attachments, {
          selectedSkillKeysOverride: selectedSkillKeysSnapshot,
          debugRunDeadlineMs: armedPresetSnapshot?.debugRunDeadlineMs,
          debugApprovalHotWaitMs: armedPresetSnapshot?.debugApprovalHotWaitMs,
        });
        return true;
      } catch (error) {
        console.error("Failed to send chat message:", error);
        setStreamError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to send message. Please try again.",
        );
        return false;
      }
    },
    [
      armedDebugPreset,
      buildOutgoingContent,
      clearSelectedSkillSlugs,
      currentConversationIdRef,
      editingQueuedMessageId,
      enqueueConversationMessage,
      isStreaming,
      queueConversationId,
      queuedMessagesRef,
      queueingEnabled,
      runGeneration,
      selectedSkillKeys,
      setArmedDebugPreset,
      setEditingQueuedMessageId,
      setStreamError,
      skillSelectionScopeKey,
      updateConversationQueuedMessage,
    ],
  );

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const handleExternalSend = (event: Event) => {
      const customEvent = event as CustomEvent<{
        conversationId: string;
        content: string;
        attachments?: AttachmentData[];
      }>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }

      const activeConversationId = currentConversationIdRef.current ?? conversationId;
      if (!activeConversationId || detail.conversationId !== activeConversationId) {
        return;
      }

      void handleSend(detail.content, detail.attachments);
    };

    window.addEventListener(chatExternalSendEvent, handleExternalSend);
    return () => {
      window.removeEventListener(chatExternalSendEvent, handleExternalSend);
    };
  }, [chatExternalSendEvent, conversationId, currentConversationIdRef, handleSend]);

  useEffect(() => {
    updateChatDebugSnapshot({
      conversationId:
        currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
      generationId: activeGeneration?.generationId ?? null,
      status: activeGeneration?.status ?? null,
      pauseReason: activeGeneration?.pauseReason ?? null,
    });
  }, [
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    conversationId,
    currentConversationIdRef,
    draftConversationId,
    updateChatDebugSnapshot,
  ]);

  useEffect(() => {
    if (
      activeGeneration?.status === "paused" &&
      activeGeneration.pauseReason === "run_deadline" &&
      activeGeneration.generationId
    ) {
      const pausedGenerationId = activeGeneration.generationId;
      const pausedDebugRunDeadlineMs = activeGeneration.debugRunDeadlineMs ?? null;
      setPendingRunDeadlineResume((current) => {
        if (
          current?.generationId === pausedGenerationId &&
          current.debugRunDeadlineMs === pausedDebugRunDeadlineMs
        ) {
          return current;
        }
        return {
          generationId: pausedGenerationId,
          debugRunDeadlineMs: pausedDebugRunDeadlineMs,
        };
      });
      return;
    }

    setPendingRunDeadlineResume((current) => {
      if (!current) {
        return current;
      }
      if (
        activeGeneration?.generationId &&
        current.generationId === activeGeneration.generationId &&
        activeGeneration.status === "paused" &&
        activeGeneration.pauseReason === "run_deadline"
      ) {
        return current;
      }
      return null;
    });
  }, [
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    setPendingRunDeadlineResume,
  ]);

  useEffect(() => {
    if (
      activeGeneration?.status !== "paused" ||
      activeGeneration.pauseReason !== "run_deadline" ||
      !activeGeneration.generationId ||
      !Array.isArray(activeGeneration.contentParts)
    ) {
      return;
    }

    const hydratedBlock = buildHistoricalActivityBlockFromContentParts({
      generationId: activeGeneration.generationId,
      runtimeLimitMs: activeGeneration.debugRunDeadlineMs ?? null,
      contentParts: activeGeneration.contentParts as PersistedContentPart[],
    });

    if (!hydratedBlock) {
      return;
    }

    setHistoricalActivityBlocks((current) => {
      const existingIndex = current.findIndex(
        (block) => block.generationId === activeGeneration.generationId,
      );
      if (existingIndex === -1) {
        return [...current, hydratedBlock];
      }
      const next = [...current];
      next[existingIndex] = {
        ...hydratedBlock,
        awaitingResume: current[existingIndex]?.awaitingResume ?? hydratedBlock.awaitingResume,
      };
      return next;
    });
  }, [
    activeGeneration?.contentParts,
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    setHistoricalActivityBlocks,
  ]);

  const handleSendQueuedNow = useCallback(
    (queued: QueuedMessage) => {
      const send = async () => {
        if (!queueConversationId) {
          return;
        }
        if (isStreaming) {
          setStreamError("Queued message will run automatically when this response is finished.");
          return;
        }
        await removeConversationQueuedMessage({
          queuedMessageId: queued.id,
          conversationId: queueConversationId,
        });
        await runGeneration(queued.content, queued.attachments, {
          selectedSkillKeysOverride: queued.selectedPlatformSkillSlugs,
        });
      };
      void send();
    },
    [
      isStreaming,
      queueConversationId,
      removeConversationQueuedMessage,
      runGeneration,
      setStreamError,
    ],
  );

  const handleSendFirstQueuedNow = useCallback(() => {
    const queued = queuedMessagesRef.current[0];
    if (!queued) {
      return;
    }
    handleSendQueuedNow(queued);
  }, [handleSendQueuedNow, queuedMessagesRef]);

  const handleClearQueued = useCallback(
    (queued: QueuedMessage) => {
      const clear = async () => {
        if (!queueConversationId) {
          return;
        }
        await removeConversationQueuedMessage({
          queuedMessageId: queued.id,
          conversationId: queueConversationId,
        });
      };
      void clear();
    },
    [queueConversationId, removeConversationQueuedMessage],
  );

  const handleEditQueuedMessage = useCallback(
    (queued: QueuedMessage) => {
      setEditingQueuedMessageId(queued.id);
      setInputPrefillRequest({
        id: `prefill-${Date.now()}`,
        text: queued.content,
      });
    },
    [setEditingQueuedMessageId, setInputPrefillRequest],
  );

  const segmentToggleHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of segments) {
      handlers.set(segment.id, () => {
        toggleSegmentExpand(segment.id);
      });
    }
    return handlers;
  }, [segments, toggleSegmentExpand]);

  const handleAutoApproveChange = useCallback(
    (checked: boolean) => {
      if (isCoworkerConversation) {
        setLocalAutoApprove(false);
        return;
      }
      setLocalAutoApprove(checked);
      if (conversationId) {
        updateAutoApprove({
          id: conversationId,
          autoApprove: checked,
        });
      }
    },
    [conversationId, isCoworkerConversation, setLocalAutoApprove, updateAutoApprove],
  );

  return {
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
    runGeneration,
    segmentToggleHandlers,
    toggleSegmentExpand,
  };
}
