import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { CUSTOM_SKILL_PREFIX } from "@bap/core/lib/coworker-tool-policy";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@bap/core/lib/email-forwarding";
import { msg } from "gt-react";
import {
  createElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import { useChatSkillStore } from "@/components/chat/chat-skill-store";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  type IntegrationType,
} from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import {
  useCoworker,
  useCoworkerForwardingAlias,
  useCoworkerImpersonationTarget,
  useCoworkerRunImpersonationTarget,
  useUpdateCoworker,
  useCoworkerRuns,
  useRemoteIntegrationTargets,
  useSearchRemoteIntegrationUsers,
} from "@/orpc/hooks/coworkers";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { usePlatformSkillList, useSkillList } from "@/orpc/hooks/skills";
import { useWorkspaceMcpServerList } from "@/orpc/hooks/workspace-mcp-servers";
import { CoworkerAdminPanel } from "./coworker-admin-panel";
import { CoworkerChatPanel } from "./coworker-chat-panel";
import { DisableAutoApproveDialog } from "./coworker-editor-layout";
import { CoworkerSettingsPanel } from "./coworker-settings-panel";
import {
  EMPTY_COWORKER_DOCUMENTS,
  type CoworkerTab,
  type RemoteIntegrationTargetEnv,
  type RemoteIntegrationUserOption,
} from "./types";
import { useCoworkerEditorActions } from "./use-coworker-editor-actions";
import { useCoworkerEditorIdentity } from "./use-coworker-editor-identity";
import { useCoworkerBuilderChat } from "./use-coworker-builder-chat";
import { useCoworkerDefinitionEditor } from "./use-coworker-definition-editor";
import { useCoworkerDocuments } from "./use-coworker-documents";
import { useCoworkerEditorNavigation } from "./use-coworker-editor-navigation";

const BASE_TRIGGERS = [
  { value: "manual", label: msg("Manual only") },
  { value: "schedule", label: msg("Run on a schedule") },
  { value: EMAIL_FORWARDED_TRIGGER_TYPE, label: msg("Email forwarded to Bap") },
];

const LEGACY_HIDDEN_TRIGGERS = [
  { value: "gmail.new_email", label: msg("New Gmail email") },
];
const COWORKER_RUN_BACKLOG_LIMIT = 5;
const COWORKER_RUN_BACKLOG_STATUSES = new Set([
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

type UseCoworkerEditorPageInput = {
  coworkerIdOverride?: string;
  embedded: boolean;
  isMobile: boolean;
};

/**
 * The coworker editor controller. It composes three deep hooks — identity/route
 * resolution (`useCoworkerEditorIdentity`), imperative side-effects
 * (`useCoworkerEditorActions`), and the definition editor — then derives the
 * remaining presentational inputs: tab/dialog UI state, the skill/integration
 * option lists, and the large settings-panel prop bag plus the chat, admin, and
 * auto-approve render nodes.
 *
 * The page component reads the returned object and only chooses between the
 * loading, not-found/impersonation, mobile, and desktop terminal renders.
 */
export function useCoworkerEditorPage({
  coworkerIdOverride,
  embedded,
  isMobile,
}: UseCoworkerEditorPageInput) {
  const { isAdmin } = useIsAdmin();
  const {
    coworkerId,
    coworkerRouteSlug,
    coworkerListIsLoading,
    routeBaseTab,
    routeRunId,
    isNestedRunsRoute,
    isRunsRoute,
    currentRoutePath,
  } = useCoworkerEditorIdentity({ coworkerIdOverride, embedded });

  const {
    data: activeCoworker,
    isLoading: activeIsLoading,
    refetch: refetchActiveCoworker,
  } = useCoworker(coworkerId);

  const shouldLoadCoworkerImpersonationTarget = Boolean(
    coworkerId && !routeRunId && !activeIsLoading && !activeCoworker,
  );
  const shouldLoadRunImpersonationTarget = Boolean(
    routeRunId && !activeIsLoading && !activeCoworker,
  );
  const {
    data: coworkerImpersonationTarget,
    isLoading: isCoworkerImpersonationTargetLoading,
  } = useCoworkerImpersonationTarget(coworkerId, {
    enabled: shouldLoadCoworkerImpersonationTarget,
  });
  const {
    data: runImpersonationTarget,
    isLoading: isRunImpersonationTargetLoading,
  } = useCoworkerRunImpersonationTarget(routeRunId, coworkerId, {
    enabled: shouldLoadRunImpersonationTarget,
  });
  const impersonationTarget = routeRunId
    ? runImpersonationTarget
    : coworkerImpersonationTarget;
  const isImpersonationTargetLoading =
    (shouldLoadCoworkerImpersonationTarget &&
      isCoworkerImpersonationTargetLoading) ||
    (shouldLoadRunImpersonationTarget && isRunImpersonationTargetLoading);

  const [hasResolvedInitialCoworker, setHasResolvedInitialCoworker] =
    useState(false);
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } =
    usePlatformSkillList();
  const { data: accessibleSkills, isLoading: isAccessibleSkillsLoading } =
    useSkillList();
  const { data: executorSourceData } = useWorkspaceMcpServerList();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: remoteIntegrationTargetsData } = useRemoteIntegrationTargets({
    enabled: isAdmin,
  });
  const { data: coworkerForwardingAlias } =
    useCoworkerForwardingAlias(coworkerId);
  const { data: runs, refetch: refetchRuns } = useCoworkerRuns(coworkerId);
  const updateCoworker = useUpdateCoworker();

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
    coworker: activeCoworker,
    allIntegrationTypes,
    updateCoworker,
    refetchCoworker: refetchActiveCoworker,
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
  const [showDisableAutoApproveDialog, setShowDisableAutoApproveDialog] =
    useState(false);
  const [activeTab, setActiveTab] = useState<CoworkerTab>("instruction");
  const [remoteTargetEnv, setRemoteTargetEnv] =
    useState<RemoteIntegrationTargetEnv | null>(null);
  const [remoteUserQuery, setRemoteUserQuery] = useState("");
  const [selectedRemoteUser, setSelectedRemoteUser] =
    useState<RemoteIntegrationUserOption | null>(null);
  const builderChat = useCoworkerBuilderChat({
    coworkerId,
    loadedCoworkerId: activeCoworker?.id,
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
  const remoteUserSearchEnabled =
    isAdmin && activeTab === "admin" && Boolean(remoteTargetEnv);
  const { data: remoteUserSearchData, isFetching: isRemoteUserSearchFetching } =
    useSearchRemoteIntegrationUsers(remoteTargetEnv, deferredRemoteUserQuery, {
      enabled: remoteUserSearchEnabled,
      limit: 12,
    });
  const requiresResetBeforeEnable = useMemo(() => {
    const backlogRunCount =
      runs?.filter((run) => COWORKER_RUN_BACKLOG_STATUSES.has(run.status))
        .length ?? 0;
    return (
      activeCoworker?.disabledReason === "run_backlog_limit" ||
      backlogRunCount >= COWORKER_RUN_BACKLOG_LIMIT
    );
  }, [activeCoworker?.disabledReason, runs]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(routeRunId);
  const hasSetMobileDefaultRef = useRef(false);
  const remoteUserOptions = useMemo(
    () =>
      (remoteUserSearchData?.users as
        RemoteIntegrationUserOption[] | undefined) ?? [],
    [remoteUserSearchData],
  );

  const coworkerForwardingAddress =
    coworkerForwardingAlias?.forwardingAddress ?? null;
  const actions = useCoworkerEditorActions({
    coworkerId,
    embedded,
    coworkerForwardingAddress,
    requiresResetBeforeEnable,
    persistCoworker,
    setStatusFromChecked,
    refetchCoworker: refetchActiveCoworker,
    refetchRuns,
  });
  const {
    createForwardingAlias,
    disableForwardingAlias,
    rotateForwardingAlias,
    triggerCoworker,
    resetCoworkerRuns,
    deleteCoworker,
    showDeleteDialog,
    setShowDeleteDialog,
    isRunning,
    copiedForwardingField,
    handleDelete,
    handleOpenDeleteDialog,
    handleCopyCoworkerAlias,
    handleCreateCoworkerAlias,
    handleRotateCoworkerAlias,
    handleDisableCoworkerAlias,
    handleRun,
    handleResetRunsAndEnable,
    handleStatusChange,
    handleSaveInstructions,
  } = actions;

  useEffect(() => {
    if (!activeCoworker) {
      setHasResolvedInitialCoworker(false);
      return;
    }

    const timeout = window.setTimeout(
      () => setHasResolvedInitialCoworker(true),
      120,
    );
    return () => window.clearTimeout(timeout);
  }, [activeCoworker]);

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

    if (
      remoteTargetEnv &&
      availableRemoteIntegrationTargets.includes(remoteTargetEnv)
    ) {
      return;
    }

    setRemoteTargetEnv(
      availableRemoteIntegrationTargets.length > 0
        ? availableRemoteIntegrationTargets[0]
        : null,
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
        setActiveTab(routeBaseTab === "runs" ? "instruction" : routeBaseTab);
      }
      return;
    }

    setActiveTab("instruction");
    setSelectedRunId(routeRunId);
  }, [isRunsRoute, routeBaseTab, routeRunId]);
  const [isInstructionPanelCollapsed, setIsInstructionPanelCollapsed] =
    useState(true);
  const previousHasAgentInstructionsRef = useRef(false);
  const handleClose = useCallback(() => {
    setIsInstructionPanelCollapsed(true);
  }, []);
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );
  const hasActiveForwardingAlias = Boolean(
    coworkerForwardingAlias?.activeAlias,
  );
  const isEmailTriggerPersisted =
    activeCoworker?.triggerType === EMAIL_FORWARDED_TRIGGER_TYPE;
  const persistedLegacyTriggers = useMemo(
    () =>
      LEGACY_HIDDEN_TRIGGERS.filter(
        ({ value }) => value === activeCoworker?.triggerType,
      ),
    [activeCoworker?.triggerType],
  );
  const triggers = useMemo(
    () => [...BASE_TRIGGERS, ...persistedLegacyTriggers],
    [persistedLegacyTriggers],
  );
  const skillSelectionScopeKey = useMemo(
    () => (coworkerId ? `coworker-builder:${coworkerId}` : "coworker-builder"),
    [coworkerId],
  );
  const setSelectedSkillSlugs = useChatSkillStore(
    (state) => state.setSelectedSkillSlugs,
  );
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

  const hasAgentInstructions = prompt.trim().length > 0;
  const coworkerDisplayName = activeCoworker?.name?.trim().length
    ? activeCoworker.name
    : "New Coworker";

  useEffect(() => {
    const previousHasAgentInstructions =
      previousHasAgentInstructionsRef.current;

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

  const isRunDisabled =
    !hasAgentInstructions || triggerCoworker.isPending || actions.isStartingRun;
  const { handleRunClick, handleRemoteRunClick, handleTabChange } =
    useCoworkerEditorNavigation({
      coworkerId,
      coworkerRouteSlug,
      embedded,
      isMobile,
      isNestedRunsRoute,
      isRunsRoute,
      routeBaseTab,
      remoteTargetEnv,
      selectedRemoteUser,
      setActiveTab,
      setSelectedRunId,
      runCoworker: handleRun,
    });
  const handleRemoteTargetEnvChange = useCallback((value: string) => {
    setRemoteTargetEnv(value as RemoteIntegrationTargetEnv);
  }, []);
  const handleRemoteUserQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRemoteUserQuery(event.target.value);
    },
    [],
  );
  const chatPanel = useMemo(
    () =>
      createElement(CoworkerChatPanel, {
        conversationId: builderChatId,
        coworkerId: coworkerId ?? "",
        onCoworkerSync: handleCoworkerSyncFromChat,
        skillSelectionScopeKey,
        isLoading: isBuilderChatLoading,
        errorMessage: builderChatError,
        onRetry: handleRetryBuilderChat,
      }),
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
    () =>
      createElement(CoworkerAdminPanel, {
        coworkerId,
        availableTargets: availableRemoteIntegrationTargets,
        selectedTargetEnv: remoteTargetEnv,
        remoteUserQuery,
        remoteUserOptions,
        selectedRemoteUser,
        isSearching: isRemoteUserSearchFetching,
        isRunDisabled,
        isRunning,
        onTargetEnvChange: handleRemoteTargetEnvChange,
        onRemoteUserQueryChange: handleRemoteUserQueryChange,
        onSelectRemoteUser: setSelectedRemoteUser,
        onRun: handleRemoteRunClick,
      }),
    [
      availableRemoteIntegrationTargets,
      coworkerId,
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
        disabledReason: activeCoworker?.disabledReason ?? null,
        disabledAt: activeCoworker?.disabledAt ?? null,
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
        documents: activeCoworker?.documents ?? EMPTY_COWORKER_DOCUMENTS,
        activeTab,
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
        onToggleWorkspaceMcpServerChecked:
          handleToggleWorkspaceMcpServerChecked,
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
      activeCoworker?.disabledAt,
      activeCoworker?.disabledReason,
      copiedForwardingField,
      activeCoworker?.documents,
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
    ({ hideHeader = false }: { hideHeader?: boolean } = {}) =>
      createElement(CoworkerSettingsPanel, {
        ...settingsPanelProps,
        hideHeader,
      }),
    [settingsPanelProps],
  );
  const autoApproveDialog = useMemo(
    () =>
      createElement(DisableAutoApproveDialog, {
        open: showDisableAutoApproveDialog,
        onOpenChange: setShowDisableAutoApproveDialog,
        onDisable: handleDisableAutoApprove,
      }),
    [handleDisableAutoApprove, showDisableAutoApproveDialog],
  );

  const isInitialLoading =
    activeIsLoading ||
    (Boolean(coworkerId) && !hasResolvedInitialCoworker) ||
    (!coworkerId && coworkerListIsLoading) ||
    isImpersonationTargetLoading;

  return {
    coworker: activeCoworker,
    isInitialLoading,
    routeRunId,
    impersonationTarget,
    currentRoutePath,
    isAdmin,
    activeTab,
    status,
    isRunDisabled,
    isRunning,
    isDeleting: deleteCoworker.isPending,
    showDeleteDialog,
    coworkerDisplayName,
    isInstructionPanelCollapsed,
    setIsInstructionPanelCollapsed,
    chatPanel,
    renderSettingsPanel,
    autoApproveDialog,
    handleTabChange,
    handleStatusChange,
    handleRunClick,
    handleOpenDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
  };
}
