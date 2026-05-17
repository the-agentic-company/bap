"use client";

import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import { GENERATION_ERROR_PHASES } from "@cmdclaw/core/lib/generation-errors";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { normalizeGenerationError } from "@/lib/generation-errors";
import {
  runGenerationStream,
  type SandboxFileData,
  type GenerationCallbacks,
} from "@/lib/generation-stream";
import { client } from "./client";

type CoworkerToolAccessMode = "all" | "selected";
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

function encodeRpcContent(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

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

export type { SandboxFileData };

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

export function useInboxItems(input?: {
  limit?: number;
  type?: "all" | "coworkers" | "chats";
  statuses?: Array<"awaiting_approval" | "awaiting_auth" | "paused" | "error">;
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

// Hook for getting a single conversation
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

// Hook for listing integrations
export function useIntegrationList() {
  return useQuery({
    queryKey: ["integration", "list"],
    queryFn: () => client.integration.list(),
  });
}

export function useGoogleAccessStatus() {
  return useQuery({
    queryKey: ["integration", "google-access-status"],
    queryFn: () => client.integration.getGoogleAccessStatus(),
  });
}

export function useGalienStatus() {
  return useQuery({
    queryKey: ["galien", "status"],
    queryFn: () => client.galien.status(),
  });
}

export function useConnectGalien() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { username: string; password: string }) => client.galien.connect(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useDisconnectGalien() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.galien.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["galien", "status"] });
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useAdminGalienAccess(workspaceId: string | null) {
  return useQuery({
    queryKey: ["galien", "admin-access", workspaceId],
    queryFn: () => client.galien.adminListAccess({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useAdminAddGalienAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; email: string }) =>
      client.galien.adminAddAccess(input),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["galien", "admin-access", input.workspaceId] });
    },
  });
}

export function useAdminRemoveGalienAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; workspaceId: string }) =>
      client.galien.adminRemoveAccess({ id: input.id }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["galien", "admin-access", input.workspaceId] });
    },
  });
}

export function useApprovedLoginEmailAllowlist() {
  return useQuery({
    queryKey: ["integration", "approved-login-email-allowlist"],
    queryFn: () => client.integration.listApprovedLoginEmailAllowlist(),
  });
}

export function useAddApprovedLoginEmailAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      client.integration.addApprovedLoginEmailAllowlistEntry({ email }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "approved-login-email-allowlist"],
      });
    },
  });
}

export function useRemoveApprovedLoginEmailAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      client.integration.removeApprovedLoginEmailAllowlistEntry({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "approved-login-email-allowlist"],
      });
    },
  });
}

export function useGoogleAccessAllowlist() {
  return useQuery({
    queryKey: ["integration", "google-access-allowlist"],
    queryFn: () => client.integration.listGoogleAccessAllowlist(),
  });
}

export function useAddGoogleAccessAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      client.integration.addGoogleAccessAllowlistEntry({ email }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-allowlist"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

export function useRemoveGoogleAccessAllowlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      client.integration.removeGoogleAccessAllowlistEntry({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-allowlist"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

export function useRequestGoogleAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      integration,
      source,
    }: {
      integration?:
        | "google_gmail"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive";
      source?: "integrations" | "chat" | "onboarding";
    }) => client.integration.requestGoogleAccess({ integration, source }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration", "google-access-status"],
      });
    },
  });
}

// Hook for toggling integration
export function useToggleIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      client.integration.toggle({ id, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for disconnecting integration
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.integration.disconnect({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for getting OAuth URL
export function useGetAuthUrl() {
  return useMutation({
    mutationFn: ({
      type,
      redirectUrl,
    }: {
      type:
        | "google_gmail"
        | "outlook"
        | "outlook_calendar"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive"
        | "notion"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics"
        | "reddit"
        | "twitter";
      redirectUrl: string;
    }) => client.integration.getAuthUrl({ type, redirectUrl }),
  });
}

// Hook for linking LinkedIn account after redirect
export function useLinkLinkedIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => client.integration.linkLinkedIn({ accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// ========== EXECUTOR SOURCE HOOKS ==========

export function useExecutorSourceList() {
  return useQuery({
    queryKey: ["executorSource", "list"],
    queryFn: () => client.executorSource.list(),
  });
}

export function useCreateExecutorSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      kind: "mcp" | "openapi";
      name: string;
      namespace: string;
      endpoint: string;
      specUrl?: string | null;
      transport?: string | null;
      headers?: Record<string, string>;
      queryParams?: Record<string, string>;
      defaultHeaders?: Record<string, string>;
      authType?: "none" | "api_key" | "bearer" | "oauth2";
      authHeaderName?: string | null;
      authQueryParam?: string | null;
      authPrefix?: string | null;
      enabled?: boolean;
    }) => client.executorSource.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useUpdateExecutorSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      kind: "mcp" | "openapi";
      name: string;
      namespace: string;
      endpoint: string;
      specUrl?: string | null;
      transport?: string | null;
      headers?: Record<string, string>;
      queryParams?: Record<string, string>;
      defaultHeaders?: Record<string, string>;
      authType?: "none" | "api_key" | "bearer" | "oauth2";
      authHeaderName?: string | null;
      authQueryParam?: string | null;
      authPrefix?: string | null;
      enabled?: boolean;
    }) => client.executorSource.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useDeleteExecutorSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.executorSource.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useStartExecutorSourceOAuth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceExecutorSourceId: string; redirectUrl: string }) =>
      client.executorSource.startOAuth(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useSetExecutorSourceCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      workspaceExecutorSourceId: string;
      secret: string;
      displayName?: string | null;
      enabled?: boolean;
    }) => client.executorSource.setCredential(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

export function useDisconnectExecutorSourceCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceExecutorSourceId: string) =>
      client.executorSource.disconnectCredential({ workspaceExecutorSourceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executorSource"] });
    },
  });
}

// Hook for voice transcription
export function useTranscribe() {
  return useMutation({
    mutationFn: ({ audio, mimeType }: { audio: string; mimeType: string }) =>
      client.voice.transcribe({ audio, mimeType }),
  });
}

// ========== SKILL HOOKS ==========

// Hook for listing skills
export function useSkillList() {
  return useQuery({
    queryKey: ["skill", "list"],
    queryFn: () => client.skill.list(),
  });
}

// Hook for getting a single skill
export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skill", "get", id],
    queryFn: () => client.skill.get({ id: id! }),
    enabled: !!id,
  });
}

// Hook for creating a skill
export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ displayName, description }: { displayName: string; description: string }) =>
      client.skill.create({ displayName, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useImportSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      input:
        | {
            mode: "zip";
            filename: string;
            contentBase64: string;
          }
        | {
            mode: "folder";
            files: Array<{
              path: string;
              mimeType?: string;
              contentBase64: string;
            }>;
          },
    ) => client.skill.import(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a skill
export function useUpdateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name,
      displayName,
      description,
      icon,
      enabled,
    }: {
      id: string;
      name?: string;
      displayName?: string;
      description?: string;
      icon?: string | null;
      enabled?: boolean;
    }) =>
      client.skill.update({
        id,
        name,
        displayName,
        description,
        icon,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for deleting a skill
export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
    mutationFn: (id: string) => client.skill.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useShareSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.share({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useUnshareSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.unshare({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

export function useSaveSharedSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceSkillId: string) => client.skill.saveShared({ sourceSkillId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for adding a file to a skill
export function useAddSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skillId, path, content }: { skillId: string; path: string; content: string }) =>
      client.skill.addFile({ skillId, path, contentBase64: encodeRpcContent(content) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a file
export function useUpdateSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      client.skill.updateFile({ id, contentBase64: encodeRpcContent(content) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== COWORKER HOOKS ==========

const ACTIVE_COWORKER_RUN_STATUSES = new Set([
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

function isActiveCoworkerRunStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && ACTIVE_COWORKER_RUN_STATUSES.has(status);
}

export function useCoworkerList() {
  return useQuery({
    queryKey: ["coworker", "list"],
    queryFn: () => client.coworker.list(),
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (coworker) =>
          isActiveCoworkerRunStatus(coworker.lastRunStatus) ||
          (coworker.recentRuns ?? []).some((run) => isActiveCoworkerRunStatus(run.status)),
      )
        ? 5_000
        : false,
  });
}

export function useCoworkerOverview() {
  return useQuery({
    queryKey: ["coworker", "overview"],
    queryFn: () => client.coworker.getOverview(),
    refetchInterval: 60_000,
  });
}

export function useWorkspaceUsageDashboard() {
  return useQuery({
    queryKey: ["coworker", "usageDashboard"],
    queryFn: () => client.coworker.getUsageDashboard(),
    refetchInterval: 120_000,
  });
}

type CoworkerHistoryPage = Awaited<ReturnType<typeof client.coworker.getHistory>>;
export type CoworkerHistoryEntry = CoworkerHistoryPage["entries"][number];

export function useCoworkerHistory(dateRange?: { from?: Date; to?: Date }) {
  return useInfiniteQuery({
    queryKey: ["coworker", "history", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.coworker.getHistory({
        ...dateRange,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.entries.some((entry) => entry.status === "pending"),
      )
        ? 5_000
        : false,
  });
}

export function useCoworker(id: string | undefined) {
  return useQuery({
    queryKey: ["coworker", "get", id],
    queryFn: () => client.coworker.get({ id: id! }),
    enabled: !!id,
  });
}

export function useCoworkerImpersonationTarget(
  coworkerId: string | null | undefined,
  options?: {
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: ["coworker", "impersonation-target", coworkerId],
    queryFn: () => client.coworker.getImpersonationTarget({ coworkerId: coworkerId! }),
    enabled: (options?.enabled ?? true) && !!coworkerId,
    retry: false,
  });
}

export function useCreateCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name?: string;
      description?: string | null;
      username?: string | null;
      triggerType: string;
      prompt: string;
      model?: string;
      authSource?: ProviderAuthSource | null;
      promptDo?: string;
      promptDont?: string;
      autoApprove?: boolean;
      toolAccessMode?: CoworkerToolAccessMode;
      allowedIntegrations: (
        | "google_gmail"
        | "outlook"
        | "outlook_calendar"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive"
        | "notion"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics"
        | "reddit"
        | "twitter"
      )[];
      allowedExecutorSourceIds?: string[];
      allowedSkillSlugs?: string[];
    }) => client.coworker.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

export function useUpdateCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      description?: string | null;
      username?: string | null;
      status?: "on" | "off";
      triggerType?: string;
      prompt?: string;
      model?: string;
      authSource?: ProviderAuthSource | null;
      promptDo?: string | null;
      promptDont?: string | null;
      autoApprove?: boolean;
      isPinned?: boolean;
      toolAccessMode?: CoworkerToolAccessMode;
      allowedIntegrations?: (
        | "google_gmail"
        | "outlook"
        | "outlook_calendar"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "google_drive"
        | "notion"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics"
        | "reddit"
        | "twitter"
      )[];
      allowedExecutorSourceIds?: string[];
      allowedSkillSlugs?: string[];
      schedule?: CoworkerSchedule | null;
    }) => client.coworker.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useDeleteCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
    mutationFn: (id: string) => client.coworker.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useUploadCoworkerDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      coworkerId,
      filename,
      mimeType,
      content,
      description,
    }: {
      coworkerId: string;
      filename: string;
      mimeType: string;
      content: string;
      description?: string;
    }) =>
      client.coworker.uploadDocument({
        coworkerId,
        filename,
        mimeType,
        content,
        description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useDeleteCoworkerDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) => client.coworker.deleteDocument({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useTriggerCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      payload?: unknown;
      fileAttachments?: { name: string; mimeType: string; dataUrl: string }[];
      remoteIntegrationSource?: {
        targetEnv: "staging" | "prod";
        remoteUserId: string;
      };
    }) => client.coworker.trigger(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useRemoteIntegrationTargets(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["coworker", "remote-integration-targets"],
    queryFn: () => client.coworker.listRemoteIntegrationTargets(),
    enabled: options?.enabled ?? true,
  });
}

export function useSearchRemoteIntegrationUsers(
  targetEnv: "staging" | "prod" | null,
  query: string,
  options?: { enabled?: boolean; limit?: number },
) {
  return useQuery({
    queryKey: ["coworker", "remote-integration-users", targetEnv, query, options?.limit],
    queryFn: () =>
      client.coworker.searchRemoteIntegrationUsers({
        targetEnv: targetEnv!,
        query,
        limit: options?.limit,
      }),
    enabled: Boolean(targetEnv) && (options?.enabled ?? true),
  });
}

export function useShareCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.coworker.share({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useUnshareCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.coworker.unshare({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useSharedCoworkerList() {
  return useQuery({
    queryKey: ["coworker", "shared"],
    queryFn: () => client.coworker.listShared(),
  });
}

export function useImportSharedCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceCoworkerId: string) => client.coworker.importShared({ sourceCoworkerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useExportCoworkerDefinition() {
  return useMutation({
    mutationFn: (id: string) => client.coworker.exportDefinition({ id }),
  });
}

export function useImportCoworkerDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (definitionJson: string) => client.coworker.importDefinition({ definitionJson }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useCoworkerRun(
  id: string | undefined,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  return useQuery({
    queryKey: ["coworker", "run", id],
    queryFn: () => client.coworker.getRun({ id: id! }),
    enabled: (options?.enabled ?? true) && !!id,
    refetchInterval:
      options?.refetchInterval ??
      ((query) => (isActiveCoworkerRunStatus(query.state.data?.status) ? 5_000 : false)),
  });
}

export function useCoworkerRunImpersonationTarget(
  runId: string | null | undefined,
  coworkerId?: string | null,
  options?: {
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: ["coworker", "run", "impersonation-target", runId, coworkerId ?? null],
    queryFn: () =>
      client.coworker.getRunImpersonationTarget({
        runId: runId!,
        ...(coworkerId ? { coworkerId } : {}),
      }),
    enabled: (options?.enabled ?? true) && !!runId,
    retry: false,
  });
}

export function useCoworkerRuns(coworkerId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ["coworker", "runs", coworkerId, limit],
    queryFn: () => client.coworker.listRuns({ coworkerId: coworkerId!, limit }),
    enabled: !!coworkerId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((run) => isActiveCoworkerRunStatus(run.status)) ? 5_000 : false,
  });
}

export function useCoworkerForwardingAlias(coworkerId: string | undefined) {
  return useQuery({
    queryKey: ["coworker", "forwarding-alias", coworkerId],
    queryFn: () => client.coworker.getForwardingAlias({ id: coworkerId! }),
    enabled: !!coworkerId,
  });
}

export function useCreateCoworkerForwardingAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coworkerId: string) => client.coworker.createForwardingAlias({ id: coworkerId }),
    onSuccess: (_, coworkerId) => {
      queryClient.invalidateQueries({
        queryKey: ["coworker", "forwarding-alias", coworkerId],
      });
    },
  });
}

export function useDisableCoworkerForwardingAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coworkerId: string) => client.coworker.disableForwardingAlias({ id: coworkerId }),
    onSuccess: (_, coworkerId) => {
      queryClient.invalidateQueries({
        queryKey: ["coworker", "forwarding-alias", coworkerId],
      });
    },
  });
}

export function useRotateCoworkerForwardingAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coworkerId: string) => client.coworker.rotateForwardingAlias({ id: coworkerId }),
    onSuccess: (_, coworkerId) => {
      queryClient.invalidateQueries({
        queryKey: ["coworker", "forwarding-alias", coworkerId],
      });
    },
  });
}

export function useGetOrCreateBuilderConversation() {
  return useMutation({
    mutationFn: (id: string) => client.coworker.getOrCreateBuilderConversation({ id }),
  });
}

// ========== COWORKER TAG HOOKS ==========

export function useCoworkerTagList() {
  return useQuery({
    queryKey: ["coworkerTag", "list"],
    queryFn: () => client.coworkerTag.list(),
  });
}

export function useCreateCoworkerTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: string | null }) =>
      client.coworkerTag.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerTag"] });
    },
  });
}

export function useAssignCoworkerTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { coworkerId: string; tagIds: string[] }) =>
      client.coworkerTag.assign(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerTag"] });
      queryClient.invalidateQueries({ queryKey: ["coworker", "list"] });
    },
  });
}

export function useUnassignCoworkerTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { coworkerId: string; tagIds: string[] }) =>
      client.coworkerTag.unassign(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerTag"] });
      queryClient.invalidateQueries({ queryKey: ["coworker", "list"] });
    },
  });
}

// ========== COWORKER VIEW HOOKS ==========

export function useCoworkerViewList() {
  return useQuery({
    queryKey: ["coworkerView", "list"],
    queryFn: () => client.coworkerView.list(),
  });
}

export function useCreateCoworkerView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      filters: { tagIds?: string[]; statuses?: string[]; triggerTypes?: string[] };
    }) => client.coworkerView.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerView"] });
    },
  });
}

export function useUpdateCoworkerView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      filters?: { tagIds?: string[]; statuses?: string[]; triggerTypes?: string[] };
      position?: number;
    }) => client.coworkerView.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerView"] });
    },
  });
}

export function useDeleteCoworkerView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.coworkerView.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerView"] });
    },
  });
}

// Hook for deleting a file
export function useDeleteSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteFile({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== SKILL DOCUMENT HOOKS ==========

// Hook for uploading a document
export function useUploadSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      skillId,
      filename,
      mimeType,
      content,
      description,
    }: {
      skillId: string;
      filename: string;
      mimeType: string;
      content: string; // base64
      description?: string;
    }) =>
      client.skill.uploadDocument({
        skillId,
        filename,
        mimeType,
        content,
        description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for getting document download URL
export function useGetDocumentUrl() {
  return useMutation({
    mutationFn: (id: string) => client.skill.getDocumentUrl({ id }),
  });
}

// Hook for deleting a document
export function useDeleteSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteDocument({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== USER HOOKS ==========

// Hook for getting current user
export function useCurrentUser(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: () => client.user.me(),
    enabled: options?.enabled ?? true,
  });
}

type CurrentUser = Awaited<ReturnType<typeof client.user.me>>;

// Hook for completing onboarding
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.completeOnboarding(),
    onSuccess: async () => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (currentUser) =>
        currentUser ? { ...currentUser, onboardedAt: new Date() } : currentUser,
      );
      await queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useResetOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.resetOnboarding(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
}

export function useSetUserTimezone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (timezone: string) => client.user.setTimezone({ timezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useSetTaskDonePushEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) => client.user.setTaskDonePushEnabled({ enabled }),
    onSuccess: async (_result, enabled) => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (currentUser) =>
        currentUser ? { ...currentUser, taskDonePushEnabled: enabled } : currentUser,
      );
      await queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

// ========== BILLING HOOKS ==========

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => client.billing.overview(),
    enabled,
  });
}

export function useAdminBillingUserOverview(targetUserId: string | null) {
  return useQuery({
    queryKey: ["billing", "admin-user-overview", targetUserId],
    queryFn: () => client.billing.adminUserOverview({ targetUserId: targetUserId! }),
    enabled: Boolean(targetUserId),
  });
}

export function useSwitchWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string | null) => client.billing.switchWorkspace({ workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useAttachBillingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      planId: "free" | "pro" | "business" | "enterprise";
      successUrl?: string;
    }) => client.billing.attachPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      returnUrl?: string;
    }) => client.billing.openPortal(input),
  });
}

export function useCancelBillingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      productId: "pro" | "business" | "enterprise";
    }) => client.billing.cancelPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useManualBillingTopUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      ownerType: "user" | "workspace";
      workspaceId?: string;
      usdAmount: number;
    }) => client.billing.manualTopUp(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useAdminWorkspaces() {
  return useQuery({
    queryKey: ["billing", "admin-workspaces"],
    queryFn: () => client.billing.adminWorkspaces(),
  });
}

export function useAdminTemplateCatalogList() {
  return useQuery({
    queryKey: ["template", "admin-list"],
    queryFn: () => client.template.list(),
  });
}

export function useAdminExportTemplateCatalog() {
  return useMutation({
    mutationFn: () => client.template.exportCatalog({}),
  });
}

export function useAdminImportTemplateCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ definitionJson }: { definitionJson: string }) =>
      client.template.importCatalog({ definitionJson }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useAdminDeleteTemplateCatalogEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) => client.template.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useAdminSetTemplateCatalogFeatured() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      client.template.setFeatured({ id, featured }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template", "admin-list"] });
    },
  });
}

export function useAdminJoinWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string }) => client.billing.adminJoinWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useAdminAddWorkspaceMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; emails: string[] }) =>
      client.billing.adminAddWorkspaceMembers(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminRemoveWorkspaceMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; email: string }) =>
      client.billing.adminRemoveWorkspaceMember(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; ownerEmail: string }) =>
      client.billing.adminCreateWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminRenameWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; name: string }) =>
      client.billing.adminRenameWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-workspaces"],
      });
    },
  });
}

export function useAdminManualBillingTopUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { targetUserId: string; usdAmount: number }) =>
      client.billing.adminManualTopUp(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "admin-user-overview"],
      });
    },
  });
}

export function useInviteWorkspaceMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; emails: string[]; role?: "admin" | "member" }) =>
      client.billing.inviteMembers(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "members"] });
    },
  });
}

export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["billing", "members", workspaceId],
    queryFn: () => client.billing.members({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
}

export function useRenameWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workspaceId: string; name: string }) => client.billing.rename(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "members"] });
    },
  });
}

// ========== PROVIDER AUTH HOOKS ==========

type SubscriptionProvider = "openai" | "google" | "kimi";
type OAuthSubscriptionProvider = "openai" | "google";

// Hook for getting connected subscription providers status
export function useProviderAuthStatus() {
  return useQuery({
    queryKey: ["providerAuth", "status"],
    queryFn: () => client.providerAuth.status(),
  });
}

export function useAdminSharedProviderAuthStatus() {
  return useQuery({
    queryKey: ["adminSharedProviderAuth", "status"],
    queryFn: () => client.adminSharedProviderAuth.status(),
  });
}

// Hook for fetching free models available on OpenCode Zen
export function useOpencodeFreeModels() {
  return useQuery({
    queryKey: ["providerAuth", "freeModels"],
    queryFn: () => client.providerAuth.freeModels(),
    staleTime: 5 * 60 * 1000,
  });
}

// Hook for initiating subscription provider OAuth connection
export function useConnectProvider() {
  return useMutation({
    mutationFn: (provider: OAuthSubscriptionProvider) => client.providerAuth.connect({ provider }),
  });
}

export function usePollProviderConnection() {
  return useMutation({
    mutationFn: ({ provider, flowId }: { provider: "openai"; flowId: string }) =>
      client.providerAuth.poll({ provider, flowId }),
  });
}

export function useConnectAdminSharedProvider() {
  return useMutation({
    mutationFn: (provider: "openai") => client.adminSharedProviderAuth.connect({ provider }),
  });
}

export function usePollAdminSharedProviderConnection() {
  return useMutation({
    mutationFn: ({ provider, flowId }: { provider: "openai"; flowId: string }) =>
      client.adminSharedProviderAuth.poll({ provider, flowId }),
  });
}

// Hook for disconnecting a subscription provider
export function useDisconnectProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: SubscriptionProvider) => client.providerAuth.disconnect({ provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

export function useDisconnectAdminSharedProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: "openai" | "google") =>
      client.adminSharedProviderAuth.disconnect({ provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSharedProviderAuth"] });
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

export function useSetAdminSharedProviderApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: "google"; apiKey: string }) =>
      client.adminSharedProviderAuth.setApiKey({ provider, apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSharedProviderAuth"] });
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
} // ========== GENERATION HOOKS ==========

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

export function usePlatformSkillList() {
  return useQuery({
    queryKey: ["generation", "platformSkills"],
    queryFn: () => client.generation.listPlatformSkills(),
    staleTime: 5 * 60 * 1000,
  });
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
} // Hook for downloading an attachment (returns presigned URL)
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

export function useChatOverview() {
  return useQuery({
    queryKey: ["admin", "chatOverview"],
    queryFn: () => client.admin.getChatOverview(),
    refetchInterval: 60_000,
  });
}

export function useAdminUsageDashboard(workspaceId: string | null) {
  return useQuery({
    queryKey: ["admin", "usageDashboard", workspaceId],
    queryFn: () =>
      client.admin.getUsageDashboard(workspaceId === "all" ? {} : { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
    refetchInterval: 120_000,
  });
}

export function useAdminCoworkerOverview(workspaceId: string | null) {
  return useQuery({
    queryKey: ["admin", "coworkerOverview", workspaceId],
    queryFn: () =>
      client.admin.getCoworkerOverview(workspaceId === "all" ? {} : { workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
  });
}

export function usePerformanceDashboard(days: "1" | "7" | "30" = "7") {
  return useQuery({
    queryKey: ["admin", "performanceDashboard", days],
    queryFn: () => client.admin.getPerformanceDashboard({ days }),
    refetchInterval: 120_000,
  });
}

export function useAdminOpsScheduledCoworkers() {
  return useQuery({
    queryKey: ["admin", "ops", "scheduledCoworkers"],
    queryFn: () => client.admin.getOpsScheduledCoworkers(),
    refetchInterval: 15_000,
  });
}

export function useEnqueueAdminScheduledCoworkersNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[] }) => client.admin.enqueueScheduledCoworkersNow(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "ops", "scheduledCoworkers"],
      });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useSetUserAdminRole() {
  return useMutation({
    mutationFn: (input: { userId: string; isAdmin: boolean }) =>
      client.admin.setUserAdminRole(input),
  });
}

export function useGrantAdminAccessByEmail() {
  return useMutation({
    mutationFn: (input: { email: string }) => client.admin.grantAdminAccessByEmail(input),
  });
}

// ---------------------------------------------------------------------------
// Org Chart
// ---------------------------------------------------------------------------

export function useOrgChartNodes() {
  return useQuery({
    queryKey: ["orgChart", "list"],
    queryFn: () => client.orgChart.list(),
  });
}

export function useCreateOrgChartNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      type: "coworker" | "label";
      coworkerId?: string;
      label?: string;
      positionX: number;
      positionY: number;
    }) => client.orgChart.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

export function useUpdateOrgChartNodePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; positionX: number; positionY: number }) =>
      client.orgChart.updatePosition(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["orgChart", "list"] });
      const previous = queryClient.getQueryData<
        Array<{ id: string; positionX: number; positionY: number }>
      >(["orgChart", "list"]);
      if (previous) {
        queryClient.setQueryData(
          ["orgChart", "list"],
          previous.map((n) =>
            n.id === input.id
              ? { ...n, positionX: input.positionX, positionY: input.positionY }
              : n,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["orgChart", "list"], ctx.previous);
      }
    },
  });
}

export function useUpdateOrgChartLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) => client.orgChart.updateLabel(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

export function useDeleteOrgChartNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => client.orgChart.delete(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgChart"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin sandbox hooks
// ---------------------------------------------------------------------------

export function useAdminListSandboxes() {
  return useQuery({
    queryKey: ["admin", "sandboxes"],
    queryFn: () => client.admin.listSandboxes(),
    refetchInterval: 15_000,
  });
}

export function useAdminKillSandbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sandboxId: string; provider: "e2b" | "daytona" }) =>
      client.admin.killSandbox(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "sandboxes"] });
    },
  });
}

export function useAdminSandboxUsageHistory(input: {
  range: "24h" | "7d" | "30d";
  bucket: "hour" | "day";
}) {
  return useQuery({
    queryKey: ["admin", "sandboxes", "usage", input.range, input.bucket],
    queryFn: () => client.admin.getSandboxUsageHistory(input),
    refetchInterval: 60_000,
  });
}
