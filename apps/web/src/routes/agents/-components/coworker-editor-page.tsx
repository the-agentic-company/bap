// oxlint-disable jsx-a11y/control-has-associated-label

import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { CUSTOM_SKILL_PREFIX } from "@bap/core/lib/coworker-tool-policy";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@bap/core/lib/email-forwarding";
import {
  useNavigate,
  useParams as useTanStackParams,
  useRouterState,
} from "@tanstack/react-router";
import { T, msg, useGT } from "gt-react";
import { Loader2 } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import { toast } from "sonner";
import { useChatSkillStore } from "@/components/chat/chat-skill-store";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCoworkerRouteSlug } from "@/lib/coworker-routes";
import { normalizeGenerationError } from "@/lib/generation-errors";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  isComingSoonIntegration,
  type IntegrationType,
} from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import {
  useCreateCoworkerForwardingAlias,
  useDisableCoworkerForwardingAlias,
  useRotateCoworkerForwardingAlias,
  useCoworker,
  useCoworkerList,
  useCoworkerImpersonationTarget,
  useCoworkerRunImpersonationTarget,
  useCoworkerForwardingAlias,
  useUpdateCoworker,
  useDeleteCoworker,
  useCoworkerRuns,
  useTriggerCoworker,
  useResetCoworkerRunsAndEnable,
  useRemoteIntegrationTargets,
  useSearchRemoteIntegrationUsers,
} from "@/orpc/hooks/coworkers";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { usePlatformSkillList, useSkillList } from "@/orpc/hooks/skills";
import { useWorkspaceMcpServerList } from "@/orpc/hooks/workspace-mcp-servers";
import { CoworkerChatPanel } from "./coworker-editor/coworker-chat-panel";
import {
  CoworkerEditorDesktopLayout,
  CoworkerEditorMobileLayout,
  DisableAutoApproveDialog,
} from "./coworker-editor/coworker-editor-layout";
import { isUuidRouteSlug } from "./coworker-editor/coworker-editor-utils";
import { CoworkerSettingsPanel } from "./coworker-editor/coworker-settings-panel";
import { RemoteIntegrationAdminPanel } from "./coworker-editor/remote-integration-admin-panel";
import {
  EMPTY_COWORKER_DOCUMENTS,
  type CoworkerTab,
  type RemoteIntegrationTargetEnv,
  type RemoteIntegrationUserOption,
} from "./coworker-editor/types";
import { useCoworkerBuilderChat } from "./coworker-editor/use-coworker-builder-chat";
import { useCoworkerDefinitionEditor } from "./coworker-editor/use-coworker-definition-editor";
import { useCoworkerDocuments } from "./coworker-editor/use-coworker-documents";
import { useCoworkerEditorNavigation } from "./coworker-editor/use-coworker-editor-navigation";

const BASE_TRIGGERS = [
  { value: "manual", label: msg("Manual only") },
  { value: "schedule", label: msg("Run on a schedule") },
  { value: EMAIL_FORWARDED_TRIGGER_TYPE, label: msg("Email forwarded to Bap") },
];

const LEGACY_HIDDEN_TRIGGERS = [{ value: "gmail.new_email", label: msg("New Gmail email") }];
const COWORKER_RUN_BACKLOG_LIMIT = 5;
const COWORKER_RUN_BACKLOG_STATUSES = new Set([
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

type CoworkerEditorPageProps = {
  coworkerIdOverride?: string;
  embedded?: boolean;
};

export default function CoworkerEditorPage({
  coworkerIdOverride,
  embedded = false,
}: CoworkerEditorPageProps = {}) {
  const t = useGT();

  const params = useTanStackParams({ strict: false, shouldThrow: false }) as { id?: string };
  const routeCoworkerSlug = params?.id;
  const coworkerList = useCoworkerList();
  const coworkerListItem = useMemo(
    () =>
      coworkerIdOverride
        ? null
        : (coworkerList.data?.find(
            (item) => item.username === routeCoworkerSlug || item.id === routeCoworkerSlug,
          ) ?? null),
    [coworkerIdOverride, coworkerList.data, routeCoworkerSlug],
  );
  const routeCoworkerId = isUuidRouteSlug(routeCoworkerSlug) ? routeCoworkerSlug : undefined;
  const coworkerId = coworkerIdOverride ?? coworkerListItem?.id ?? routeCoworkerId;
  const coworkerRouteSlug = coworkerIdOverride
    ? coworkerIdOverride
    : coworkerListItem
      ? getCoworkerRouteSlug(coworkerListItem)
      : routeCoworkerSlug;
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const { data: coworker, isLoading, refetch: refetchCoworker } = useCoworker(coworkerId);
  const [hasResolvedInitialCoworker, setHasResolvedInitialCoworker] = useState(false);
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } = usePlatformSkillList();
  const { data: accessibleSkills, isLoading: isAccessibleSkillsLoading } = useSkillList();
  const { data: executorSourceData } = useWorkspaceMcpServerList();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: remoteIntegrationTargetsData } = useRemoteIntegrationTargets({
    enabled: isAdmin,
  });
  const { data: coworkerForwardingAlias } = useCoworkerForwardingAlias(coworkerId);
  const { data: runs, refetch: refetchRuns } = useCoworkerRuns(coworkerId);
  const updateCoworker = useUpdateCoworker();
  const createForwardingAlias = useCreateCoworkerForwardingAlias();
  const disableForwardingAlias = useDisableCoworkerForwardingAlias();
  const rotateForwardingAlias = useRotateCoworkerForwardingAlias();
  const triggerCoworker = useTriggerCoworker();
  const resetCoworkerRuns = useResetCoworkerRunsAndEnable();
  const deleteCoworker = useDeleteCoworker();

  const integrationEntries = useMemo(
    () =>
      COWORKER_AVAILABLE_INTEGRATION_TYPES.map((key) => ({
        key,
        name: INTEGRATION_DISPLAY_NAMES[key],
        logo: INTEGRATION_LOGOS[key],
      })),
    [],
  );
  const allIntegrationTypes = useMemo(
    () => integrationEntries.map((entry) => entry.key),
    [integrationEntries],
  );
  const coworkerDefinitionEditor = useCoworkerDefinitionEditor({
    coworkerId,
    coworker,
    allIntegrationTypes,
    updateCoworker,
    refetchCoworker,
  });
  const {
    draft: {
      name,
      description,
      username,
      triggerType,
      prompt,
      model,
      modelAuthSource,
      toolAccessMode,
      allowedIntegrations,
      allowedWorkspaceMcpServerIds,
      allowedSkillSlugs,
      status,
      autoApprove,
      requiresUserInput,
      userInputPrompt,
      scheduleType,
      intervalMinutes,
      scheduleTime,
      scheduleDaysOfWeek,
      scheduleDayOfMonth,
      scheduleTimezone,
    },
    actions: {
      setName,
      setDescription,
      setUsername,
      setTriggerType,
      setPrompt,
      setModelSelection,
      setToolAccessMode,
      toggleIntegration,
      selectAllIntegrations,
      clearIntegrations,
      toggleSkill,
      clearSkills,
      toggleWorkspaceMcpServer,
      clearWorkspaceMcpServers,
      setStatusFromChecked,
      setAutoApprove,
      setRequiresUserInput,
      setUserInputPrompt,
      setScheduleType,
      setIntervalHours,
      setScheduleTime,
      toggleWeekDay,
      setScheduleDayOfMonth,
    },
    isSaving,
    persistCoworker,
    handleCoworkerSyncFromChat,
  } = coworkerDefinitionEditor;
  const [showDisableAutoApproveDialog, setShowDisableAutoApproveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [copiedForwardingField, setCopiedForwardingField] = useState<
    "coworkerAlias" | "invokeHandle" | null
  >(null);
  const [activeTab, setActiveTab] = useState<CoworkerTab>("instruction");
  const [remoteTargetEnv, setRemoteTargetEnv] = useState<RemoteIntegrationTargetEnv | null>(null);
  const [remoteUserQuery, setRemoteUserQuery] = useState("");
  const [selectedRemoteUser, setSelectedRemoteUser] = useState<RemoteIntegrationUserOption | null>(
    null,
  );
  const isMobile = useIsMobile();
  const builderChat = useCoworkerBuilderChat({
    coworkerId,
    loadedCoworkerId: coworker?.id,
    isMobile,
  });
  const {
    conversationId: builderChatId,
    isLoading: isBuilderChatLoading,
    errorMessage: builderChatError,
    retry: handleRetryBuilderChat,
  } = builderChat;
  const {
    isUploadingDocuments,
    deletingDocumentIds,
    downloadingDocumentIds,
    uploadDocuments: handleUploadDocuments,
    deleteDocument: handleDeleteDocument,
    downloadDocument: handleDownloadDocument,
  } = useCoworkerDocuments({
    coworkerId,
    builderChat,
  });
  const deferredRemoteUserQuery = useDeferredValue(remoteUserQuery);
  const availableRemoteIntegrationTargets = useMemo(
    () => remoteIntegrationTargetsData?.targets ?? [],
    [remoteIntegrationTargetsData],
  );
  const remoteUserSearchEnabled = isAdmin && activeTab === "admin" && Boolean(remoteTargetEnv);
  const { data: remoteUserSearchData, isFetching: isRemoteUserSearchFetching } =
    useSearchRemoteIntegrationUsers(remoteTargetEnv, deferredRemoteUserQuery, {
      enabled: remoteUserSearchEnabled,
      limit: 12,
    });
  const requiresResetBeforeEnable = useMemo(() => {
    const backlogRunCount =
      runs?.filter((run) => COWORKER_RUN_BACKLOG_STATUSES.has(run.status)).length ?? 0;
    return (
      coworker?.disabledReason === "run_backlog_limit" ||
      backlogRunCount >= COWORKER_RUN_BACKLOG_LIMIT
    );
  }, [coworker?.disabledReason, runs]);
  const baseTabParam = searchParams.get("tab");
  const routeBaseTab: CoworkerTab | null =
    baseTabParam === "chat" ||
    baseTabParam === "instruction" ||
    baseTabParam === "runs" ||
    baseTabParam === "docs" ||
    baseTabParam === "toolbox" ||
    baseTabParam === "admin"
      ? baseTabParam
      : null;
  const routeSearchRunId = routeBaseTab === "runs" ? searchParams.get("run") : null;
  const routeRunId = useMemo(() => {
    if (routeSearchRunId) {
      return routeSearchRunId;
    }

    if (embedded || !coworkerId || !pathname) {
      return null;
    }

    const prefix = `/agents/edit/${routeCoworkerSlug}/runs/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }

    const runId = pathname.slice(prefix.length);
    return runId.length > 0 ? runId : null;
  }, [coworkerId, embedded, pathname, routeCoworkerSlug, routeSearchRunId]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(routeRunId);
  const isRunsRoute =
    routeBaseTab === "runs" ||
    (!embedded && (pathname?.startsWith(`/agents/edit/${routeCoworkerSlug}/runs`) ?? false));
  const currentRoutePath = useMemo(() => {
    if (embedded && coworkerId) {
      return `/agents?agent=${encodeURIComponent(coworkerId)}`;
    }
    const query = searchParams.toString();
    return query && pathname
      ? `${pathname}?${query}`
      : (pathname ?? `/agents/edit/${coworkerRouteSlug}`);
  }, [coworkerId, coworkerRouteSlug, embedded, pathname, searchParams]);
  const shouldLoadCoworkerImpersonationTarget = Boolean(
    coworkerId && !routeRunId && !isLoading && !coworker,
  );
  const shouldLoadRunImpersonationTarget = Boolean(routeRunId && !isLoading && !coworker);
  const { data: coworkerImpersonationTarget, isLoading: isCoworkerImpersonationTargetLoading } =
    useCoworkerImpersonationTarget(coworkerId, {
      enabled: shouldLoadCoworkerImpersonationTarget,
    });
  const { data: runImpersonationTarget, isLoading: isRunImpersonationTargetLoading } =
    useCoworkerRunImpersonationTarget(routeRunId, coworkerId, {
      enabled: shouldLoadRunImpersonationTarget,
    });
  const hasSetMobileDefaultRef = useRef(false);
  const remoteUserOptions = useMemo(
    () => (remoteUserSearchData?.users as RemoteIntegrationUserOption[] | undefined) ?? [],
    [remoteUserSearchData],
  );

  useEffect(() => {
    if (!coworker) {
      setHasResolvedInitialCoworker(false);
      return;
    }

    const timeout = window.setTimeout(() => setHasResolvedInitialCoworker(true), 120);
    return () => window.clearTimeout(timeout);
  }, [coworker]);

  useEffect(() => {
    if (!isAdmin && activeTab === "admin") {
      setActiveTab("instruction");
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setRemoteTargetEnv(null);
      setSelectedRemoteUser(null);
      setRemoteUserQuery("");
      return;
    }

    if (remoteTargetEnv && availableRemoteIntegrationTargets.includes(remoteTargetEnv)) {
      return;
    }

    setRemoteTargetEnv(
      availableRemoteIntegrationTargets.length > 0 ? availableRemoteIntegrationTargets[0] : null,
    );
  }, [availableRemoteIntegrationTargets, isAdmin, remoteTargetEnv]);

  useEffect(() => {
    setSelectedRemoteUser(null);
  }, [remoteTargetEnv]);
  useEffect(() => {
    if (!isMobile || hasSetMobileDefaultRef.current) {
      return;
    }
    hasSetMobileDefaultRef.current = true;
    if (!isRunsRoute) {
      setActiveTab("chat");
    }
  }, [isMobile, isRunsRoute]);

  useEffect(() => {
    if (!isRunsRoute) {
      setSelectedRunId(null);
      if (routeBaseTab) {
        setActiveTab(routeBaseTab);
      }
      return;
    }

    setActiveTab("runs");
    setSelectedRunId(routeRunId);
  }, [isRunsRoute, routeBaseTab, routeRunId]);
  const [isInstructionPanelCollapsed, setIsInstructionPanelCollapsed] = useState(true);
  const previousHasAgentInstructionsRef = useRef(false);
  const handleClose = useCallback(() => {
    setIsInstructionPanelCollapsed(true);
  }, []);
  const handleDelete = useCallback(() => {
    if (!coworkerId) {
      return;
    }
    deleteCoworker.mutate(coworkerId, {
      onSuccess: () => {
        toast.success(t("Coworker deleted"));
        void navigate({ to: embedded ? "/agents" : "/agents" });
      },
      onError: () => {
        toast.error(t("Failed to delete coworker"));
      },
    });
  }, [coworkerId, deleteCoworker, embedded, navigate, t]);
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );
  const coworkerForwardingAddress = coworkerForwardingAlias?.forwardingAddress ?? null;
  const hasActiveForwardingAlias = Boolean(coworkerForwardingAlias?.activeAlias);
  const isEmailTriggerPersisted = coworker?.triggerType === EMAIL_FORWARDED_TRIGGER_TYPE;
  const persistedLegacyTriggers = useMemo(
    () => LEGACY_HIDDEN_TRIGGERS.filter(({ value }) => value === coworker?.triggerType),
    [coworker?.triggerType],
  );
  const triggers = useMemo(
    () => [
      ...BASE_TRIGGERS,
      ...persistedLegacyTriggers,
      ...(isAdmin || !isComingSoonIntegration("twitter")
        ? ([{ value: "twitter.new_dm", label: msg("New X (Twitter) DM") }] as const)
        : []),
    ],
    [isAdmin, persistedLegacyTriggers],
  );
  const skillSelectionScopeKey = useMemo(
    () => (coworkerId ? `coworker-builder:${coworkerId}` : "coworker-builder"),
    [coworkerId],
  );
  const setSelectedSkillSlugs = useChatSkillStore((state) => state.setSelectedSkillSlugs);
  const selectedSkillKeys = allowedSkillSlugs;
  const availableSkills = useMemo(
    () => [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        source: "Platform" as const,
      })),
      ...((accessibleSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          source: skill.isOwnedByCurrentUser
            ? skill.visibility === "public"
              ? ("Custom Public" as const)
              : ("Custom Private" as const)
            : ("Shared" as const),
        })) ?? []),
    ],
    [accessibleSkills, platformSkills],
  );
  const executorSourceEntries = useMemo(
    () =>
      (executorSourceData?.sources ?? [])
        .filter((source) => source.enabled)
        .map((source) => ({
          id: source.id,
          title: source.name,
          namespace: source.namespace,
          kind: source.kind,
          connected: source.connected,
        })),
    [executorSourceData?.sources],
  );
  const restrictTools = toolAccessMode === "selected";

  useEffect(() => {
    setSelectedSkillSlugs(skillSelectionScopeKey, allowedSkillSlugs);
  }, [allowedSkillSlugs, setSelectedSkillSlugs, skillSelectionScopeKey]);

  const handleAutoApproveChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setAutoApprove(true);
        return;
      }
      setShowDisableAutoApproveDialog(true);
    },
    [setAutoApprove],
  );

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    [setName],
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDescription(event.target.value);
    },
    [setDescription],
  );

  const handleUsernameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setUsername(event.target.value);
    },
    [setUsername],
  );

  const handleModelSelectionChange = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      setModelSelection(input);
    },
    [setModelSelection],
  );

  const handleScheduleTypeChange = useCallback(
    (value: string) => {
      setScheduleType(value as "interval" | "daily" | "weekly" | "monthly");
    },
    [setScheduleType],
  );

  const handleIntervalHoursChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const hours = Math.max(1, parseInt(event.target.value) || 1);
      setIntervalHours(hours);
    },
    [setIntervalHours],
  );

  const handleScheduleTimeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setScheduleTime(event.target.value.slice(0, 5));
    },
    [setScheduleTime],
  );

  const handleToggleWeekDay = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const dayIndex = parseInt(event.currentTarget.dataset.dayIndex || "", 10);
      if (Number.isNaN(dayIndex)) {
        return;
      }
      toggleWeekDay(dayIndex);
    },
    [toggleWeekDay],
  );

  const handleScheduleDayOfMonthChange = useCallback(
    (value: string) => {
      setScheduleDayOfMonth(parseInt(value, 10));
    },
    [setScheduleDayOfMonth],
  );

  const handlePromptChange = useCallback(
    (value: string) => {
      setPrompt(value);
    },
    [setPrompt],
  );

  const handleRestrictToolsChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setToolAccessMode("all");
        return;
      }
      setToolAccessMode("selected");
    },
    [setToolAccessMode],
  );

  const handleSelectAllIntegrations = useCallback(() => {
    selectAllIntegrations();
  }, [selectAllIntegrations]);

  const handleClearIntegrations = useCallback(() => {
    clearIntegrations();
  }, [clearIntegrations]);

  const handleToggleIntegrationChecked = useCallback(
    (type: IntegrationType) => {
      toggleIntegration(type);
    },
    [toggleIntegration],
  );
  const handleToggleSkillChecked = useCallback(
    (skillKey: string) => {
      toggleSkill(skillKey);
    },
    [toggleSkill],
  );
  const handleToggleWorkspaceMcpServerChecked = useCallback(
    (sourceId: string) => {
      toggleWorkspaceMcpServer(sourceId);
    },
    [toggleWorkspaceMcpServer],
  );
  const handleClearWorkspaceMcpServers = useCallback(() => {
    clearWorkspaceMcpServers();
  }, [clearWorkspaceMcpServers]);
  const handleClearSkills = useCallback(() => {
    clearSkills();
  }, [clearSkills]);

  const handleDisableAutoApprove = useCallback(() => {
    setAutoApprove(false);
    setShowDisableAutoApproveDialog(false);
  }, [setAutoApprove]);

  const handleCopyForwardingAddress = useCallback(
    async (value: string, field: "coworkerAlias" | "invokeHandle") => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedForwardingField(field);
        setTimeout(() => setCopiedForwardingField(null), 1500);
      } catch (error) {
        console.error("Failed to copy forwarding address:", error);
      }
    },
    [],
  );

  const handleCopyCoworkerAlias = useCallback(() => {
    if (!coworkerForwardingAddress) {
      return;
    }
    void handleCopyForwardingAddress(coworkerForwardingAddress, "coworkerAlias");
  }, [handleCopyForwardingAddress, coworkerForwardingAddress]);

  const handleCreateCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await createForwardingAlias.mutateAsync(coworkerId);
      toast.success(t("Forwarding address created."));
    } catch (error) {
      console.error("Failed to create forwarding alias:", error);
      toast.error(t("Failed to create forwarding address."));
    }
  }, [createForwardingAlias, coworkerId, t]);

  const handleRotateCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await rotateForwardingAlias.mutateAsync(coworkerId);
      toast.success(t("Forwarding address rotated."));
    } catch (error) {
      console.error("Failed to rotate forwarding alias:", error);
      toast.error(t("Failed to rotate forwarding address."));
    }
  }, [rotateForwardingAlias, coworkerId, t]);

  const handleDisableCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await disableForwardingAlias.mutateAsync(coworkerId);
      toast.success(t("Forwarding address disabled."));
    } catch (error) {
      console.error("Failed to disable forwarding alias:", error);
      toast.error(t("Failed to disable forwarding address."));
    }
  }, [disableForwardingAlias, coworkerId, t]);

  const handleRun = useCallback(
    async (options?: {
      remoteIntegrationSource?: {
        targetEnv: RemoteIntegrationTargetEnv;
        remoteUserId: string;
      };
    }) => {
      if (!coworkerId || isStartingRun) {
        return null;
      }

      setIsStartingRun(true);
      try {
        const saveSucceeded = await persistCoworker({ force: true });
        if (!saveSucceeded) {
          toast.error(t("Failed to save coworker before test run."));
          return null;
        }

        const result = await triggerCoworker.mutateAsync({
          id: coworkerId,
          payload: {},
          remoteIntegrationSource: options?.remoteIntegrationSource,
        });
        toast.success(result.generationId ? "Run started." : "Needs your input.");
        void refetchRuns();
        return result;
      } catch (error) {
        console.error("Failed to run coworker:", error);
        toast.error(normalizeGenerationError(error, "start_rpc").message);
        return null;
      } finally {
        setIsStartingRun(false);
      }
    },
    [isStartingRun, persistCoworker, refetchRuns, triggerCoworker, coworkerId, t],
  );

  const executeResetRunsAndEnable = useCallback(async () => {
    if (!coworkerId || resetCoworkerRuns.isPending) {
      return;
    }

    try {
      await resetCoworkerRuns.mutateAsync(coworkerId);
      setStatusFromChecked(true);
      await Promise.all([refetchCoworker(), refetchRuns()]);
      toast.success(t("Runs reset and automation enabled."));
    } catch (error) {
      console.error("Failed to reset coworker runs:", error);
      toast.error(t("Failed to reset coworker runs."));
    }
  }, [coworkerId, refetchCoworker, refetchRuns, resetCoworkerRuns, setStatusFromChecked, t]);

  const handleResetRunsAndEnable = useCallback(() => {
    if (!coworkerId || resetCoworkerRuns.isPending) {
      return;
    }

    const toastId = toast.warning(t("Cancel previous runs?"), {
      description: t("This will cancel every unfinished run and turn automated triggers back on."),
      duration: Infinity,
      closeButton: true,
      action: {
        label: t("Cancel runs"),
        onClick: () => {
          toast.dismiss(toastId);
          void executeResetRunsAndEnable();
        },
      },
      cancel: {
        label: t("Keep runs"),
        onClick: () => {
          toast.dismiss(toastId);
        },
      },
    });
  }, [coworkerId, executeResetRunsAndEnable, resetCoworkerRuns.isPending, t]);

  const handleStatusChange = useCallback(
    (checked: boolean) => {
      if (checked && requiresResetBeforeEnable) {
        handleResetRunsAndEnable();
        return;
      }

      setStatusFromChecked(checked);
    },
    [handleResetRunsAndEnable, requiresResetBeforeEnable, setStatusFromChecked],
  );

  const handleSaveInstructions = useCallback(async () => {
    const saveSucceeded = await persistCoworker({ force: true });
    if (saveSucceeded) {
      toast.success(t("Instructions saved."));
    }
  }, [persistCoworker, t]);

  const hasAgentInstructions = prompt.trim().length > 0;
  const coworkerDisplayName = coworker?.name?.trim().length ? coworker.name : "New Coworker";

  useEffect(() => {
    const previousHasAgentInstructions = previousHasAgentInstructionsRef.current;

    if (!hasAgentInstructions) {
      setIsInstructionPanelCollapsed(true);
      previousHasAgentInstructionsRef.current = false;
      return;
    }

    if (!previousHasAgentInstructions) {
      setIsInstructionPanelCollapsed(false);
    }

    previousHasAgentInstructionsRef.current = true;
  }, [hasAgentInstructions]);

  const isRunDisabled = !hasAgentInstructions || triggerCoworker.isPending || isStartingRun;
  const isRunning = triggerCoworker.isPending || isStartingRun;
  const {
    handleRunClick,
    handleRemoteRunClick,
    handleTabChange,
    handleSelectRun,
    handleBackToRuns,
  } = useCoworkerEditorNavigation({
    coworkerId,
    coworkerRouteSlug,
    embedded,
    isMobile,
    isRunsRoute,
    routeBaseTab,
    remoteTargetEnv,
    selectedRemoteUser,
    setActiveTab,
    setSelectedRunId,
    runCoworker: handleRun,
  });
  const handleOpenDeleteDialog = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);
  const handleRemoteTargetEnvChange = useCallback((value: string) => {
    setRemoteTargetEnv(value as RemoteIntegrationTargetEnv);
  }, []);
  const handleRemoteUserQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRemoteUserQuery(event.target.value);
  }, []);
  const chatPanel = useMemo(
    () => (
      <CoworkerChatPanel
        conversationId={builderChatId}
        coworkerId={coworkerId ?? ""}
        onCoworkerSync={handleCoworkerSyncFromChat}
        skillSelectionScopeKey={skillSelectionScopeKey}
        isLoading={isBuilderChatLoading}
        errorMessage={builderChatError}
        onRetry={handleRetryBuilderChat}
      />
    ),
    [
      builderChatError,
      builderChatId,
      coworkerId,
      handleCoworkerSyncFromChat,
      handleRetryBuilderChat,
      isBuilderChatLoading,
      skillSelectionScopeKey,
    ],
  );
  const renderAdminContent = useCallback(
    () => (
      <RemoteIntegrationAdminPanel
        availableTargets={availableRemoteIntegrationTargets}
        selectedTargetEnv={remoteTargetEnv}
        remoteUserQuery={remoteUserQuery}
        remoteUserOptions={remoteUserOptions}
        selectedRemoteUser={selectedRemoteUser}
        isSearching={isRemoteUserSearchFetching}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        onTargetEnvChange={handleRemoteTargetEnvChange}
        onRemoteUserQueryChange={handleRemoteUserQueryChange}
        onSelectRemoteUser={setSelectedRemoteUser}
        onRun={handleRemoteRunClick}
      />
    ),
    [
      availableRemoteIntegrationTargets,
      handleRemoteRunClick,
      handleRemoteTargetEnvChange,
      handleRemoteUserQueryChange,
      isRemoteUserSearchFetching,
      isRunDisabled,
      isRunning,
      remoteTargetEnv,
      remoteUserOptions,
      remoteUserQuery,
      selectedRemoteUser,
    ],
  );
  const settingsPanelProps = useMemo(
    () =>
      ({
        coworkerId,
        coworkerRouteSlug,
        name,
        description,
        username,
        isSaving,
        status,
        disabledReason: coworker?.disabledReason ?? null,
        disabledAt: coworker?.disabledAt ?? null,
        autoApprove,
        requiresUserInput,
        userInputPrompt,
        prompt,
        model,
        modelAuthSource,
        providerAvailability,
        availableSkills,
        selectedSkillKeys,
        executorSourceEntries,
        selectedWorkspaceMcpServerIds: allowedWorkspaceMcpServerIds,
        isSkillsLoading: isPlatformSkillsLoading || isAccessibleSkillsLoading,
        restrictTools,
        allowedIntegrations,
        allIntegrationTypes,
        integrationEntries,
        triggerType,
        triggers,
        scheduleType,
        intervalMinutes,
        scheduleTime,
        scheduleDaysOfWeek,
        scheduleDayOfMonth,
        localTimezone: scheduleTimezone,
        hasActiveForwardingAlias,
        coworkerForwardingAddress,
        coworkerForwardingAlias,
        isEmailTriggerPersisted,
        copiedForwardingField,
        documents: coworker?.documents ?? EMPTY_COWORKER_DOCUMENTS,
        runs,
        activeTab,
        selectedRunId,
        isRunDisabled,
        isRunning,
        isResettingRuns: resetCoworkerRuns.isPending,
        isUploadingDocuments,
        deletingDocumentIds,
        downloadingDocumentIds,
        createForwardingAlias,
        disableForwardingAlias,
        rotateForwardingAlias,
        onUploadDocuments: handleUploadDocuments,
        onDownloadDocument: handleDownloadDocument,
        onDeleteDocument: handleDeleteDocument,
        onTabChange: handleTabChange,
        onRun: handleRunClick,
        onResetRunsAndEnable: handleResetRunsAndEnable,
        onSelectRun: handleSelectRun,
        onBackToRuns: handleBackToRuns,
        onNameChange: handleNameChange,
        onDescriptionChange: handleDescriptionChange,
        onUsernameChange: handleUsernameChange,
        onStatusChange: handleStatusChange,
        onAutoApproveChange: handleAutoApproveChange,
        onRequiresUserInputChange: setRequiresUserInput,
        onUserInputPromptChange: setUserInputPrompt,
        onPromptChange: handlePromptChange,
        onSaveInstructions: handleSaveInstructions,
        onModelChange: handleModelSelectionChange,
        onClearSkills: handleClearSkills,
        onToggleSkillChecked: handleToggleSkillChecked,
        onClearWorkspaceMcpServers: handleClearWorkspaceMcpServers,
        onToggleWorkspaceMcpServerChecked: handleToggleWorkspaceMcpServerChecked,
        onRestrictToolsChange: handleRestrictToolsChange,
        onSelectAllIntegrations: handleSelectAllIntegrations,
        onClearIntegrations: handleClearIntegrations,
        onToggleIntegrationChecked: handleToggleIntegrationChecked,
        onTriggerTypeChange: setTriggerType,
        onScheduleTypeChange: handleScheduleTypeChange,
        onIntervalHoursChange: handleIntervalHoursChange,
        onScheduleTimeChange: handleScheduleTimeChange,
        onToggleWeekDay: handleToggleWeekDay,
        onScheduleDayOfMonthChange: handleScheduleDayOfMonthChange,
        onCopyCoworkerAlias: handleCopyCoworkerAlias,
        onRotateCoworkerAlias: handleRotateCoworkerAlias,
        onDisableCoworkerAlias: handleDisableCoworkerAlias,
        onCreateCoworkerAlias: handleCreateCoworkerAlias,
        onClose: handleClose,
        showDeleteDialog,
        onShowDeleteDialogChange: setShowDeleteDialog,
        onDelete: handleDelete,
        isDeleting: deleteCoworker.isPending,
        showAdminTab: isAdmin,
        renderAdminContent,
      }) satisfies ComponentProps<typeof CoworkerSettingsPanel>,
    [
      activeTab,
      allowedIntegrations,
      allowedWorkspaceMcpServerIds,
      allIntegrationTypes,
      autoApprove,
      availableSkills,
      coworker?.disabledAt,
      coworker?.disabledReason,
      copiedForwardingField,
      coworker?.documents,
      coworkerForwardingAddress,
      coworkerForwardingAlias,
      coworkerId,
      coworkerRouteSlug,
      createForwardingAlias,
      deletingDocumentIds,
      deleteCoworker.isPending,
      description,
      disableForwardingAlias,
      downloadingDocumentIds,
      executorSourceEntries,
      handleAutoApproveChange,
      handleBackToRuns,
      handleClearIntegrations,
      handleClearSkills,
      handleClearWorkspaceMcpServers,
      handleClose,
      handleCopyCoworkerAlias,
      handleCreateCoworkerAlias,
      handleDelete,
      handleDeleteDocument,
      handleDescriptionChange,
      handleDisableCoworkerAlias,
      handleDownloadDocument,
      handleIntervalHoursChange,
      handleModelSelectionChange,
      handleNameChange,
      handlePromptChange,
      handleRestrictToolsChange,
      handleRotateCoworkerAlias,
      handleRunClick,
      handleResetRunsAndEnable,
      handleSaveInstructions,
      handleScheduleDayOfMonthChange,
      handleScheduleTimeChange,
      handleScheduleTypeChange,
      handleSelectAllIntegrations,
      handleSelectRun,
      handleStatusChange,
      handleTabChange,
      handleToggleIntegrationChecked,
      handleToggleSkillChecked,
      handleToggleWeekDay,
      handleToggleWorkspaceMcpServerChecked,
      handleUploadDocuments,
      handleUsernameChange,
      hasActiveForwardingAlias,
      integrationEntries,
      intervalMinutes,
      isAccessibleSkillsLoading,
      isAdmin,
      isEmailTriggerPersisted,
      isPlatformSkillsLoading,
      isRunDisabled,
      isRunning,
      resetCoworkerRuns.isPending,
      isSaving,
      isUploadingDocuments,
      model,
      modelAuthSource,
      name,
      prompt,
      providerAvailability,
      renderAdminContent,
      requiresUserInput,
      restrictTools,
      rotateForwardingAlias,
      runs,
      scheduleDayOfMonth,
      scheduleDaysOfWeek,
      scheduleTime,
      scheduleTimezone,
      scheduleType,
      selectedRunId,
      selectedSkillKeys,
      setRequiresUserInput,
      setShowDeleteDialog,
      setTriggerType,
      setUserInputPrompt,
      showDeleteDialog,
      status,
      triggerType,
      triggers,
      userInputPrompt,
      username,
    ],
  );
  const renderSettingsPanel = useCallback(
    ({ hideHeader = false }: { hideHeader?: boolean } = {}) => (
      <CoworkerSettingsPanel {...settingsPanelProps} hideHeader={hideHeader} />
    ),
    [settingsPanelProps],
  );
  const autoApproveDialog = useMemo(
    () => (
      <DisableAutoApproveDialog
        open={showDisableAutoApproveDialog}
        onOpenChange={setShowDisableAutoApproveDialog}
        onDisable={handleDisableAutoApprove}
      />
    ),
    [handleDisableAutoApprove, showDisableAutoApproveDialog],
  );

  if (
    isLoading ||
    (Boolean(coworkerId) && !hasResolvedInitialCoworker) ||
    (!coworkerId && coworkerList.isLoading) ||
    (shouldLoadCoworkerImpersonationTarget && isCoworkerImpersonationTargetLoading) ||
    (shouldLoadRunImpersonationTarget && isRunImpersonationTargetLoading)
  ) {
    return (
      <div className="text-muted-foreground flex h-full min-h-0 w-full flex-1 items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>
          <T>Loading coworker</T>
        </span>
      </div>
    );
  }

  if (!coworker) {
    const impersonationTarget = routeRunId ? runImpersonationTarget : coworkerImpersonationTarget;

    if (impersonationTarget) {
      return (
        <ImpersonationRequiredPage target={impersonationTarget} redirectPath={currentRoutePath} />
      );
    }

    return (
      <div className="text-muted-foreground flex h-full min-h-0 w-full flex-1 items-center justify-center p-6 text-sm">
        {routeRunId ? "Run not found." : "Coworker not found."}
      </div>
    );
  }

  if (isMobile) {
    return (
      <CoworkerEditorMobileLayout
        activeTab={activeTab}
        status={status}
        showAdminTab={isAdmin}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        isDeleting={deleteCoworker.isPending}
        showDeleteDialog={showDeleteDialog}
        chatPanel={chatPanel}
        renderSettingsPanel={renderSettingsPanel}
        autoApproveDialog={autoApproveDialog}
        onTabChange={handleTabChange}
        onStatusChange={handleStatusChange}
        onRun={handleRunClick}
        onOpenDeleteDialog={handleOpenDeleteDialog}
        onShowDeleteDialogChange={setShowDeleteDialog}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <CoworkerEditorDesktopLayout
      rightTitle={coworkerDisplayName}
      rightCollapsed={isInstructionPanelCollapsed}
      chatPanel={chatPanel}
      renderSettingsPanel={renderSettingsPanel}
      autoApproveDialog={autoApproveDialog}
      onRightCollapsedChange={setIsInstructionPanelCollapsed}
    />
  );
}
