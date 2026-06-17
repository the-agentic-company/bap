import type { QueryClient } from "@tanstack/react-query";
import { useEffect, type MutableRefObject } from "react";
import type { GenerationCallbacks } from "@/lib/generation-stream";
import { createGenerationRuntime, type GenerationRuntime } from "@/lib/generation-runtime";
import { createChatGenerationStreamHandlers } from "./chat-generation-stream-handlers";
import type { ActivitySegment } from "./chat-generation-interrupts";
import type { Message } from "../message-list";

type ActiveGenerationForReconnect = {
  generationId?: string | null;
  startedAt?: string | null;
  status?: string | null;
};

type SubscribeToGeneration = (generationId: string, callbacks: GenerationCallbacks) => unknown;

export function useChatGenerationReconnect({
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
}: {
  activeGeneration?: ActiveGenerationForReconnect | null;
  authCompletionRef: MutableRefObject<{ integration: string; interruptId: string } | null>;
  autoApproveEnabled: boolean;
  beginInitTracking: (source: "new_generation" | "reconnect", startedAtMs?: number) => void;
  conversationId?: string;
  currentGenerationIdRef: MutableRefObject<string | undefined>;
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
  isStreamEventForActiveScope: Parameters<
    typeof createChatGenerationStreamHandlers
  >[0]["isStreamEventForActiveScope"];
  locallyCompletedGenerationIdRef: MutableRefObject<string | null>;
  locallyStoppedGenerationIdRef: MutableRefObject<string | null>;
  markInitMissingAtEnd: (endReason: string, metadata?: Record<string, unknown>) => void;
  markInitSignal: (eventType: string, metadata?: Record<string, unknown>) => void;
  persistInterruptedRuntimeMessage: (
    runtime: GenerationRuntime,
    messageId?: string,
    timing?: Message["timing"],
  ) => void;
  queryClient: QueryClient;
  resumeGenerationNonce: number;
  runtimeRef: MutableRefObject<GenerationRuntime | null>;
  segments: ActivitySegment[];
  setCurrentGenerationIdRef: (generationId: string | undefined) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setRuntimeRef: (runtime: GenerationRuntime | null) => void;
  setSuppressLiveActivityRef: (suppress: boolean) => void;
  setTraceStatus: (status: "streaming" | "waiting_approval" | "waiting_auth" | "complete") => void;
  streamScopeRef: MutableRefObject<number>;
  submitApproval: Parameters<typeof createChatGenerationStreamHandlers>[0]["submitApproval"];
  subscribeToGeneration: SubscribeToGeneration;
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
  upsertMessageById: Parameters<typeof createChatGenerationStreamHandlers>[0]["upsertMessageById"];
}) {
  useEffect(() => {
    if (
      !activeGeneration?.generationId ||
      activeGeneration.generationId === locallyStoppedGenerationIdRef.current ||
      activeGeneration.generationId === locallyCompletedGenerationIdRef.current ||
      (activeGeneration.status !== "generating" &&
        activeGeneration.status !== "awaiting_approval" &&
        activeGeneration.status !== "awaiting_auth")
    ) {
      return;
    }

    if (runtimeRef.current && currentGenerationIdRef.current === activeGeneration.generationId) {
      return;
    }

    setCurrentGenerationIdRef(activeGeneration.generationId);
    setIsStreaming(true);
    setSuppressLiveActivityRef(false);
    const reconnectStartedAtMs = activeGeneration.startedAt
      ? Date.parse(activeGeneration.startedAt)
      : NaN;
    beginInitTracking(
      "reconnect",
      Number.isFinite(reconnectStartedAtMs) ? reconnectStartedAtMs : undefined,
    );
    const reconnectStatus =
      activeGeneration.status === "awaiting_approval"
        ? "waiting_approval"
        : activeGeneration.status === "awaiting_auth"
          ? "waiting_auth"
          : "streaming";
    setTraceStatus(reconnectStatus);

    const runtime = createGenerationRuntime();
    setRuntimeRef(runtime);
    runtime.setStatus(reconnectStatus);
    if (segments.length === 0) {
      syncFromRuntime(runtime);
    }
    const streamScope = streamScopeRef.current;
    const streamGenerationId = activeGeneration.generationId;
    subscribeToGeneration(
      activeGeneration.generationId,
      createChatGenerationStreamHandlers({
        activeConversationId: conversationId,
        autoApproveEnabled,
        authCompletionRef,
        currentGenerationIdRef,
        forceCoworkerQuerySync,
        handleGenerationCancelledUi,
        handleGenerationDoneUi,
        handleInitStatusChange,
        handleVisibleGenerationError,
        hydrateAssistantMessage,
        isStreamEventForActiveScope,
        locallyCompletedGenerationIdRef,
        markInitMissingAtEnd,
        markInitSignal,
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
  }, [
    activeGeneration?.generationId,
    activeGeneration?.startedAt,
    activeGeneration?.status,
    autoApproveEnabled,
    authCompletionRef,
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
    segments.length,
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
  ]);
}
