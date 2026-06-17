import type { QueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { PostHog } from "posthog-js";
import type { StatusChangeMetadata } from "@/lib/generation-stream";
import { type NormalizedGenerationError } from "@/lib/generation-errors";
import { type GenerationRuntime, type RuntimeSnapshot } from "@/lib/generation-runtime";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { client } from "@/orpc/client";
import { filterResolvedDuplicateApprovalSegments } from "../approval-segment-filter";
import type { Message, MessagePart, SandboxFileData } from "../message-list";
import type { ArmedDebugPreset, ChatDebugSnapshot } from "../chat-debug-popover";
import {
  buildHistoricalActivityBlock,
  markResolvedApprovalInterruptInSegments,
  markResolvedAuthInterruptInSegments,
  stripResolvedInterruptFromSegments,
  type ActivitySegment,
  type HistoricalActivityBlock,
  type PendingRunDeadlineResumeState,
} from "./chat-generation-interrupts";
import {
  mapPersistedMessageToChatMessage,
  sleep,
  type PersistedConversationMessage,
} from "./chat-message-mapping";
import { useCoworkerStreamSyncAdapter } from "./chat-coworker-stream-sync";

type ActiveGenerationForRuntimeUi = {
  debugRunDeadlineMs?: number | null;
  generationId?: string | null;
  startedAt?: string | null;
};

type NavigateToConversation = (input: {
  to: "/chat/$conversationId";
  params: { conversationId: string };
  replace: true;
}) => void | Promise<void>;

export type ChatGenerationRuntimeUiParams = {
  activeGeneration?: ActiveGenerationForRuntimeUi | null;
  armedDebugPreset: ArmedDebugPreset | null;
  authCompletion?: { integration: string; interruptId: string } | null;
  beginInitTracking: (mode: "new_generation" | "reconnect", startedAtMs?: number) => void;
  conversationId?: string;
  coworkerIdForSync?: string;
  currentConversationIdRef: MutableRefObject<string | undefined>;
  currentGenerationIdRef: MutableRefObject<string | undefined>;
  draftConversationId?: string;
  forceCoworkerQuerySync: boolean;
  markInitMissingAtEnd: (endReason: string, metadata?: Record<string, unknown>) => void;
  markInitSignal: (eventType: string, metadata?: Record<string, unknown>) => void;
  navigate: NavigateToConversation;
  normalizedSelectedModel: string;
  onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  posthog?: PostHog | null;
  queryClient: QueryClient;
  resetInitTracking: () => void;
  runtimeRef: MutableRefObject<GenerationRuntime | null>;
  setAgentInitStatus: Dispatch<SetStateAction<string | null>>;
  setAuthCompletionRef: (completion: { integration: string; interruptId: string } | null) => void;
  setCurrentConversationIdRef: (id: string | undefined) => void;
  setCurrentGenerationIdRef: (id: string | undefined) => void;
  setDismissedRunDeadlineGenerationId: Dispatch<SetStateAction<string | null>>;
  setDraftConversationId: Dispatch<SetStateAction<string | undefined>>;
  setHistoricalActivityBlocks: Dispatch<SetStateAction<HistoricalActivityBlock[]>>;
  setIntegrationsUsed: Dispatch<SetStateAction<Set<DisplayIntegrationType>>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingRunDeadlineResume: Dispatch<SetStateAction<PendingRunDeadlineResumeState | null>>;
  setResumeGenerationNonce: Dispatch<SetStateAction<number>>;
  setRuntimeRef: (runtime: GenerationRuntime | null) => void;
  setSegments: Dispatch<SetStateAction<ActivitySegment[]>>;
  setStreamError: Dispatch<SetStateAction<string | null>>;
  setStreamingParts: Dispatch<SetStateAction<MessagePart[]>>;
  setStreamingSandboxFiles: Dispatch<SetStateAction<SandboxFileData[]>>;
  setTraceStatus: Dispatch<SetStateAction<RuntimeSnapshot["traceStatus"]>>;
  setSuppressLiveActivityRef: (suppress: boolean) => void;
  streamScopeRef: MutableRefObject<number>;
  updateChatDebugSnapshot: (update: Partial<ChatDebugSnapshot>) => void;
  viewedConversationIdRef: MutableRefObject<string | undefined>;
};

export function useChatGenerationRuntimeUi({
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
}: ChatGenerationRuntimeUiParams) {
  const {
    clearTrackedCoworkerEditToolUses,
    triggerCoworkerSync,
    trackCoworkerEditToolUse,
    syncCoworkerAfterToolResult,
  } = useCoworkerStreamSyncAdapter({
    queryClient,
    forceCoworkerQuerySync,
    coworkerIdForSync,
    onCoworkerSync,
  });

  const isStreamEventForActiveScope = useCallback(
    ({
      scope,
      streamGenerationId,
      eventGenerationId,
      eventConversationId,
    }: {
      scope: number;
      streamGenerationId?: string;
      eventGenerationId?: string;
      eventConversationId?: string;
    }): boolean => {
      if (streamScopeRef.current !== scope) {
        return false;
      }

      const activeGenerationId = currentGenerationIdRef.current;
      const generationId = eventGenerationId ?? streamGenerationId;
      if (activeGenerationId && generationId && activeGenerationId !== generationId) {
        return false;
      }

      const viewedConversationId = viewedConversationIdRef.current;
      if (
        viewedConversationId &&
        eventConversationId &&
        viewedConversationId !== eventConversationId
      ) {
        return false;
      }

      return true;
    },
    [currentGenerationIdRef, streamScopeRef, viewedConversationIdRef],
  );

  const handleGenerationParkedUi = useCallback(() => {
    setIsStreaming(false);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setTraceStatus("complete");
    setCurrentGenerationIdRef(undefined);
    setRuntimeRef(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
  }, [
    clearTrackedCoworkerEditToolUses,
    resetInitTracking,
    setCurrentGenerationIdRef,
    setIsStreaming,
    setRuntimeRef,
    setStreamingParts,
    setStreamingSandboxFiles,
    setTraceStatus,
  ]);

  const handleInitStatusChange = useCallback(
    (status: string, metadata?: StatusChangeMetadata) => {
      console.info(
        `[AgentInit][Client] status_change status=${status} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      updateChatDebugSnapshot({
        conversationId:
          currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
        generationId: currentGenerationIdRef.current ?? activeGeneration?.generationId ?? null,
        runtimeId: metadata?.runtimeId,
        sandboxProvider: metadata?.sandboxProvider,
        sandboxId: metadata?.sandboxId,
        sessionId: metadata?.sessionId,
        lastParkedStatus:
          status === "approval_parked" ||
          status === "auth_parked" ||
          status === "run_deadline_parked"
            ? status
            : undefined,
        releasedSandboxId: metadata?.releasedSandboxId,
      });
      if (!status.startsWith("sandbox_init_") && !status.startsWith("agent_init_")) {
        if (status === "run_deadline_parked") {
          const parkedGenerationId =
            currentGenerationIdRef.current ?? activeGeneration?.generationId ?? "unknown";
          const runtimeLimitMs =
            activeGeneration?.debugRunDeadlineMs ?? armedDebugPreset?.debugRunDeadlineMs ?? null;
          const runtimeSnapshot = runtimeRef.current?.snapshot;
          if (runtimeSnapshot) {
            const historicalBlock = buildHistoricalActivityBlock({
              generationId: parkedGenerationId,
              runtimeLimitMs,
              snapshot: runtimeSnapshot,
            });
            if (historicalBlock) {
              setHistoricalActivityBlocks((current) => [
                ...current.filter((block) => block.generationId !== parkedGenerationId),
                historicalBlock,
              ]);
            }
          }
          setPendingRunDeadlineResume({
            generationId: parkedGenerationId,
            debugRunDeadlineMs: runtimeLimitMs,
          });
        }
        if (
          status === "approval_parked" ||
          status === "auth_parked" ||
          status === "run_deadline_parked"
        ) {
          handleGenerationParkedUi();
          queryClient.invalidateQueries({
            queryKey: ["generation", "active", currentConversationIdRef.current ?? conversationId],
          });
        }
        return;
      }

      setAgentInitStatus(status);
      posthog?.capture("agent_init_status", {
        status,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
      });

      if (status === "agent_init_ready") {
        markInitSignal("agent_init_ready");
      } else if (status === "sandbox_init_failed") {
        markInitMissingAtEnd("sandbox_init_failed");
        setStreamingParts([]);
        setStreamingSandboxFiles([]);
        setIsStreaming(false);
        setTraceStatus("complete");
        setStreamError("Sandbox initialization failed. Please retry.");
        setCurrentGenerationIdRef(undefined);
        setRuntimeRef(null);
        clearTrackedCoworkerEditToolUses();
        resetInitTracking();
      } else if (status === "agent_init_failed") {
        markInitMissingAtEnd("agent_init_failed");
        setStreamingParts([]);
        setStreamingSandboxFiles([]);
        setIsStreaming(false);
        setTraceStatus("complete");
        setStreamError("Agent initialization failed. Please retry.");
        setCurrentGenerationIdRef(undefined);
        setRuntimeRef(null);
        clearTrackedCoworkerEditToolUses();
        resetInitTracking();
      }
    },
    [
      activeGeneration?.debugRunDeadlineMs,
      activeGeneration?.generationId,
      armedDebugPreset?.debugRunDeadlineMs,
      clearTrackedCoworkerEditToolUses,
      conversationId,
      currentConversationIdRef,
      currentGenerationIdRef,
      draftConversationId,
      handleGenerationParkedUi,
      markInitMissingAtEnd,
      markInitSignal,
      normalizedSelectedModel,
      posthog,
      queryClient,
      resetInitTracking,
      runtimeRef,
      setAgentInitStatus,
      setHistoricalActivityBlocks,
      setIsStreaming,
      setCurrentGenerationIdRef,
      setPendingRunDeadlineResume,
      setRuntimeRef,
      setStreamError,
      setStreamingParts,
      setStreamingSandboxFiles,
      setTraceStatus,
      updateChatDebugSnapshot,
    ],
  );

  const syncFromRuntime = useCallback(
    (runtime: GenerationRuntime) => {
      const snapshot = runtime.snapshot;
      setStreamingParts(snapshot.parts as MessagePart[]);
      setSegments(
        filterResolvedDuplicateApprovalSegments(
          snapshot.segments.map((segment) => ({
            ...segment,
            items: segment.items.map((item) => ({
              ...item,
              integration: item.integration as DisplayIntegrationType | undefined,
            })),
          })),
        ),
      );
      setIntegrationsUsed(new Set(snapshot.integrationsUsed as DisplayIntegrationType[]));
      setStreamingSandboxFiles(snapshot.sandboxFiles as SandboxFileData[]);
      setTraceStatus(snapshot.traceStatus);
    },
    [setIntegrationsUsed, setSegments, setStreamingParts, setStreamingSandboxFiles, setTraceStatus],
  );

  const optimisticallyResumeInterruptedGeneration = useCallback(
    (
      interruptId: string,
      kind: "approval" | "auth",
      options?: { connectedIntegration?: string; questionAnswers?: string[][] },
    ) => {
      setStreamError(null);
      setSuppressLiveActivityRef(false);
      setSegments((current) => {
        if (kind === "approval") {
          return markResolvedApprovalInterruptInSegments(
            current,
            interruptId,
            options?.questionAnswers,
          );
        }
        if (kind === "auth" && options?.connectedIntegration) {
          return markResolvedAuthInterruptInSegments(
            current,
            interruptId,
            options.connectedIntegration,
          );
        }

        return stripResolvedInterruptFromSegments(current, interruptId, kind);
      });
      setTraceStatus("streaming");
      setIsStreaming(true);
      const generationId = currentGenerationIdRef.current ?? activeGeneration?.generationId ?? null;
      if (generationId) {
        setCurrentGenerationIdRef(generationId);
      }
      const reconnectStartedAtMs = activeGeneration?.startedAt
        ? Date.parse(activeGeneration.startedAt)
        : NaN;
      beginInitTracking(
        "reconnect",
        Number.isFinite(reconnectStartedAtMs) ? reconnectStartedAtMs : undefined,
      );
      updateChatDebugSnapshot({
        conversationId:
          currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
        generationId,
        status: "generating",
        pauseReason: null,
      });
      const activeConversationId =
        currentConversationIdRef.current ?? draftConversationId ?? conversationId;
      if (activeConversationId) {
        void queryClient.refetchQueries({
          queryKey: ["generation", "active", activeConversationId],
          exact: true,
        });
      }
      setResumeGenerationNonce((current) => current + 1);
    },
    [
      activeGeneration?.generationId,
      activeGeneration?.startedAt,
      beginInitTracking,
      conversationId,
      currentConversationIdRef,
      currentGenerationIdRef,
      draftConversationId,
      queryClient,
      setCurrentGenerationIdRef,
      setIsStreaming,
      setResumeGenerationNonce,
      setSegments,
      setStreamError,
      setTraceStatus,
      setSuppressLiveActivityRef,
      updateChatDebugSnapshot,
    ],
  );

  useEffect(() => {
    if (!authCompletion) {
      return;
    }

    setAuthCompletionRef(authCompletion);

    const runtime = runtimeRef.current;
    if (!runtime) {
      optimisticallyResumeInterruptedGeneration(authCompletion.interruptId, "auth", {
        connectedIntegration: authCompletion.integration,
      });
      return;
    }

    runtime.resolveAuthSuccess(authCompletion.integration);
    syncFromRuntime(runtime);
  }, [
    authCompletion,
    optimisticallyResumeInterruptedGeneration,
    runtimeRef,
    setAuthCompletionRef,
    syncFromRuntime,
  ]);

  const clearActiveGenerationUi = useCallback(() => {
    setSuppressLiveActivityRef(true);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setIsStreaming(false);
    setTraceStatus("complete");
    setCurrentGenerationIdRef(undefined);
    setRuntimeRef(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
  }, [
    clearTrackedCoworkerEditToolUses,
    resetInitTracking,
    setIsStreaming,
    setCurrentGenerationIdRef,
    setPendingRunDeadlineResume,
    setRuntimeRef,
    setStreamingParts,
    setStreamingSandboxFiles,
    setTraceStatus,
    setSuppressLiveActivityRef,
  ]);

  const handleVisibleGenerationError = useCallback(
    (error: NormalizedGenerationError, runtime?: GenerationRuntime | null) => {
      if (runtime) {
        runtime.handleError();
        syncFromRuntime(runtime);
      }

      console.error("Generation error:", error);
      posthog?.capture("generation_error_visible", {
        phase: error.phase,
        generationErrorCode: error.code,
        transportCode: error.transportCode ?? null,
        message: error.message,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
      });
      markInitMissingAtEnd("error", {
        message: error.message,
        phase: error.phase,
        generationErrorCode: error.code,
        transportCode: error.transportCode ?? null,
      });
      updateChatDebugSnapshot({
        status: "error",
        pauseReason: null,
      });
      setSuppressLiveActivityRef(true);
      clearActiveGenerationUi();
      setStreamError(error.message);
    },
    [
      clearActiveGenerationUi,
      currentConversationIdRef,
      currentGenerationIdRef,
      markInitMissingAtEnd,
      normalizedSelectedModel,
      posthog,
      setStreamError,
      setSuppressLiveActivityRef,
      syncFromRuntime,
      updateChatDebugSnapshot,
    ],
  );

  const handleGenerationDoneUi = useCallback(() => {
    setSuppressLiveActivityRef(true);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setIsStreaming(false);
    setSegments([]);
    setTraceStatus("complete");
    setStreamError(null);
    setCurrentGenerationIdRef(undefined);
    setRuntimeRef(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
    setDismissedRunDeadlineGenerationId(null);
    updateChatDebugSnapshot({
      generationId: null,
      status: "complete",
      pauseReason: null,
    });
  }, [
    clearTrackedCoworkerEditToolUses,
    resetInitTracking,
    setDismissedRunDeadlineGenerationId,
    setCurrentGenerationIdRef,
    setIsStreaming,
    setPendingRunDeadlineResume,
    setRuntimeRef,
    setSegments,
    setStreamError,
    setStreamingParts,
    setStreamingSandboxFiles,
    setTraceStatus,
    setSuppressLiveActivityRef,
    updateChatDebugSnapshot,
  ]);

  const handleGenerationCancelledUi = useCallback(() => {
    setSuppressLiveActivityRef(true);
    setIsStreaming(false);
    setCurrentGenerationIdRef(undefined);
    setRuntimeRef(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
    updateChatDebugSnapshot({
      generationId: null,
      status: null,
      pauseReason: null,
    });
  }, [
    clearTrackedCoworkerEditToolUses,
    resetInitTracking,
    setIsStreaming,
    setCurrentGenerationIdRef,
    setPendingRunDeadlineResume,
    setRuntimeRef,
    setSuppressLiveActivityRef,
    updateChatDebugSnapshot,
  ]);

  const upsertMessageById = useCallback(
    (nextMessage: Message) => {
      setMessages((previousMessages) => {
        const existingIndex = previousMessages.findIndex(
          (message) => message.id === nextMessage.id,
        );
        if (existingIndex === -1) {
          return [...previousMessages, nextMessage];
        }
        const updated = [...previousMessages];
        updated[existingIndex] = nextMessage;
        return updated;
      });
    },
    [setMessages],
  );

  const hydrateAssistantMessage = useCallback(
    async (newConversationId: string, messageId: string, fallback: Message): Promise<Message> => {
      const maxAttempts = 6;
      const retryDelayMs = 300;
      const fallbackHasFiles =
        (fallback.attachments?.length ?? 0) > 0 || (fallback.sandboxFiles?.length ?? 0) > 0;

      const attemptHydration = async (attempt: number): Promise<Message> => {
        try {
          const conversation = await client.conversation.get({ id: newConversationId });
          queryClient.setQueryData(["conversation", "get", newConversationId], conversation);

          const persisted = conversation.messages.find((message) => message.id === messageId);
          if (persisted) {
            const mapped = mapPersistedMessageToChatMessage(
              persisted as PersistedConversationMessage,
            );
            const mappedHasFiles =
              (mapped.attachments?.length ?? 0) > 0 || (mapped.sandboxFiles?.length ?? 0) > 0;

            if (mappedHasFiles || fallbackHasFiles || attempt === maxAttempts - 1) {
              return mapped;
            }
          }
        } catch (error) {
          if (attempt === maxAttempts - 1) {
            console.error("Failed to hydrate assistant message after completion:", error);
          }
        }

        if (attempt < maxAttempts - 1) {
          await sleep(retryDelayMs);
          return attemptHydration(attempt + 1);
        }
        return fallback;
      };

      return attemptHydration(0);
    },
    [queryClient],
  );

  const notifyConversationIdSync = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent("chat:conversation-id-sync", {
        detail: { conversationId: id },
      }),
    );
  }, []);

  const syncConversationForNewChat = useCallback(
    (id: string) => {
      setCurrentConversationIdRef(id);
      setDraftConversationId(id);
      notifyConversationIdSync(id);
      if (!conversationId) {
        void navigate({
          to: "/chat/$conversationId",
          params: { conversationId: id },
          replace: true,
        });
      }
    },
    [
      conversationId,
      navigate,
      notifyConversationIdSync,
      setCurrentConversationIdRef,
      setDraftConversationId,
    ],
  );

  const persistInterruptedRuntimeMessage = useCallback(
    (runtime: GenerationRuntime, messageId?: string, timing?: Message["timing"]) => {
      runtime.handleCancelled();
      const assistant = runtime.buildAssistantMessage();
      setMessages((previousMessages) => [
        ...previousMessages,
        {
          id: messageId ?? `cancelled-${Date.now()}`,
          role: "assistant",
          content: assistant.content || "Interrupted by user",
          parts: assistant.parts as MessagePart[],
          integrationsUsed: assistant.integrationsUsed,
          sandboxFiles: assistant.sandboxFiles as SandboxFileData[] | undefined,
          timing,
        } as Message & {
          integrationsUsed?: string[];
          sandboxFiles?: SandboxFileData[];
        },
      ]);
    },
    [setMessages],
  );

  return {
    clearActiveGenerationUi,
    clearTrackedCoworkerEditToolUses,
    handleGenerationCancelledUi,
    handleGenerationDoneUi,
    handleGenerationParkedUi,
    handleInitStatusChange,
    handleVisibleGenerationError,
    hydrateAssistantMessage,
    isStreamEventForActiveScope,
    notifyConversationIdSync,
    optimisticallyResumeInterruptedGeneration,
    persistInterruptedRuntimeMessage,
    syncConversationForNewChat,
    syncCoworkerAfterToolResult,
    syncFromRuntime,
    trackCoworkerEditToolUse,
    triggerCoworkerSync,
    upsertMessageById,
  };
}
