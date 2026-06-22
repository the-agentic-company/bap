import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { useQuery as useZeroQuery } from "@rocicorp/zero/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  mapZeroCoworkerFolders,
  mapZeroCoworkerList,
  mapZeroCoworkerRun,
} from "@/zero/coworker-data";
import { useBapZeroRuntime } from "@/zero/provider";
import { zeroQueries } from "@/zero/queries";
import { client } from "../client";

type CoworkerToolAccessMode = "all" | "selected";

// ========== COWORKER HOOKS ==========

const ACTIVE_COWORKER_RUN_STATUSES = new Set([
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "cancelling",
]);

export type CoworkerListData = ReturnType<typeof mapZeroCoworkerList>;
export type CoworkerFolderListData = ReturnType<typeof mapZeroCoworkerFolders>;
const coworkerListCache = new Map<string, CoworkerListData>();
const coworkerFolderListCache = new Map<string, CoworkerFolderListData>();

function getZeroRuntimeCacheKey(runtime: { userId: string | null; workspaceId: string }) {
  return runtime.userId && runtime.workspaceId ? `${runtime.userId}:${runtime.workspaceId}` : null;
}

function isActiveCoworkerRunStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && ACTIVE_COWORKER_RUN_STATUSES.has(status);
}

export function useCoworkerList(options?: { initialData?: CoworkerListData }) {
  const zeroRuntime = useBapZeroRuntime();
  const [coworkers, details] = useZeroQuery(
    zeroRuntime.isReady ? zeroQueries.coworkerInventory.coworkers() : null,
  );
  const cacheKey = getZeroRuntimeCacheKey(zeroRuntime);
  const initialData = options?.initialData;
  const mappedData = useMemo(() => mapZeroCoworkerList(coworkers ?? []), [coworkers]);
  useEffect(() => {
    if (cacheKey && initialData && initialData.length > 0 && !coworkerListCache.has(cacheKey)) {
      coworkerListCache.set(cacheKey, initialData);
    }
  }, [cacheKey, initialData]);
  useEffect(() => {
    if (cacheKey && (mappedData.length > 0 || details.type === "complete")) {
      coworkerListCache.set(cacheKey, mappedData);
    }
  }, [cacheKey, details.type, mappedData]);
  const cachedData = cacheKey ? coworkerListCache.get(cacheKey) : undefined;
  const data =
    mappedData.length > 0 || details.type === "complete"
      ? mappedData
      : (cachedData ?? initialData ?? mappedData);
  const error = zeroRuntime.error ?? (details.type === "error" ? details.error : null);
  const isWaitingForZero =
    Boolean(zeroRuntime.userId && zeroRuntime.workspaceId) && !zeroRuntime.isReady;
  const isLoading =
    !error &&
    data.length === 0 &&
    !cachedData &&
    !(initialData && initialData.length > 0) &&
    (zeroRuntime.isResolvingWorkspace ||
      isWaitingForZero ||
      (zeroRuntime.isReady && details.type !== "complete"));

  return {
    data,
    dataUpdatedAt: Date.now(),
    error,
    isError: Boolean(error),
    isFetching:
      !error &&
      (zeroRuntime.isResolvingWorkspace ||
        isWaitingForZero ||
        (zeroRuntime.isReady && details.type !== "complete")),
    isLoading,
    isPending: isLoading,
    refetch: async () => ({ data }),
    status: error ? "error" : isLoading ? "pending" : "success",
  };
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

type RunHistoryPage = Awaited<ReturnType<typeof client.coworker.getHistory>>;
export type RunHistoryEntry = RunHistoryPage["entries"][number];

export function useRunHistory(dateRange?: { from?: Date; to?: Date }) {
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
        | "linear"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics"
      )[];
      allowedWorkspaceMcpServerIds?: string[];
      allowedSkillSlugs?: string[];
      folderId?: string | null;
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
        | "linear"
        | "github"
        | "airtable"
        | "slack"
        | "hubspot"
        | "linkedin"
        | "salesforce"
        | "dynamics"
      )[];
      allowedWorkspaceMcpServerIds?: string[];
      allowedSkillSlugs?: string[];
      schedule?: CoworkerSchedule | null;
      requiresUserInput?: boolean;
      userInputPrompt?: string | null;
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

export function useMoveCoworkerWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { coworkerId: string; targetWorkspaceId: string }) =>
      client.coworker.moveWorkspace(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
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

export function useGetCoworkerDocumentUrl() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => client.coworker.getDocumentUrl({ id }),
  });
}

export function useTriggerCoworker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      payload?: unknown;
      trustedUserInput?: string;
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

export function useResetCoworkerRunsAndEnable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coworkerId: string) => client.coworker.resetRunsAndEnable({ coworkerId }),
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

export function useCoworkerRuns(
  coworkerId: string | undefined,
  limit = 20,
  options?: {
    enabled?: boolean;
  },
) {
  const zeroRuntime = useBapZeroRuntime();
  const enabled = (options?.enabled ?? true) && !!coworkerId;
  const [runs, details] = useZeroQuery(
    zeroRuntime.isReady && enabled && coworkerId
      ? zeroQueries.coworkerInventory.runsByCoworker({ coworkerId, limit })
      : null,
  );
  const data = useMemo(() => (runs ?? []).map(mapZeroCoworkerRun), [runs]);
  const error = zeroRuntime.error ?? (details.type === "error" ? details.error : null);
  const isLoading =
    enabled &&
    !error &&
    data.length === 0 &&
    (zeroRuntime.isResolvingWorkspace || (zeroRuntime.isReady && details.type !== "complete"));

  return {
    data,
    dataUpdatedAt: Date.now(),
    error,
    isError: Boolean(error),
    isFetching:
      enabled &&
      !error &&
      (zeroRuntime.isResolvingWorkspace || (zeroRuntime.isReady && details.type !== "complete")),
    isLoading,
    isPending: isLoading,
    refetch: async () => ({ data }),
    status: error ? "error" : isLoading ? "pending" : "success",
  };
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

export function useGetOrCreateBuilderChat() {
  return useMutation({
    mutationFn: (id: string) => client.coworker.getOrCreateBuilderConversation({ id }),
  });
}

// ========== COWORKER FOLDER HOOKS ==========

export function useCoworkerFolderList(options?: { initialData?: CoworkerFolderListData }) {
  const zeroRuntime = useBapZeroRuntime();
  const [folders, details] = useZeroQuery(
    zeroRuntime.isReady ? zeroQueries.coworkerInventory.folders() : null,
  );
  const cacheKey = getZeroRuntimeCacheKey(zeroRuntime);
  const initialData = options?.initialData;
  const data = useMemo(() => mapZeroCoworkerFolders(folders ?? []), [folders]);
  useEffect(() => {
    if (
      cacheKey &&
      initialData &&
      initialData.length > 0 &&
      !coworkerFolderListCache.has(cacheKey)
    ) {
      coworkerFolderListCache.set(cacheKey, initialData);
    }
  }, [cacheKey, initialData]);
  useEffect(() => {
    if (cacheKey && (data.length > 0 || details.type === "complete")) {
      coworkerFolderListCache.set(cacheKey, data);
    }
  }, [cacheKey, details.type, data]);
  const cachedData = cacheKey ? coworkerFolderListCache.get(cacheKey) : undefined;
  const folderData =
    data.length > 0 || details.type === "complete" ? data : (cachedData ?? initialData ?? data);
  const error = zeroRuntime.error ?? (details.type === "error" ? details.error : null);
  const isWaitingForZero =
    Boolean(zeroRuntime.userId && zeroRuntime.workspaceId) && !zeroRuntime.isReady;
  const isLoading =
    !error &&
    folderData.length === 0 &&
    !cachedData &&
    !(initialData && initialData.length > 0) &&
    (zeroRuntime.isResolvingWorkspace ||
      isWaitingForZero ||
      (zeroRuntime.isReady && details.type !== "complete"));

  return {
    data: folderData,
    dataUpdatedAt: Date.now(),
    error,
    isError: Boolean(error),
    isFetching:
      !error &&
      (zeroRuntime.isResolvingWorkspace ||
        isWaitingForZero ||
        (zeroRuntime.isReady && details.type !== "complete")),
    isLoading,
    isPending: isLoading,
    refetch: async () => ({ data: folderData }),
    status: error ? "error" : isLoading ? "pending" : "success",
  };
}

export function useCreateCoworkerFolderPath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      path: string;
      parentId?: string | null;
      visibility?: "private" | "workspace";
    }) => client.coworkerFolder.createPath(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useCreateCoworkerFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      parentId?: string | null;
      visibility?: "private" | "workspace";
    }) => client.coworkerFolder.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useMoveCoworkerFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { folderId: string; parentId: string | null }) =>
      client.coworkerFolder.moveFolder(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useUpdateCoworkerFolderVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; visibility: "private" | "workspace" }) =>
      client.coworkerFolder.updateVisibility(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useDeleteCoworkerFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.coworkerFolder.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}

export function useMoveCoworkerToFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { coworkerId: string; folderId: string | null }) =>
      client.coworkerFolder.moveCoworker(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
    },
  });
}
