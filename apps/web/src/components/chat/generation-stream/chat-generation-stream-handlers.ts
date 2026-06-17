import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type {
  DoneArtifactsData,
  GenerationCallbacks,
  StatusChangeMetadata,
} from "@/lib/generation-stream";
import type { GenerationRuntime } from "@/lib/generation-runtime";
import type { NormalizedGenerationError } from "@/lib/generation-errors";
import type { Message, MessagePart, SandboxFileData } from "../message-list";
import { isQuestionApprovalRequest } from "../question-approval-utils";
import { withActivityDurations, withEndToEndDuration } from "./chat-message-mapping";

type StreamScopeCheck = (params: {
  scope: number;
  streamGenerationId?: string;
  eventGenerationId?: string;
  eventConversationId?: string;
}) => boolean;

export type ChatGenerationStreamHandlersParams = {
  activeConversationId: string | undefined;
  autoApproveEnabled: boolean;
  authCompletionRef: MutableRefObject<{ integration: string; interruptId: string } | null>;
  currentGenerationIdRef: MutableRefObject<string | undefined>;
  forceCoworkerQuerySync: boolean;
  generationRequestStartedAtMs?: number;
  handleGenerationCancelledUi: () => void;
  handleGenerationDoneUi: () => void;
  handleInitStatusChange: (status: string, metadata?: StatusChangeMetadata) => void;
  handleVisibleGenerationError: (
    error: NormalizedGenerationError,
    runtime?: GenerationRuntime | null,
  ) => void;
  hydrateAssistantMessage: (
    newConversationId: string,
    messageId: string,
    fallback: Message,
  ) => Promise<Message>;
  isStreamEventForActiveScope: StreamScopeCheck;
  locallyCompletedGenerationIdRef: MutableRefObject<string | null>;
  locallyStoppedGenerationIdRef?: MutableRefObject<string | null>;
  markInitMissingAtEnd: (endReason: string, metadata?: Record<string, unknown>) => void;
  markInitSignal: (eventType: string, metadata?: Record<string, unknown>) => void;
  onStarted?: (generationId: string, newConversationId: string) => void;
  persistInterruptedRuntimeMessage: (
    runtime: GenerationRuntime,
    messageId?: string,
    timing?: Message["timing"],
  ) => void;
  queryClient: QueryClient;
  runtime: GenerationRuntime;
  runtimeRef: MutableRefObject<GenerationRuntime | null>;
  streamGenerationId?: string;
  streamScope: number;
  submitApproval: (input: { interruptId: string; decision: "approve" }) => Promise<unknown>;
  suppressLiveActivityRef: MutableRefObject<boolean>;
  syncConversationForNewChat: (id: string) => void;
  syncCoworkerAfterToolResult: (toolUseId: string | undefined, result: unknown) => void;
  syncFromRuntime: (runtime: GenerationRuntime) => void;
  trackCoworkerEditToolUse: (payload: {
    toolUseId?: string;
    integration?: string;
    operation?: string;
  }) => void;
  triggerCoworkerSync: (payload: { coworkerId: string }) => void;
  upsertMessageById: (nextMessage: Message) => void;
  invalidateConversationOnDone?: boolean;
};

function mapDoneArtifactsAttachments(artifacts: DoneArtifactsData | undefined) {
  return artifacts?.attachments?.map((attachment) => ({
    id: attachment.id,
    name: attachment.filename,
    mimeType: attachment.mimeType,
    dataUrl: "",
  }));
}

export function createChatGenerationStreamHandlers(
  params: ChatGenerationStreamHandlersParams,
): GenerationCallbacks {
  let acceptFurtherEvents = true;
  let streamGenerationId = params.streamGenerationId;

  const isActiveEvent = (event?: { eventGenerationId?: string; eventConversationId?: string }) =>
    acceptFurtherEvents &&
    params.isStreamEventForActiveScope({
      scope: params.streamScope,
      streamGenerationId,
      eventGenerationId: event?.eventGenerationId,
      eventConversationId: event?.eventConversationId,
    });

  return {
    onStarted: (generationId, newConversationId) => {
      params.onStarted?.(generationId, newConversationId);
      streamGenerationId = generationId;
    },
    onText: (text) => {
      if (!isActiveEvent()) {
        return;
      }
      params.markInitSignal("text");
      params.runtime.handleText(text);
      params.syncFromRuntime(params.runtime);
    },
    onSystem: (data) => {
      if (!isActiveEvent()) {
        return;
      }
      params.runtime.handleSystem(data.content);
      params.syncFromRuntime(params.runtime);
      if (params.forceCoworkerQuerySync && data.coworkerId) {
        params.triggerCoworkerSync({ coworkerId: data.coworkerId });
      }
    },
    onThinking: (data) => {
      if (!isActiveEvent()) {
        return;
      }
      params.markInitSignal("thinking");
      params.runtime.handleThinking(data);
      params.syncFromRuntime(params.runtime);
    },
    onToolUse: (data) => {
      if (!isActiveEvent()) {
        return;
      }
      params.markInitSignal("tool_use", { toolName: data.toolName });
      params.trackCoworkerEditToolUse(data);
      params.runtime.handleToolUse(data);
      params.syncFromRuntime(params.runtime);
    },
    onToolResult: (toolName, result, toolUseId) => {
      if (!isActiveEvent()) {
        return;
      }
      params.markInitSignal("tool_result", { toolName });
      params.runtime.handleToolResult(toolName, result, toolUseId);
      params.syncCoworkerAfterToolResult(toolUseId, result);
      params.syncFromRuntime(params.runtime);
    },
    onPendingApproval: async (data) => {
      if (
        !isActiveEvent({
          eventGenerationId: data.generationId,
          eventConversationId: data.conversationId,
        })
      ) {
        return;
      }
      params.markInitSignal("pending_approval", { toolName: data.toolName });
      params.currentGenerationIdRef.current = data.generationId;
      if (data.conversationId) {
        params.syncConversationForNewChat(data.conversationId);
      }
      params.runtime.handlePendingApproval(data);
      params.syncFromRuntime(params.runtime);
      if (
        params.autoApproveEnabled &&
        !isQuestionApprovalRequest({
          toolName: data.toolName,
          integration: data.integration,
          operation: data.operation,
        })
      ) {
        try {
          await params.submitApproval({
            interruptId: data.interruptId,
            decision: "approve",
          });
        } catch (err) {
          console.error("Failed to auto-approve tool use:", err);
        }
      }
    },
    onApprovalResult: (toolUseId, decision) => {
      if (!isActiveEvent()) {
        return;
      }
      params.runtime.handleApprovalResult(toolUseId, decision);
      params.syncFromRuntime(params.runtime);
    },
    onApproval: (data) => {
      if (!isActiveEvent()) {
        return;
      }
      params.runtime.handleApproval(data);
      params.syncFromRuntime(params.runtime);
    },
    onAuthNeeded: (data) => {
      if (
        !isActiveEvent({
          eventGenerationId: data.generationId,
          eventConversationId: data.conversationId,
        })
      ) {
        return;
      }
      params.markInitSignal("auth_needed", { integrations: data.integrations });
      params.currentGenerationIdRef.current = data.generationId;
      if (data.conversationId) {
        params.syncConversationForNewChat(data.conversationId);
      }
      params.runtime.handleAuthNeeded(data);
      if (
        params.authCompletionRef.current &&
        params.authCompletionRef.current.interruptId === data.interruptId &&
        data.integrations.includes(params.authCompletionRef.current.integration)
      ) {
        params.runtime.resolveAuthSuccess(params.authCompletionRef.current.integration);
      }
      params.syncFromRuntime(params.runtime);
    },
    onAuthProgress: (connected, remaining) => {
      if (!isActiveEvent()) {
        return;
      }
      params.runtime.handleAuthProgress(connected, remaining);
      params.syncFromRuntime(params.runtime);
    },
    onAuthResult: (success) => {
      if (!isActiveEvent()) {
        return;
      }
      params.runtime.handleAuthResult(success);
      params.syncFromRuntime(params.runtime);
    },
    onSandboxFile: (file) => {
      if (!isActiveEvent()) {
        return;
      }
      params.markInitSignal("sandbox_file", { filename: file.filename });
      params.runtime.handleSandboxFile(file);
      params.syncFromRuntime(params.runtime);
    },
    onStatusChange: (status, metadata) => {
      if (!isActiveEvent()) {
        return;
      }
      params.handleInitStatusChange(status, metadata);
    },
    onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
      if (
        !params.isStreamEventForActiveScope({
          scope: params.streamScope,
          streamGenerationId,
          eventGenerationId: generationId,
          eventConversationId: newConversationId,
        })
      ) {
        return;
      }
      acceptFurtherEvents = false;
      const timing =
        params.generationRequestStartedAtMs === undefined
          ? artifacts?.timing
          : withActivityDurations(
              withEndToEndDuration(
                artifacts?.timing,
                params.generationRequestStartedAtMs,
                Date.now(),
              ),
              params.runtime.getActivityStats(),
            );
      params.markInitSignal("done");
      params.runtime.handleDone({
        generationId,
        conversationId: newConversationId,
        messageId,
      });
      const assistant = params.runtime.buildAssistantMessage();
      const fallbackAssistant: Message = {
        id: messageId,
        role: "assistant",
        content: assistant.content,
        parts: assistant.parts as MessagePart[],
        integrationsUsed: assistant.integrationsUsed,
        attachments: mapDoneArtifactsAttachments(artifacts),
        sandboxFiles:
          artifacts?.sandboxFiles ?? (assistant.sandboxFiles as SandboxFileData[] | undefined),
        timing,
      };
      params.locallyCompletedGenerationIdRef.current = generationId;
      params.queryClient.setQueryData(["generation", "active", newConversationId], {
        generationId: null,
        startedAt: null,
        errorMessage: null,
        status: null,
        pauseReason: null,
        debugRunDeadlineMs: null,
        contentParts: null,
      });
      params.suppressLiveActivityRef.current = true;
      params.upsertMessageById(fallbackAssistant);
      params.handleGenerationDoneUi();
      const hydratedAssistant = await params.hydrateAssistantMessage(
        newConversationId,
        messageId,
        fallbackAssistant,
      );
      if (
        !params.isStreamEventForActiveScope({
          scope: params.streamScope,
          streamGenerationId,
          eventGenerationId: generationId,
          eventConversationId: newConversationId,
        })
      ) {
        return;
      }
      params.upsertMessageById(hydratedAssistant);
      if (params.invalidateConversationOnDone) {
        params.queryClient.invalidateQueries({ queryKey: ["conversation"] });
      }
      if (!params.activeConversationId && newConversationId) {
        params.syncConversationForNewChat(newConversationId);
      }
    },
    onError: (message) => {
      if (!isActiveEvent()) {
        return;
      }
      acceptFurtherEvents = false;
      params.handleVisibleGenerationError(message, params.runtime);
    },
    onCancelled: (data) => {
      if (
        !isActiveEvent({
          eventGenerationId: data.generationId,
          eventConversationId: data.conversationId,
        })
      ) {
        return;
      }
      acceptFurtherEvents = false;
      if (params.runtimeRef.current === params.runtime) {
        params.persistInterruptedRuntimeMessage(params.runtime, data.messageId);
      }
      params.markInitMissingAtEnd("cancelled");
      params.handleGenerationCancelledUi();
    },
  };
}
