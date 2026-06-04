import type { InfiniteData } from "@tanstack/react-query";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { client } from "../client";

type ConversationListQueryData = {
  conversations: Array<{
    id: string;
  }>;
};
type ConversationListPage = ConversationListQueryData & {
  nextCursor?: string;
};
type ConversationListInfiniteQueryData = InfiniteData<ConversationListPage>;
type ConversationListCacheData = ConversationListQueryData | ConversationListInfiniteQueryData;
type DeleteConversationMutationContext = {
  previousConversationLists: Array<
    [queryKey: readonly unknown[], data: ConversationListCacheData | undefined]
  >;
  previousConversation: unknown;
  previousConversationUsage: unknown;
};

function isConversationListInfiniteData(
  data: ConversationListCacheData | undefined,
): data is ConversationListInfiniteQueryData {
  return Array.isArray((data as ConversationListInfiniteQueryData | undefined)?.pages);
}

function removeConversationFromConversationListData(
  current: ConversationListCacheData | undefined,
  id: string,
): ConversationListCacheData | undefined {
  if (!current) {
    return current;
  }

  if (isConversationListInfiniteData(current)) {
    const pages = current.pages.map((page) => ({
      ...page,
      conversations: page.conversations.filter((conversation) => conversation.id !== id),
    }));
    const hasChanged = pages.some(
      (page, index) => page.conversations.length !== current.pages[index]?.conversations.length,
    );

    return hasChanged
      ? {
          ...current,
          pages,
        }
      : current;
  }

  const nextConversations = current.conversations.filter((conversation) => conversation.id !== id);
  if (nextConversations.length === current.conversations.length) {
    return current;
  }

  return {
    ...current,
    conversations: nextConversations,
  };
}

// Hook for listing conversations
export function useConversationList(options?: { limit?: number }) {
  const query = useInfiniteQuery({
    queryKey: ["conversation", "list", options?.limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.conversation.list({ limit: options?.limit ?? 50, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const data = useMemo(
    () => ({
      conversations: query.data?.pages.flatMap((page) => page.conversations) ?? [],
    }),
    [query.data],
  );

  return {
    ...query,
    data,
  };
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ["conversation", "get", id],
    queryFn: () => client.conversation.get({ id: id! }),
    enabled: !!id,
  });
}

export function useConversationImpersonationTarget(
  conversationId: string | null | undefined,
  options?: {
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: ["conversation", "impersonation-target", conversationId],
    queryFn: () => client.conversation.getImpersonationTarget({ conversationId: conversationId! }),
    enabled: (options?.enabled ?? true) && !!conversationId,
    retry: false,
  });
}

export function useConversationUsage(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["conversation", "usage", id],
    queryFn: () => client.conversation.getUsage({ id: id! }),
    enabled: enabled && Boolean(id),
  });
}

// Hook for deleting a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
    mutationFn: (id: string) => client.conversation.delete({ id }),
    onMutate: async (id): Promise<DeleteConversationMutationContext> => {
      await queryClient.cancelQueries({ queryKey: ["conversation"] });

      const previousConversationLists = queryClient.getQueriesData<ConversationListCacheData>({
        queryKey: ["conversation", "list"],
      });
      const previousConversation = queryClient.getQueryData(["conversation", "get", id]);
      const previousConversationUsage = queryClient.getQueryData(["conversation", "usage", id]);

      queryClient.setQueriesData<ConversationListCacheData>(
        { queryKey: ["conversation", "list"] },
        (current) => removeConversationFromConversationListData(current, id),
      );
      queryClient.removeQueries({
        queryKey: ["conversation", "get", id],
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: ["conversation", "usage", id],
        exact: true,
      });

      return {
        previousConversationLists,
        previousConversation,
        previousConversationUsage,
      };
    },
    onError: (_error, id, context) => {
      if (!context) {
        return;
      }

      for (const [queryKey, data] of context.previousConversationLists) {
        queryClient.setQueryData(queryKey, data);
      }

      if (context.previousConversation !== undefined) {
        queryClient.setQueryData(["conversation", "get", id], context.previousConversation);
      }
      if (context.previousConversationUsage !== undefined) {
        queryClient.setQueryData(["conversation", "usage", id], context.previousConversationUsage);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation title
export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      client.conversation.updateTitle({ id, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation pin state
export function useUpdateConversationPinned() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      client.conversation.updatePinned({ id, isPinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for marking a conversation as seen in sidebar
export function useMarkConversationSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, seenMessageCount }: { id: string; seenMessageCount: number }) =>
      client.conversation.markSeen({ id, seenMessageCount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for marking all conversations as seen in sidebar
export function useMarkAllConversationsSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.conversation.markAllSeen({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation auto-approve setting
export function useUpdateAutoApprove() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, autoApprove }: { id: string; autoApprove: boolean }) =>
      client.conversation.updateAutoApprove({ id, autoApprove }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for sharing a conversation
export function useShareConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.conversation.share({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for unsharing a conversation
export function useUnshareConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.conversation.unshare({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

export function useDownloadAttachment() {
  return useMutation({
    mutationFn: (attachmentId: string) => client.conversation.downloadAttachment({ attachmentId }),
  });
}

// Hook for downloading a sandbox file (returns presigned URL)
export function useDownloadSandboxFile() {
  return useMutation({
    mutationFn: (fileId: string) => client.conversation.downloadSandboxFile({ fileId }),
  });
}

export function useOutputHtmlPreview(fileId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["conversation", "output-html-preview", fileId],
    queryFn: () => client.conversation.previewSandboxOutputHtml({ fileId: fileId! }),
    enabled: enabled && !!fileId,
  });
}
