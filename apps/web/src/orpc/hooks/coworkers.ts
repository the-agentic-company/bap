import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../client";

type CoworkerToolAccessMode = "all" | "selected";

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
        | "linear"
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
      allowedWorkspaceMcpServerIds?: string[];
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
        | "linear"
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
  return useQuery({
    queryKey: ["coworker", "runs", coworkerId, limit],
    queryFn: () => client.coworker.listRuns({ coworkerId: coworkerId!, limit }),
    enabled: (options?.enabled ?? true) && !!coworkerId,
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

export function useCoworkerFolderList() {
  return useQuery({
    queryKey: ["coworkerFolder", "list"],
    queryFn: () => client.coworkerFolder.list(),
  });
}

export function useCreateCoworkerFolderPath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; parentId?: string | null }) =>
      client.coworkerFolder.createPath(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coworkerFolder"] });
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
      queryClient.invalidateQueries({ queryKey: ["coworker", "list"] });
    },
  });
}

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
