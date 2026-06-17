import { useCallback, useRef } from "react";
import type { GenerationRuntime } from "@/lib/generation-runtime";

export function useChatGenerationRefs(conversationId: string | undefined) {
  const currentGenerationIdRef = useRef<string | undefined>(undefined);
  const locallyStoppedGenerationIdRef = useRef<string | null>(null);
  const locallyCompletedGenerationIdRef = useRef<string | null>(null);
  const runtimeRef = useRef<GenerationRuntime | null>(null);
  const authCompletionRef = useRef<{ integration: string; interruptId: string } | null>(null);
  const currentConversationIdRef = useRef<string | undefined>(conversationId);
  const viewedConversationIdRef = useRef<string | undefined>(conversationId);
  const streamScopeRef = useRef(0);
  const suppressLiveActivityRef = useRef(false);

  const setAuthCompletionRef = useCallback(
    (completion: { integration: string; interruptId: string } | null) => {
      authCompletionRef.current = completion;
    },
    [],
  );
  const setCurrentConversationIdRef = useCallback((id: string | undefined) => {
    currentConversationIdRef.current = id;
  }, []);
  const setCurrentGenerationIdRef = useCallback((id: string | undefined) => {
    currentGenerationIdRef.current = id;
  }, []);
  const setViewedConversationIdRef = useCallback((id: string | undefined) => {
    viewedConversationIdRef.current = id;
  }, []);
  const incrementStreamScopeRef = useCallback(() => {
    streamScopeRef.current += 1;
  }, []);
  const setLocallyCompletedGenerationIdRef = useCallback((id: string | null) => {
    locallyCompletedGenerationIdRef.current = id;
  }, []);
  const setLocallyStoppedGenerationIdRef = useCallback((id: string | null) => {
    locallyStoppedGenerationIdRef.current = id;
  }, []);
  const setRuntimeRef = useCallback((runtime: GenerationRuntime | null) => {
    runtimeRef.current = runtime;
  }, []);
  const setSuppressLiveActivityRef = useCallback((suppress: boolean) => {
    suppressLiveActivityRef.current = suppress;
  }, []);

  return {
    authCompletionRef,
    currentConversationIdRef,
    currentGenerationIdRef,
    locallyCompletedGenerationIdRef,
    locallyStoppedGenerationIdRef,
    runtimeRef,
    incrementStreamScopeRef,
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
  };
}
