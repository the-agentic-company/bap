import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_EXTERNAL_SEND_EVENT } from "@/components/chat/chat-area";
import { useGetOrCreateBuilderChat } from "@/orpc/hooks/coworkers";
import { useEnqueueConversationMessage } from "@/orpc/hooks/generation";
import type { UploadAttachment } from "./types";

type UseCoworkerBuilderChatInput = {
  coworkerId?: string;
  loadedCoworkerId?: string;
  isMobile: boolean;
};

export function useCoworkerBuilderChat({
  coworkerId,
  loadedCoworkerId,
  isMobile,
}: UseCoworkerBuilderChatInput) {
  const getOrCreateBuilderChat = useGetOrCreateBuilderChat();
  const enqueueConversationMessage = useEnqueueConversationMessage();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
    setConversationId(null);
    setErrorMessage(null);
    setIsLoading(false);
  }, [coworkerId]);

  const loadConversation = useCallback(
    async (targetCoworkerId: string) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const result = await getOrCreateBuilderChat.mutateAsync(targetCoworkerId);
        setConversationId(result.conversationId);
        return result.conversationId;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Please try again.";
        console.error("Failed to load builder chat:", error);
        setErrorMessage(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [getOrCreateBuilderChat],
  );

  useEffect(() => {
    if (!loadedCoworkerId || initializedRef.current || conversationId) {
      return;
    }
    initializedRef.current = true;
    void loadConversation(loadedCoworkerId);
  }, [conversationId, loadedCoworkerId, loadConversation]);

  const ensureConversationId = useCallback(async () => {
    if (conversationId) {
      return conversationId;
    }
    if (!coworkerId) {
      return null;
    }
    initializedRef.current = true;
    return await loadConversation(coworkerId);
  }, [conversationId, coworkerId, loadConversation]);

  const retry = useCallback(() => {
    if (!coworkerId) {
      return;
    }
    initializedRef.current = true;
    void loadConversation(coworkerId);
  }, [coworkerId, loadConversation]);

  const sendMessage = useCallback(
    async ({ content, attachments }: { content: string; attachments?: UploadAttachment[] }) => {
      const targetConversationId = await ensureConversationId();
      if (!targetConversationId) {
        return { status: "missing-conversation" as const };
      }

      if (!isMobile && conversationId === targetConversationId) {
        window.dispatchEvent(
          new CustomEvent(CHAT_EXTERNAL_SEND_EVENT, {
            detail: {
              conversationId: targetConversationId,
              content,
              attachments,
            },
          }),
        );
        return { status: "sent" as const, conversationId: targetConversationId };
      }

      await enqueueConversationMessage.mutateAsync({
        conversationId: targetConversationId,
        content,
        fileAttachments: attachments,
        replaceExisting: false,
      });
      return { status: "queued" as const, conversationId: targetConversationId };
    },
    [conversationId, enqueueConversationMessage, ensureConversationId, isMobile],
  );

  return {
    conversationId,
    isLoading,
    errorMessage,
    retry,
    ensureConversationId,
    sendMessage,
  };
}
