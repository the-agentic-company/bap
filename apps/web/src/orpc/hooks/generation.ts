import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { GENERATION_ERROR_PHASES } from "@bap/core/lib/generation-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { runGenerationStream, type GenerationCallbacks } from "@/lib/generation-stream";
import { client } from "../client";

const STREAM_NOT_READY_ERROR =
  "Generation is still processing but cannot be streamed from this server yet. Please refresh shortly.";
const STREAM_RETRY_DELAY_MS = 1500;
const STREAM_MAX_RETRIES = 80;

function isStreamNotReadyError(message: string | undefined): boolean {
  return (message ?? "").trim() === STREAM_NOT_READY_ERROR;
}

async function waitForRetry(signal: AbortSignal, delayMs: number): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Hook for generation-based streaming (new persistent generation system)
export function useGeneration() {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  const startGeneration = useCallback(
    async (
      input: {
        conversationId?: string;
        content: string;
        model?: string;
        authSource?: ProviderAuthSource | null;
        autoApprove?: boolean;
        resumePausedGenerationId?: string;
        debugRunDeadlineMs?: number;
        debugApprovalHotWaitMs?: number;
        selectedPlatformSkillSlugs?: string[];
        fileAttachments?: { name: string; mimeType: string; dataUrl: string }[];
      },
      callbacks: GenerationCallbacks,
    ): Promise<{ generationId: string; conversationId: string } | null> => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      let currentGenerationId: string | undefined;
      let currentConversationId: string | undefined;
      let retries = 0;

      try {
        const streamUntilDone = async (): Promise<{
          generationId: string;
          conversationId: string;
        } | null> => {
          if (signal.aborted) {
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }

          let streamNotReady = false;
          const result = await runGenerationStream({
            client,
            input: currentGenerationId ? undefined : input,
            generationId: currentGenerationId,
            signal,
            callbacks: {
              ...callbacks,
              onStarted: (generationId, conversationId) => {
                currentGenerationId = generationId;
                currentConversationId = conversationId;
                callbacks.onStarted?.(generationId, conversationId);
                queryClient.invalidateQueries({
                  queryKey: ["conversation", "get", conversationId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["conversation", "list"],
                });
                queryClient.invalidateQueries({
                  queryKey: ["generation"],
                });
              },
              onDone: (generationId, conversationId, messageId, usage, artifacts) => {
                callbacks.onDone?.(generationId, conversationId, messageId, usage, artifacts);
                queryClient.invalidateQueries({ queryKey: ["conversation"] });
                queryClient.invalidateQueries({ queryKey: ["generation"] });
              },
              onError: (error) => {
                if (isStreamNotReadyError(error.message)) {
                  streamNotReady = true;
                  return;
                }
                callbacks.onError?.(error);
              },
            },
          });

          if (result) {
            currentGenerationId = result.generationId;
            currentConversationId = result.conversationId;
          }

          if (!streamNotReady) {
            return (
              result ??
              (currentGenerationId && currentConversationId
                ? {
                    generationId: currentGenerationId,
                    conversationId: currentConversationId,
                  }
                : null)
            );
          }

          if (retries >= STREAM_MAX_RETRIES) {
            callbacks.onError?.(
              normalizeGenerationError(STREAM_NOT_READY_ERROR, GENERATION_ERROR_PHASES.STREAM),
            );
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }

          retries += 1;
          const shouldContinue = await waitForRetry(signal, STREAM_RETRY_DELAY_MS);
          if (!shouldContinue) {
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }
          return streamUntilDone();
        };

        return await streamUntilDone();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return null;
        }
        callbacks.onError?.(
          normalizeGenerationError(
            error,
            currentGenerationId
              ? GENERATION_ERROR_PHASES.STREAM
              : GENERATION_ERROR_PHASES.START_RPC,
          ),
        );
        return null;
      } finally {
        abortControllerRef.current = null;
      }
    },
    [queryClient],
  );

  const subscribeToGeneration = useCallback(
    async (generationId: string, callbacks: GenerationCallbacks) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      const currentGenerationId: string | undefined = generationId;
      let retries = 0;

      try {
        const streamUntilDone = async (): Promise<void> => {
          if (signal.aborted || !currentGenerationId) {
            return;
          }

          let streamNotReady = false;
          await runGenerationStream({
            client,
            generationId: currentGenerationId,
            signal,
            callbacks: {
              ...callbacks,
              onDone: (doneGenerationId, doneConversationId, messageId, usage, artifacts) => {
                callbacks.onDone?.(
                  doneGenerationId,
                  doneConversationId,
                  messageId,
                  usage,
                  artifacts,
                );
                queryClient.invalidateQueries({ queryKey: ["conversation"] });
              },
              onError: (error) => {
                if (isStreamNotReadyError(error.message)) {
                  streamNotReady = true;
                  return;
                }
                callbacks.onError?.(error);
              },
            },
          });

          if (!streamNotReady) {
            return;
          }

          if (retries >= STREAM_MAX_RETRIES) {
            callbacks.onError?.(
              normalizeGenerationError(STREAM_NOT_READY_ERROR, GENERATION_ERROR_PHASES.RECONNECT),
            );
            return;
          }

          retries += 1;
          const shouldContinue = await waitForRetry(signal, STREAM_RETRY_DELAY_MS);
          if (!shouldContinue) {
            return;
          }
          return streamUntilDone();
        };

        await streamUntilDone();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        callbacks.onError?.(normalizeGenerationError(error, GENERATION_ERROR_PHASES.RECONNECT));
      } finally {
        abortControllerRef.current = null;
      }
    },
    [queryClient],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { startGeneration, subscribeToGeneration, abort };
}

export function useDetectUserMessageLanguage() {
  return useMutation({
    mutationFn: ({ text }: { text: string }) =>
      client.generation.detectUserMessageLanguage({ text }),
  });
}

export function useConversationQueuedMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["generation", "queuedMessages", conversationId],
    queryFn: () =>
      client.generation.listConversationQueuedMessages({
        conversationId: conversationId!,
      }),
    enabled: !!conversationId,
    refetchInterval: 2000,
  });
}

export function useEnqueueConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      content,
      selectedPlatformSkillSlugs,
      fileAttachments,
      replaceExisting,
    }: {
      conversationId: string;
      content: string;
      selectedPlatformSkillSlugs?: string[];
      fileAttachments?: { name: string; mimeType: string; dataUrl: string }[];
      replaceExisting?: boolean;
    }) =>
      client.generation.enqueueConversationMessage({
        conversationId,
        content,
        selectedPlatformSkillSlugs,
        fileAttachments,
        replaceExisting,
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["generation", "queuedMessages", variables.conversationId],
      });
    },
  });
}

const activeAgenticAppPromptStatuses = new Set([
  "generating",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

export function useSendAgenticAppPrompt(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  return useCallback(
    async (prompt: string): Promise<boolean> => {
      if (!conversationId || prompt.trim().length === 0) {
        return false;
      }

      const activeGeneration = await client.generation.getActiveGeneration({ conversationId });
      if (activeGeneration.status && activeAgenticAppPromptStatuses.has(activeGeneration.status)) {
        await client.generation.enqueueConversationMessage({
          conversationId,
          content: prompt,
          replaceExisting: false,
        });
      } else {
        await client.generation.startGeneration({
          conversationId,
          content: prompt,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation", "get", conversationId] }),
        queryClient.invalidateQueries({ queryKey: ["conversation"] }),
        queryClient.invalidateQueries({ queryKey: ["generation"] }),
        queryClient.invalidateQueries({
          queryKey: ["generation", "queuedMessages", conversationId],
        }),
        queryClient.invalidateQueries({ queryKey: ["coworker"] }),
      ]);

      return true;
    },
    [conversationId, queryClient],
  );
}

export function useRemoveConversationQueuedMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      queuedMessageId,
      conversationId,
    }: {
      queuedMessageId: string;
      conversationId: string;
    }) =>
      client.generation.removeConversationQueuedMessage({
        queuedMessageId,
        conversationId,
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["generation", "queuedMessages", variables.conversationId],
      });
    },
  });
}

export function useUpdateConversationQueuedMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      queuedMessageId,
      conversationId,
      content,
      selectedPlatformSkillSlugs,
      fileAttachments,
    }: {
      queuedMessageId: string;
      conversationId: string;
      content: string;
      selectedPlatformSkillSlugs?: string[];
      fileAttachments?: { name: string; mimeType: string; dataUrl: string }[];
    }) =>
      client.generation.updateConversationQueuedMessage({
        queuedMessageId,
        conversationId,
        content,
        selectedPlatformSkillSlugs,
        fileAttachments,
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["generation", "queuedMessages", variables.conversationId],
      });
    },
  });
}

// Hook for canceling a generation
export function useCancelGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (generationId: string) => client.generation.cancelGeneration({ generationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["generation"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

// Hook for submitting tool approval (new generation system)
export function useSubmitApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      interruptId,
      decision,
      questionAnswers,
    }: {
      interruptId: string;
      decision: "approve" | "deny";
      questionAnswers?: string[][];
    }) =>
      client.generation.submitApproval({
        interruptId,
        decision,
        questionAnswers,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["generation"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

// Hook for submitting auth result (after OAuth completes)
export function useSubmitAuthResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      interruptId,
      integration,
      success,
    }: {
      interruptId: string;
      integration: string;
      success: boolean;
    }) =>
      client.generation.submitAuthResult({
        interruptId,
        integration,
        success,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["generation"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

// Hook for getting active generation for a conversation
export function useActiveGeneration(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["generation", "active", conversationId],
    queryFn: () =>
      client.generation.getActiveGeneration({
        conversationId: conversationId!,
      }),
    enabled: !!conversationId,
    refetchInterval: (query) => {
      // Poll while generating or awaiting auth
      const status = query.state.data?.status;
      if (status === "generating" || status === "awaiting_approval" || status === "awaiting_auth") {
        return 2000;
      }
      return false;
    },
  });
}
