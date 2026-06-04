import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { client } from "../client";

export function useInboxItems(input?: {
  limit?: number;
  type?: "all" | "coworkers" | "chats";
  statuses?: Array<
    | "needs_user_input"
    | "running"
    | "awaiting_approval"
    | "awaiting_auth"
    | "paused"
    | "completed"
    | "error"
    | "cancelled"
  >;
  sourceCoworkerId?: string;
  query?: string;
}) {
  return useQuery({
    queryKey: [
      "inbox",
      "list",
      input?.limit ?? 20,
      input?.type ?? "all",
      input?.statuses ?? [],
      input?.sourceCoworkerId ?? null,
      input?.query ?? "",
    ],
    queryFn: () =>
      client.inbox.list({
        limit: input?.limit ?? 20,
        type: input?.type ?? "all",
        statuses: input?.statuses ?? [],
        sourceCoworkerId: input?.sourceCoworkerId,
        query: input?.query ?? "",
      }),
    refetchInterval: 2000,
  });
}

export function useInfiniteInboxItems(input?: {
  limit?: number;
  type?: "all" | "coworkers" | "chats";
  statuses?: Array<
    | "needs_user_input"
    | "running"
    | "awaiting_approval"
    | "awaiting_auth"
    | "paused"
    | "completed"
    | "error"
    | "cancelled"
  >;
  sourceCoworkerId?: string;
  query?: string;
}) {
  const query = useInfiniteQuery({
    queryKey: [
      "inbox",
      "list",
      "infinite",
      input?.limit ?? 50,
      input?.type ?? "all",
      input?.statuses ?? [],
      input?.sourceCoworkerId ?? null,
      input?.query ?? "",
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.inbox.list({
        limit: input?.limit ?? 50,
        cursor: pageParam,
        type: input?.type ?? "all",
        statuses: input?.statuses ?? [],
        sourceCoworkerId: input?.sourceCoworkerId,
        query: input?.query ?? "",
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: 2000,
  });

  const data = useMemo(
    () => ({
      items: query.data?.pages.flatMap((page) => page.items) ?? [],
      sourceOptions: query.data?.pages[0]?.sourceOptions ?? [],
    }),
    [query.data],
  );

  return {
    ...query,
    data,
  };
}

export function useInboxEditApprovalAndResend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | {
            kind: "chat";
            generationId: string;
            toolUseId: string;
            updatedToolInput: unknown;
            conversationId: string;
          }
        | {
            kind: "coworker";
            generationId: string;
            toolUseId: string;
            updatedToolInput: unknown;
            conversationId: string;
            runId: string;
          },
    ) => client.inbox.editApprovalAndResend(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["generation"] });
    },
  });
}

export function useInboxMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: "coworker" | "chat"; id: string }) =>
      client.inbox.markAsRead(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}
