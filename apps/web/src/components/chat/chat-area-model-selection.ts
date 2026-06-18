import {
  DEFAULT_CONNECTED_CHATGPT_MODEL,
  resolveDefaultChatModel,
  shouldMigrateLegacyDefaultModel,
} from "@bap/core/lib/chat-model-defaults";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { useEffect, useMemo } from "react";
import { isModelAccessibleForNewChat } from "@/lib/chat-model-access";
import { normalizeChatModelReference } from "@/lib/chat-model-reference";
import {
  normalizeChatModelSelection,
  resolveDefaultChatModelSelection,
} from "@/lib/chat-model-selection";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { useProviderAuthStatus, useOpencodeFreeModels } from "@/orpc/hooks/provider-auth";
import { useChatModelStore } from "./chat-model-store";

type ConversationModelSelection = {
  authSource?: ProviderAuthSource | null;
  model?: string | null;
  type?: "chat" | "coworker" | null;
};

const DEFAULT_VISIBLE_CHAT_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

export function useChatAreaModelSelection({
  conversationId,
  existingConversation,
  isAdmin,
  isAdminLoading,
}: {
  conversationId?: string;
  existingConversation: unknown;
  isAdmin: boolean;
  isAdminLoading: boolean;
}) {
  const selectedModel = useChatModelStore((state) => state.selectedModel);
  const selectedAuthSource = useChatModelStore((state) => state.selectedAuthSource);
  const setSelection = useChatModelStore((state) => state.setSelection);
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: opencodeFreeModelsData } = useOpencodeFreeModels();

  const conversation = existingConversation as ConversationModelSelection | null | undefined;
  const conversationModel = conversation?.model;
  const conversationAuthSource = conversation?.authSource;
  const conversationType = conversation?.type;
  const isCoworkerConversation = conversationType === "coworker";

  const connectedProviders = providerAuthStatus?.connected;
  const sharedConnectedProviders = providerAuthStatus?.shared;
  const isUserOpenAIConnected = Boolean(connectedProviders?.openai);
  const isSharedOpenAIConnected = Boolean(sharedConnectedProviders?.openai);
  const isOpenAIConnected = isUserOpenAIConnected || isSharedOpenAIConnected;

  const normalizedSelectedSelection = useMemo(
    () =>
      normalizeChatModelSelection({
        model: selectedModel,
        authSource: selectedAuthSource,
      }),
    [selectedAuthSource, selectedModel],
  );
  const normalizedSelectedModel = useMemo(
    () => normalizedSelectedSelection.model || normalizeChatModelReference(selectedModel),
    [normalizedSelectedSelection.model, selectedModel],
  );
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders,
        sharedConnectedProviders,
      }),
    [connectedProviders, sharedConnectedProviders],
  );
  const resolvedDefaultModel = useMemo(
    () =>
      isOpenAIConnected
        ? resolveDefaultChatModel({
            isOpenAIConnected,
            availableOpencodeFreeModelIDs: (opencodeFreeModelsData?.models ?? []).map(
              (model) => model.id,
            ),
          })
        : DEFAULT_VISIBLE_CHAT_MODEL,
    [isOpenAIConnected, opencodeFreeModelsData],
  );
  const resolvedDefaultSelection = useMemo(
    () =>
      resolveDefaultChatModelSelection({
        model: resolvedDefaultModel,
        providerAvailabilityByProvider: providerAvailability,
      }),
    [providerAvailability, resolvedDefaultModel],
  );
  const normalizedConversationSelection = useMemo(
    () =>
      normalizeChatModelSelection({
        model: conversationModel,
        authSource: conversationAuthSource,
      }),
    [conversationAuthSource, conversationModel],
  );
  const showModelSwitchWarning = Boolean(
    conversationId &&
    normalizedConversationSelection.model &&
    (normalizedSelectedModel !== normalizedConversationSelection.model ||
      selectedAuthSource !== normalizedConversationSelection.authSource) &&
    !isCoworkerConversation,
  );

  useEffect(() => {
    if (
      !normalizedSelectedSelection.model ||
      (normalizedSelectedSelection.model === selectedModel &&
        normalizedSelectedSelection.authSource === selectedAuthSource)
    ) {
      return;
    }
    setSelection(normalizedSelectedSelection);
  }, [normalizedSelectedSelection, selectedAuthSource, selectedModel, setSelection]);

  useEffect(() => {
    if (conversationId || isAdminLoading) {
      return;
    }

    const shouldMigrateLegacyModel = shouldMigrateLegacyDefaultModel({
      currentModel: normalizedSelectedModel,
      isOpenAIConnected,
    });
    const isAccessible = isModelAccessibleForNewChat({
      model: normalizedSelectedModel,
      authSource: selectedAuthSource,
      isAdmin,
      providerAvailabilityByProvider: providerAvailability,
    });
    const isHiddenOpencodeModel = normalizedSelectedModel.startsWith("opencode/");

    if (
      (shouldMigrateLegacyModel || !isAccessible || isHiddenOpencodeModel) &&
      (resolvedDefaultSelection.model !== normalizedSelectedModel ||
        resolvedDefaultSelection.authSource !== selectedAuthSource)
    ) {
      setSelection(resolvedDefaultSelection);
    }
  }, [
    conversationId,
    isAdmin,
    isAdminLoading,
    isOpenAIConnected,
    normalizedSelectedModel,
    providerAvailability,
    resolvedDefaultSelection,
    selectedAuthSource,
    setSelection,
  ]);

  return {
    isCoworkerConversation,
    normalizedSelectedModel,
    providerAvailability,
    selectedAuthSource,
    setSelection,
    showModelSwitchWarning,
  };
}
