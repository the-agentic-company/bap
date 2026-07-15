// oxlint-disable jsx-a11y/control-has-associated-label

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { msg, useGT } from "gt-react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ToolboxPreviewModal } from "@/components/toolbox-preview-modal";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { blobToBase64 } from "@/hooks/use-voice-recording";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { formatOAuthConnectionError } from "@/lib/oauth-error-message";
import {
  useIntegrationList,
  useGetAuthUrl,
  useGoogleAccessStatus,
  useToggleIntegration,
  useDisconnectIntegration,
  useRenameAccountLabel,
  useLinkLinkedIn,
  useRequestGoogleAccess,
} from "@/orpc/hooks/integrations";
import {
  useSkillList,
  useCreateSkill,
  useImportSkill,
  useDeleteSkill,
  useSaveSharedSkill,
  useShareSkill,
  useUnshareSkill,
} from "@/orpc/hooks/skills";
import { useWorkspaceMcpServerList } from "@/orpc/hooks/workspace-mcp-servers";
import {
  COMMUNITY_SKILLS,
  FADE_IN_MOTION,
  adminPreviewOnlyIntegrations,
  integrationConfig,
  isGoogleIntegrationType,
  toErrorMessage,
  type FilterTab,
  type GoogleIntegrationType,
  type IntegrationType,
  type OAuthIntegrationType,
} from "./-toolbox/data";
import { ToolboxResults, ToolboxToolbar } from "./-toolbox/sections";

// ─── Page content ───────────────────────────────────────────────────────────────

export function ToolboxPage() {
  const t = useGT();

  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const isMobile = useIsMobile();
  const { isAdmin } = useIsAdmin();

  // Integration hooks
  const {
    data: integrations,
    isLoading: integrationsLoading,
    refetch: refetchIntegrations,
  } = useIntegrationList();
  const { data: googleAccessStatus } = useGoogleAccessStatus();
  const getAuthUrl = useGetAuthUrl();
  const requestGoogleAccess = useRequestGoogleAccess();
  const toggleIntegration = useToggleIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const renameAccountLabel = useRenameAccountLabel();
  const linkLinkedIn = useLinkLinkedIn();

  // Executor source hooks
  const { data: executorData, isLoading: executorLoading } = useWorkspaceMcpServerList();

  // Skill hooks
  const { data: skills, isLoading: skillsLoading, refetch: refetchSkills } = useSkillList();
  const createSkill = useCreateSkill();
  const importSkill = useImportSkill();
  const deleteSkill = useDeleteSkill();
  const shareSkill = useShareSkill();
  const unshareSkill = useUnshareSkill();
  const saveSharedSkill = useSaveSharedSkill();

  // Local state
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [integrationConnectErrors, setIntegrationConnectErrors] = useState<
    Partial<Record<OAuthIntegrationType, string>>
  >({});
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [communitySkillToggles, setCommunitySkillToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COMMUNITY_SKILLS.map((s) => [s.id, s.enabled])),
  );
  const linkedInLinkingRef = useRef(false);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const folderImportInputRef = useRef<HTMLInputElement>(null);
  const [supportsFolderImport, setSupportsFolderImport] = useState(false);

  const isLoading = integrationsLoading || skillsLoading || executorLoading;
  const executorSources = useMemo(() => executorData?.sources ?? [], [executorData?.sources]);
  const lacksGoogleAccess = googleAccessStatus?.allowed === false;

  // Integration data
  const integrationsList = useMemo(
    () => (Array.isArray(integrations) ? integrations : []),
    [integrations],
  );
  const connectedIntegrations = useMemo(
    () =>
      new Map<string, (typeof integrationsList)[number]>(integrationsList.map((i) => [i.type, i])),
    [integrationsList],
  );

  const visibleIntegrations = useMemo(
    () =>
      (
        Object.entries(integrationConfig) as [
          IntegrationType,
          (typeof integrationConfig)[IntegrationType],
        ][]
      ).filter(([type]) => isAdmin || !adminPreviewOnlyIntegrations.has(type)),
    [isAdmin],
  );

  // Skill data
  const skillsList = useMemo(() => (Array.isArray(skills) ? skills : []), [skills]);
  const ownedSkillsList = useMemo(
    () => skillsList.filter((skill) => skill.isOwnedByCurrentUser),
    [skillsList],
  );
  const sharedSkillsList = useMemo(
    () =>
      skillsList.filter((skill) => !skill.isOwnedByCurrentUser && skill.visibility === "public"),
    [skillsList],
  );

  // ─── LinkedIn redirect handling ─────────────────────────────────────────────
  useEffect(() => {
    const accountId = searchParams.get("account_id");
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn
        .mutateAsync(accountId)
        .then(() => {
          toast.success(t("LinkedIn connected successfully!"));
          refetchIntegrations();
        })
        .catch(() => {
          toast.error(t("Failed to connect LinkedIn. Please try again."));
        })
        .finally(() => {
          void navigate({ to: "/toolbox", replace: true });
        });
    }
  }, [searchParams, linkLinkedIn, navigate, refetchIntegrations, t]);

  // ─── URL params handling (OAuth callback) ───────────────────────────────────
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success) {
      queueMicrotask(() => {
        toast.success(t("Integration connected successfully!"));
      });
      void navigate({ to: "/toolbox", replace: true });
      refetchIntegrations();
    } else if (error) {
      queueMicrotask(() => {
        toast.error(formatOAuthConnectionError(error));
      });
      void navigate({ to: "/toolbox", replace: true });
    }
  }, [searchParams, navigate, refetchIntegrations, t]);

  useEffect(() => {
    const input = folderImportInputRef.current;
    if (!input) {
      return;
    }

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");

    const supportsDirectorySelection =
      "webkitdirectory" in (input as HTMLInputElement & { webkitdirectory?: boolean });
    setSupportsFolderImport(supportsDirectorySelection);
  }, []);

  // ─── Integration handlers ───────────────────────────────────────────────────
  const handleIntegrationConnect = useCallback(
    async (
      type: OAuthIntegrationType,
      options?: { mode?: "connect" | "connect_to_label" | "reauth" },
    ) => {
      setConnectingType(type);
      setIntegrationConnectErrors((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: window.location.href,
          mode: options?.mode,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        const message = toErrorMessage(error, "");
        setConnectingType(null);
        setIntegrationConnectErrors((prev) => ({
          ...prev,
          [type]: isUnipileMissingCredentialsError(error)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : message.includes("admin approval")
              ? "Google access is restricted. Use Request access first."
              : "Failed to start connection. Please try again.",
        }));
      }
    },
    [getAuthUrl],
  );

  const handleIntegrationToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleIntegration.mutateAsync({ id, enabled });
        refetchIntegrations();
      } catch (error) {
        console.error("Failed to toggle integration:", error);
      }
    },
    [refetchIntegrations, toggleIntegration],
  );

  const handleIntegrationDisconnect = useCallback(
    async (id: string) => {
      try {
        await disconnectIntegration.mutateAsync(id);
        refetchIntegrations();
      } catch (error) {
        console.error("Failed to disconnect integration:", error);
      }
    },
    [disconnectIntegration, refetchIntegrations],
  );

  const handleRequestGoogleAccess = useCallback(
    async (type: GoogleIntegrationType) => {
      try {
        await requestGoogleAccess.mutateAsync({ integration: type, source: "integrations" });
        toast.success(
          t("Access request sent. We notified the team and will approve your Google access."),
        );
      } catch {
        toast.error(t("Failed to send access request."));
      }
    },
    [requestGoogleAccess, t],
  );

  // ─── Skill handlers ────────────────────────────────────────────────────────
  const handleCreateSkill = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await createSkill.mutateAsync({
        displayName: "New Skill",
        description: msg("Add a description for this skill"),
      });
      void navigate({ to: "/skills/$id", params: { id: result.id } });
    } catch {
      toast.error(t("Failed to create skill."));
      setIsCreating(false);
    }
  }, [createSkill, navigate, t]);

  const handleImportZipClick = useCallback(() => {
    if (importSkill.isPending) {
      return;
    }
    zipImportInputRef.current?.click();
  }, [importSkill.isPending]);

  const handleImportFolderClick = useCallback(() => {
    if (importSkill.isPending || !supportsFolderImport) {
      return;
    }
    folderImportInputRef.current?.click();
  }, [importSkill.isPending, supportsFolderImport]);

  const handleNewMcpSource = useCallback(() => {
    void navigate({ to: "/toolbox/sources/new", search: { kind: "mcp" } });
  }, [navigate]);

  const handleImportZipChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".zip")) {
        toast.error(t("Select a .zip skill archive."));
        return;
      }

      try {
        const created = await importSkill.mutateAsync({
          mode: "zip",
          filename: file.name,
          contentBase64: await blobToBase64(file),
        });
        toast.success(`Imported ${created.displayName}. Review it before enabling.`);
        void navigate({ to: "/skills/$id", params: { id: created.id } });
      } catch (error) {
        console.error("Failed to import skill zip:", error);
        toast.error(toErrorMessage(error, "Failed to import skill."));
      }
    },
    [importSkill, navigate, t],
  );

  const handleImportFolderChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) {
        return;
      }

      try {
        const importedFiles = await Promise.all(
          files.map(async (file) => {
            const relativePath =
              (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
            return {
              path: relativePath,
              mimeType: file.type || undefined,
              contentBase64: await blobToBase64(file),
            };
          }),
        );

        const created = await importSkill.mutateAsync({
          mode: "folder",
          files: importedFiles,
        });
        toast.success(`Imported ${created.displayName}. Review it before enabling.`);
        void navigate({ to: "/skills/$id", params: { id: created.id } });
      } catch (error) {
        console.error("Failed to import skill folder:", error);
        toast.error(toErrorMessage(error, "Failed to import skill."));
      }
    },
    [importSkill, navigate],
  );

  const handleSkillDelete = useCallback(
    async (id: string, displayName: string) => {
      if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
        return;
      }
      try {
        await deleteSkill.mutateAsync(id);
        toast.success(`Skill "${displayName}" deleted.`);
        refetchSkills();
      } catch {
        toast.error(t("Failed to delete skill."));
      }
    },
    [deleteSkill, refetchSkills, t],
  );

  const handleShareSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        await shareSkill.mutateAsync(id);
        toast.success(`Shared "${displayName}" with the workspace.`);
        refetchSkills();
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to share skill."));
      }
    },
    [refetchSkills, shareSkill],
  );

  const handleUnshareSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        await unshareSkill.mutateAsync(id);
        toast.success(`Unshared "${displayName}".`);
        refetchSkills();
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to unshare skill."));
      }
    },
    [refetchSkills, unshareSkill],
  );

  const handleSaveSharedSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        const saved = await saveSharedSkill.mutateAsync(id);
        toast.success(`Saved "${displayName}" to your skills.`);
        void navigate({ to: "/skills/$id", params: { id: saved.id } });
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to save shared skill."));
      }
    },
    [navigate, saveSharedSkill],
  );

  // ─── Community skill handlers ─────────────────────────────────────────────
  const handleCommunitySkillToggle = useCallback((id: string, value: boolean) => {
    setCommunitySkillToggles((prev) => ({ ...prev, [id]: value }));
  }, []);

  // ─── Search & filter ───────────────────────────────────────────────────────
  const q = search.toLowerCase().trim();

  const filteredIntegrations = useMemo(() => {
    return visibleIntegrations.filter(([type, config]) => {
      const integration = connectedIntegrations.get(type);
      const isConnected = !!integration;
      const isEnabled = integration?.enabled ?? false;

      // Search filter
      if (
        q &&
        !config.name.toLowerCase().includes(q) &&
        !config.description.toLowerCase().includes(q)
      ) {
        return false;
      }

      // Tab filter
      if (activeTab === "active") {
        return isConnected && isEnabled;
      }
      if (activeTab === "needs_setup") {
        return !isConnected && !adminPreviewOnlyIntegrations.has(type);
      }
      return true;
    });
  }, [visibleIntegrations, q, activeTab, connectedIntegrations]);

  const filteredOwnedSkills = useMemo(() => {
    let filtered = ownedSkillsList;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled);
    }
    if (activeTab === "needs_setup") {
      return []; // skills never need setup
    }
    return filtered;
  }, [ownedSkillsList, q, activeTab]);

  const filteredSharedSkills = useMemo(() => {
    let filtered = sharedSkillsList;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.owner.name ?? s.owner.email ?? "").toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled);
    }
    if (activeTab === "needs_setup") {
      return [];
    }
    return filtered;
  }, [activeTab, q, sharedSkillsList]);

  const filteredCommunitySkills = useMemo(() => {
    let filtered = COMMUNITY_SKILLS;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => communitySkillToggles[s.id] ?? s.enabled);
    }
    if (activeTab === "needs_setup") {
      return []; // skills never need setup
    }
    return filtered;
  }, [q, activeTab, communitySkillToggles]);

  const filteredWorkspaceMcpServers = useMemo(() => {
    let filtered = executorSources;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.namespace.toLowerCase().includes(q) ||
          s.endpoint.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled && s.connected && s.credentialEnabled);
    }
    if (activeTab === "needs_setup") {
      filtered = filtered.filter((s) => !s.connected);
    }
    return filtered;
  }, [executorSources, q, activeTab]);

  // ─── Counts ─────────────────────────────────────────────────────────────────
  const totalActive = useMemo(() => {
    const activeIntegrations = visibleIntegrations.filter(([type]) => {
      const integration = connectedIntegrations.get(type);
      return integration?.enabled;
    }).length;
    const activeCustom = skillsList.filter((s) => s.enabled).length;
    const activeCommunity = COMMUNITY_SKILLS.filter(
      (s) => communitySkillToggles[s.id] ?? s.enabled,
    ).length;
    const activeWorkspaceMcpServers = executorSources.filter(
      (s) => s.enabled && s.connected && s.credentialEnabled,
    ).length;
    return activeIntegrations + activeCustom + activeCommunity + activeWorkspaceMcpServers;
  }, [
    visibleIntegrations,
    connectedIntegrations,
    skillsList,
    communitySkillToggles,
    executorSources,
  ]);

  const totalNeedsSetup = useMemo(() => {
    const integrationNeedsSetup = visibleIntegrations.filter(([type]) => {
      return !connectedIntegrations.get(type) && !adminPreviewOnlyIntegrations.has(type);
    }).length;
    const executorNeedsSetup = executorSources.filter((s) => !s.connected).length;
    return integrationNeedsSetup + executorNeedsSetup;
  }, [visibleIntegrations, connectedIntegrations, executorSources]);

  const totalAll =
    visibleIntegrations.length +
    skillsList.length +
    COMMUNITY_SKILLS.length +
    executorSources.length;

  const hasResults =
    filteredIntegrations.length > 0 ||
    filteredOwnedSkills.length > 0 ||
    filteredSharedSkills.length > 0 ||
    filteredCommunitySkills.length > 0 ||
    filteredWorkspaceMcpServers.length > 0;

  const tabs: { id: FilterTab; label: string; count: number }[] = useMemo(
    () => [
      { id: "all", label: t("All"), count: totalAll },
      { id: "active", label: t("Active"), count: totalActive },
      { id: "needs_setup", label: t("Needs Setup"), count: totalNeedsSetup },
    ],
    [t, totalAll, totalActive, totalNeedsSetup],
  );

  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key as FilterTab);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const skillHandlers = useMemo(
    () => ({
      onDelete: handleSkillDelete,
      onShare: handleShareSkill,
      onUnshare: handleUnshareSkill,
      onSaveShared: handleSaveSharedSkill,
    }),
    [handleSaveSharedSkill, handleShareSkill, handleSkillDelete, handleUnshareSkill],
  );

  // ─── Preview modal helpers ───────────────────────────────────────────────────
  const previewId = searchParams.get("preview");

  useEffect(() => {
    if (!isMobile || !previewId?.startsWith("integration:")) {
      return;
    }

    void navigate({
      to: "/integrations/$type",
      params: { type: previewId.slice("integration:".length) },
      replace: true,
      resetScroll: false,
    });
  }, [isMobile, navigate, previewId]);

  const getIntegrationConfig = useCallback((type: string) => integrationConfig[type], []);

  const getIntegration = useCallback(
    (type: string) => connectedIntegrations.get(type) ?? null,
    [connectedIntegrations],
  );

  const getIntegrationsForType = useCallback(
    (type: string) => integrationsList.filter((integration) => integration.type === type),
    [integrationsList],
  );

  const getConnectError = useCallback(
    (type: string) => integrationConnectErrors[type as OAuthIntegrationType],
    [integrationConnectErrors],
  );

  const showGoogleRequestForType = useCallback(
    (type: string) => {
      const integration = connectedIntegrations.get(type);
      const isGoogleType = isGoogleIntegrationType(type as OAuthIntegrationType);
      return !integration && isGoogleType && lacksGoogleAccess;
    },
    [connectedIntegrations, lacksGoogleAccess],
  );

  const handlePreviewConnect = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed) {
      void handleIntegrationConnect(parsed as OAuthIntegrationType);
    }
  }, [handleIntegrationConnect, previewId]);

  const handlePreviewConnectAnother = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed) {
      void handleIntegrationConnect(parsed as OAuthIntegrationType, { mode: "connect" });
    }
  }, [handleIntegrationConnect, previewId]);

  const handlePreviewToggle = useCallback(
    (enabled: boolean) => {
      if (!previewId) {
        return;
      }
      const parsed = previewId.startsWith("integration:")
        ? previewId.slice("integration:".length)
        : null;
      if (!parsed) {
        return;
      }
      const integration = connectedIntegrations.get(parsed);
      if (integration) {
        void handleIntegrationToggle(integration.id, enabled);
      }
    },
    [connectedIntegrations, handleIntegrationToggle, previewId],
  );

  const handlePreviewDisconnect = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (!parsed) {
      return;
    }
    const integration = connectedIntegrations.get(parsed);
    if (integration) {
      void handleIntegrationDisconnect(integration.id);
    }
  }, [connectedIntegrations, handleIntegrationDisconnect, previewId]);

  const handlePreviewRequestGoogleAccess = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed && isGoogleIntegrationType(parsed as OAuthIntegrationType)) {
      void handleRequestGoogleAccess(parsed as GoogleIntegrationType);
    }
  }, [handleRequestGoogleAccess, previewId]);

  const previewIntegrationProps = useMemo(
    () => ({
      getIntegrationConfig,
      getIntegration,
      getIntegrations: getIntegrationsForType,
      getConnectError,
      showGoogleRequest: showGoogleRequestForType,
      isConnecting: !!connectingType,
      onConnect: handlePreviewConnect,
      onConnectAnother: handlePreviewConnectAnother,
      onToggle: handlePreviewToggle,
      onToggleAccount: handleIntegrationToggle,
      onDisconnect: handlePreviewDisconnect,
      onDisconnectAccount: handleIntegrationDisconnect,
      onRequestGoogleAccess: handlePreviewRequestGoogleAccess,
      onRenameAccountLabel: renameAccountLabel.mutate,
    }),
    [
      connectingType,
      getConnectError,
      getIntegration,
      getIntegrationsForType,
      getIntegrationConfig,
      handlePreviewConnect,
      handlePreviewConnectAnother,
      handlePreviewDisconnect,
      handlePreviewRequestGoogleAccess,
      handlePreviewToggle,
      handleIntegrationToggle,
      handleIntegrationDisconnect,
      renameAccountLabel.mutate,
      showGoogleRequestForType,
    ],
  );

  const previewCommunitySkillProps = useMemo(
    () => ({
      getEnabled: (slug: string) => communitySkillToggles[slug] ?? false,
      onToggle: handleCommunitySkillToggle,
    }),
    [communitySkillToggles, handleCommunitySkillToggle],
  );

  return (
    <>
      {/* Filters row */}
      <ToolboxToolbar
        activeTab={activeTab}
        tabs={tabs}
        onTabChange={handleTabChange}
        importPending={importSkill.isPending}
        isCreating={isCreating}
        supportsFolderImport={supportsFolderImport}
        search={search}
        t={t}
        onNewMcpSource={handleNewMcpSource}
        onImportZipClick={handleImportZipClick}
        onImportFolderClick={handleImportFolderClick}
        onCreateSkill={handleCreateSkill}
        onSearchChange={handleSearchChange}
        zipImportInputRef={zipImportInputRef}
        folderImportInputRef={folderImportInputRef}
        onImportZipChange={handleImportZipChange}
        onImportFolderChange={handleImportFolderChange}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : !hasResults ? (
        <motion.div
          initial={FADE_IN_MOTION.initial}
          animate={FADE_IN_MOTION.animate}
          className="py-16 text-center"
        >
          <p className="text-muted-foreground text-sm">
            {q
              ? "No tools match your search."
              : activeTab === "active"
                ? "No active tools yet."
                : activeTab === "needs_setup"
                  ? "All integrations are connected."
                  : "No tools available."}
          </p>
        </motion.div>
      ) : (
        <ToolboxResults
          filteredOwnedSkills={filteredOwnedSkills}
          filteredSharedSkills={filteredSharedSkills}
          filteredIntegrations={filteredIntegrations}
          filteredWorkspaceMcpServers={filteredWorkspaceMcpServers}
          filteredCommunitySkills={filteredCommunitySkills}
          skillHandlers={skillHandlers}
          connectedIntegrations={connectedIntegrations}
          isMobile={isMobile}
          integrationConnectErrors={integrationConnectErrors}
          communitySkillToggles={communitySkillToggles}
        />
      )}

      <ToolboxPreviewModal
        previewId={isMobile && previewId?.startsWith("integration:") ? null : previewId}
        integrationProps={previewIntegrationProps}
        communitySkillProps={previewCommunitySkillProps}
      />
    </>
  );
}
