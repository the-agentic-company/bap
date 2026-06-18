// oxlint-disable eslint/no-underscore-dangle

import { useNavigate } from "@tanstack/react-router";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { createElement, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ModelSelector } from "@/components/chat/model-selector";
import { startCoworkerBuilderGeneration } from "@/components/landing/start-coworker-builder-generation";
import { blobToBase64, useVoiceRecording } from "@/hooks/use-voice-recording";
import { normalizeChatModelSelection } from "@/lib/chat-model-selection";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { useCreateCoworker } from "@/orpc/hooks/coworkers";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { useTranscribe } from "@/orpc/hooks/voice";

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

type DoCreateInput = {
  initialMessage?: string;
  name?: string;
  prompt: string;
  triggerType: "manual" | "schedule" | "email" | "webhook";
};

type InputPrefillRequest = {
  id: string;
  text: string;
  mode?: "replace" | "append";
} | null;

/**
 * Owns the dormant inline coworker-builder composer plus the live `doCreate`
 * mutation path. The composer (voice capture, model selector node, prompt
 * submit) is currently not rendered, but the hooks it mounts
 * (`useVoiceRecording`, `useTranscribe`) and the values it derives are kept
 * alive so behaviour is unchanged and so a single seam re-enables the feature.
 *
 * `doCreate`, `model`, and `modelAuthSource` are consumed by the inventory hook
 * for the live "create coworker" flow.
 */
export function useCoworkerComposer({ currentFolderId }: { currentFolderId: string | null }) {
  const navigate = useNavigate();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const createCoworker = useCreateCoworker();
  const { isRecording, error: _voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  const [isCreating, setIsCreating] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [_inputPrefillRequest, setInputPrefillRequest] = useState<InputPrefillRequest>(null);
  const [model, setModel] = useState(DEFAULT_COWORKER_BUILDER_MODEL);
  const [modelAuthSource, setModelAuthSource] = useState<ProviderAuthSource | null>("shared");
  const isRecordingRef = useRef(false);

  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );

  const _stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        setInputPrefillRequest({
          id: `coworker-voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (error) {
      console.error("Coworker transcription error:", error);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe]);

  const _handleStartRecording = useCallback(() => {
    if (isCreating || isProcessingVoice || isRecordingRef.current) {
      return;
    }

    isRecordingRef.current = true;
    void startRecording();
  }, [isCreating, isProcessingVoice, startRecording]);

  const handleModelChange = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      const normalized = normalizeChatModelSelection(input);
      if (!normalized.model) {
        return;
      }

      setModel(normalized.model);
      setModelAuthSource(normalized.authSource);
    },
    [],
  );

  const _modelSelectorNode = useMemo(
    () =>
      createElement(ModelSelector, {
        selectedModel: model,
        selectedAuthSource: modelAuthSource,
        providerAvailability,
        onSelectionChange: handleModelChange,
        disabled: isCreating || isRecording || isProcessingVoice,
      }),
    [
      handleModelChange,
      isCreating,
      isProcessingVoice,
      isRecording,
      model,
      modelAuthSource,
      providerAvailability,
    ],
  );

  const doCreate = useCallback(
    async ({ initialMessage, name, prompt: coworkerPrompt, triggerType }: DoCreateInput) => {
      const result = await createCoworker.mutateAsync({
        name,
        triggerType,
        prompt: coworkerPrompt,
        model,
        authSource: modelAuthSource,
        toolAccessMode: "all",
        allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
        folderId: currentFolderId,
      });

      const text = initialMessage?.trim() ?? "";
      if (text) {
        await startCoworkerBuilderGeneration({
          coworkerId: result.id,
          content: text,
          model,
          authSource: modelAuthSource,
        });
      }

      void navigate({ to: "/agents/edit/$id", params: { id: result.id } });
    },
    [createCoworker, currentFolderId, model, modelAuthSource, navigate],
  );

  const _handlePromptSubmit = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText || isCreating || isProcessingVoice) {
        return;
      }

      setIsCreating(true);
      try {
        await doCreate({
          initialMessage: trimmedText,
          name: "",
          prompt: "",
          triggerType: "manual",
        });
      } catch (error) {
        toast.error(normalizeGenerationError(error, "start_rpc").message);
        setIsCreating(false);
      }
    },
    [doCreate, isCreating, isProcessingVoice],
  );

  return {
    model,
    modelAuthSource,
    doCreate,
    handleModelChange,
    isCreating,
    setIsCreating,
    isRecording,
    isProcessingVoice,
    _voiceError,
    _inputPrefillRequest,
    _modelSelectorNode,
    _handlePromptSubmit,
    _handleStartRecording,
    _stopRecordingAndTranscribe,
  };
}
