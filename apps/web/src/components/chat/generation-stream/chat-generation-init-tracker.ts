import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "../chat-performance-metrics";

const NON_ERROR_INIT_END_REASONS = new Set(["cancelled", "user_stopped"]);

type PostHogLike = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
};

export function useGenerationInitTracker({
  isStreaming,
  hasActivitySegments,
  currentConversationId,
  currentGenerationId,
  normalizedSelectedModel,
  posthog,
}: {
  isStreaming: boolean;
  hasActivitySegments: boolean;
  currentConversationId: () => string | undefined;
  currentGenerationId: () => string | undefined;
  normalizedSelectedModel: string;
  posthog?: PostHogLike | null;
}) {
  const [agentInitStatus, setAgentInitStatus] = useState<string | null>(null);
  const [streamClockNow, setStreamClockNow] = useState(() => Date.now());
  const initTrackingStartedAtRef = useRef<number | null>(null);
  const initSignalReceivedAtRef = useRef<number | null>(null);
  const initSignalEventTypeRef = useRef<string | null>(null);
  const initTimeoutEventSentRef = useRef(false);
  const initWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInitTracking = useCallback(() => {
    initTrackingStartedAtRef.current = null;
    initSignalReceivedAtRef.current = null;
    initSignalEventTypeRef.current = null;
    initTimeoutEventSentRef.current = false;
    if (initWatchdogTimerRef.current) {
      clearTimeout(initWatchdogTimerRef.current);
      initWatchdogTimerRef.current = null;
    }
    setAgentInitStatus(null);
  }, []);

  const beginInitTracking = useCallback(
    (source: "new_generation" | "reconnect", startedAtMs?: number) => {
      const startedAt = startedAtMs ?? Date.now();
      resetInitTracking();
      initTrackingStartedAtRef.current = startedAt;
      setAgentInitStatus("sandbox_init_started");
      console.info(
        `[AgentInit][Client] started source=${source} conversationId=${currentConversationId() ?? "new"}`,
      );
      posthog?.capture("agent_creation_started", {
        source,
        startedAtMs: startedAt,
        conversationId: currentConversationId() ?? null,
        generationId: currentGenerationId() ?? null,
        model: normalizedSelectedModel,
      });

      initWatchdogTimerRef.current = setTimeout(() => {
        if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
          return;
        }
        initTimeoutEventSentRef.current = true;
        const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
        console.warn(
          `[AgentInit][Client] timeout_no_init elapsedMs=${elapsedMs} conversationId=${currentConversationId() ?? "new"} generationId=${currentGenerationId() ?? "unknown"}`,
        );
        posthog?.capture("agent_init_timeout", {
          elapsedMs,
          conversationId: currentConversationId() ?? null,
          generationId: currentGenerationId() ?? null,
          model: normalizedSelectedModel,
        });
      }, 20_000);
    },
    [
      currentConversationId,
      currentGenerationId,
      normalizedSelectedModel,
      posthog,
      resetInitTracking,
    ],
  );

  const markInitSignal = useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }
      const now = Date.now();
      const elapsedMs = now - initTrackingStartedAtRef.current;
      initSignalReceivedAtRef.current = now;
      initSignalEventTypeRef.current = eventType;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      console.info(
        `[AgentInit][Client] init_signal_received event=${eventType} elapsedMs=${elapsedMs} conversationId=${currentConversationId() ?? "new"} generationId=${currentGenerationId() ?? "unknown"}`,
      );
      posthog?.capture("agent_init_signal_received", {
        eventType,
        elapsedMs,
        conversationId: currentConversationId() ?? null,
        generationId: currentGenerationId() ?? null,
        model: normalizedSelectedModel,
        ...metadata,
      });
    },
    [currentConversationId, currentGenerationId, normalizedSelectedModel, posthog],
  );

  const markInitMissingAtEnd = useCallback(
    (endReason: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }

      const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      const conversationId = currentConversationId() ?? "new";
      const generationId =
        typeof metadata?.generationId === "string"
          ? metadata.generationId
          : (currentGenerationId() ?? "unknown");
      const logMessage = `[AgentInit][Client] missing_init endReason=${endReason} elapsedMs=${elapsedMs} conversationId=${conversationId} generationId=${generationId}`;
      if (NON_ERROR_INIT_END_REASONS.has(endReason)) {
        console.info(logMessage);
      } else {
        console.error(logMessage);
      }
      posthog?.capture("agent_init_missing", {
        endReason,
        elapsedMs,
        didTimeout: initTimeoutEventSentRef.current,
        conversationId: currentConversationId() ?? null,
        generationId: generationId === "unknown" ? null : generationId,
        model: normalizedSelectedModel,
        ...metadata,
      });
    },
    [currentConversationId, currentGenerationId, normalizedSelectedModel, posthog],
  );

  const streamElapsedMs = useMemo(() => {
    if (!initTrackingStartedAtRef.current) {
      return null;
    }
    return Math.max(0, streamClockNow - initTrackingStartedAtRef.current);
  }, [streamClockNow]);

  const initElapsedLabel = useMemo(() => {
    if (!isStreaming || hasActivitySegments || streamElapsedMs === null) {
      return null;
    }
    return formatDuration(streamElapsedMs);
  }, [hasActivitySegments, isStreaming, streamElapsedMs]);

  useEffect(() => {
    const shouldRunStreamTimer = isStreaming && initTrackingStartedAtRef.current !== null;
    if (!shouldRunStreamTimer) {
      return;
    }
    const interval = window.setInterval(() => setStreamClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  useEffect(() => () => resetInitTracking(), [resetInitTracking]);

  return {
    agentInitStatus,
    beginInitTracking,
    initElapsedLabel,
    markInitMissingAtEnd,
    markInitSignal,
    resetInitTracking,
    setAgentInitStatus,
    streamElapsedMs,
  };
}
