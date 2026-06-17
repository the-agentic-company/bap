// oxlint-disable eslint/no-underscore-dangle

import { useNavigate } from "@tanstack/react-router";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  Activity,
  BarChart3,
  Clock,
  Filter,
  History,
  Mail,
  Network,
  Loader2,
  Menu,
  Play,
  Plus,
  Search,
  Share2,
  Upload,
  Webhook,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { IntegrationType } from "@/lib/integration-icons";
import { ModelSelector } from "@/components/chat/model-selector";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { InteractiveCoworkerCard } from "@/components/coworkers/interactive-coworker-card";
import { ViewTabs } from "@/components/coworkers/view-tabs";
import { startCoworkerBuilderGeneration } from "@/components/landing/start-coworker-builder-generation";
// Commented out — prompt bar removed from coworkers page
// import { VoiceIndicator } from "@/components/chat/voice-indicator";
// import { PromptBar } from "@/components/prompt-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { blobToBase64, useVoiceRecording } from "@/hooks/use-voice-recording";
import { normalizeChatModelSelection } from "@/lib/chat-model-selection";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { cn } from "@/lib/utils";
import {
  useCreateCoworker,
  type CoworkerListData,
  type CoworkerTagListData,
  useCoworkerList,
  useCoworkerViewList,
  useDeleteCoworker,
  useImportCoworkerDefinition,
  useImportSharedCoworker,
  useSharedCoworkerList,
} from "@/orpc/hooks/coworkers";
import { useIntegrationList } from "@/orpc/hooks/integrations";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { useTranscribe } from "@/orpc/hooks/voice";
import { AppImage as Image } from "../-lib/app-image";
import { AppLink as Link } from "../-lib/app-link";
import { SharedCoworkerCard, type SharedCoworkerItem } from "./shared-coworker-card";

export type CoworkerItem = CoworkerListData[number];
const EMPTY_INITIAL_COWORKERS: CoworkerListData = [];

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

const TRIGGER_TYPE_OPTIONS = [
  { value: "manual", label: msg("Manual"), icon: Play },
  { value: "schedule", label: msg("Scheduled"), icon: Clock },
  { value: "email", label: msg("Email"), icon: Mail },
  { value: "webhook", label: msg("Webhook"), icon: Webhook },
] as const;

const CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;

export default function CoworkersPage({
  initialCoworkerSharedCount = 0,
  initialCoworkerTags,
  initialCoworkerTotalCount = 0,
  initialCoworkers,
}: {
  initialCoworkerSharedCount?: number;
  initialCoworkerTags?: CoworkerTagListData;
  initialCoworkerTotalCount?: number;
  initialCoworkers?: CoworkerListData;
}) {
  const t = useGT();
  const m = useMessages();

  const navigate = useNavigate();
  const initialCoworkerList = initialCoworkers ?? EMPTY_INITIAL_COWORKERS;
  const { data: coworkers, isLoading } = useCoworkerList({ initialData: initialCoworkerList });
  const { data: sharedCoworkers } = useSharedCoworkerList();
  const { data: integrations } = useIntegrationList();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const createCoworker = useCreateCoworker();
  const deleteCoworker = useDeleteCoworker();
  const importCoworkerDefinition = useImportCoworkerDefinition();
  const importSharedCoworker = useImportSharedCoworker();
  const { isRecording, error: _voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();
  const openRecentDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COWORKERS_OPEN_RECENT_DRAWER_EVENT));
  }, []);
  const [isCreating, setIsCreating] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [_inputPrefillRequest, setInputPrefillRequest] = useState<{
    id: string;
    text: string;
    mode?: "replace" | "append";
  } | null>(null);
  const [importingSharedCoworkerId, setImportingSharedCoworkerId] = useState<string | null>(null);
  const [deletingCoworkerId, setDeletingCoworkerId] = useState<string | null>(null);
  const [coworkerPendingDelete, setCoworkerPendingDelete] = useState<CoworkerItem | null>(null);
  const [model, setModel] = useState(DEFAULT_COWORKER_BUILDER_MODEL);
  const [modelAuthSource, setModelAuthSource] = useState<ProviderAuthSource | null>("shared");
  const [filterShared, setFilterShared] = useState(false);
  const handleToggleFilterShared = useCallback(() => setFilterShared((v) => !v), []);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [selectedTriggerTypes, setSelectedTriggerTypes] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const { data: views } = useCoworkerViewList();
  const handleToggleTagFilter = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
    setActiveViewId(null);
  }, []);
  const handleToggleTriggerType = useCallback((triggerType: string) => {
    setSelectedTriggerTypes((prev) => {
      const next = new Set(prev);
      if (next.has(triggerType)) {
        next.delete(triggerType);
      } else {
        next.add(triggerType);
      }
      return next;
    });
    setActiveViewId(null);
  }, []);
  const handleTriggerTypeButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const triggerType = event.currentTarget.dataset.triggerType;
      if (triggerType) {
        handleToggleTriggerType(triggerType);
      }
    },
    [handleToggleTriggerType],
  );
  const handleClearAllFilters = useCallback(() => {
    setSelectedTagIds(new Set());
    setSelectedTriggerTypes(new Set());
    setActiveViewId(null);
  }, []);
  const handleSelectView = useCallback(
    (viewId: string | null) => {
      setActiveViewId(viewId);
      if (viewId === null) {
        setSelectedTagIds(new Set());
        setSelectedTriggerTypes(new Set());
      } else {
        const view = (views ?? []).find((v) => v.id === viewId);
        if (view) {
          const filters = view.filters as { tagIds?: string[]; triggerTypes?: string[] };
          setSelectedTagIds(new Set(filters.tagIds ?? []));
          setSelectedTriggerTypes(new Set(filters.triggerTypes ?? []));
        }
      }
    },
    [views],
  );
  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
    [],
  );
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const isRecordingRef = useRef(false);
  const coworkerList = useMemo(() => {
    const real = Array.isArray(coworkers) ? coworkers : [];
    return real.map((entry) =>
      Object.assign({}, entry, {
        toolAccessMode: entry.toolAccessMode,
        allowedIntegrations: (entry.allowedIntegrations ?? []) as IntegrationType[],
        allowedSkillSlugs: entry.allowedSkillSlugs ?? [],
      }),
    );
  }, [coworkers]);
  const visibleCoworkerCount = Math.max(initialCoworkerTotalCount, coworkerList.length);
  const connectedIntegrationTypes = useMemo(
    () =>
      (integrations ?? []).flatMap((entry) =>
        entry.enabled &&
        entry.setupRequired !== true &&
        COWORKER_AVAILABLE_INTEGRATION_TYPES.includes(entry.type as IntegrationType)
          ? ([entry.type as IntegrationType] as const)
          : [],
      ),
    [integrations],
  );
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );
  const sharedCoworkerList = useMemo(
    () =>
      (sharedCoworkers ?? []).filter(
        (entry) => !entry.isOwnedByCurrentUser,
      ) as SharedCoworkerItem[],
    [sharedCoworkers],
  );
  const sharedByMeCount = useMemo(
    () =>
      Math.max(initialCoworkerSharedCount, coworkerList.filter((c) => c.sharedAt != null).length),
    [coworkerList, initialCoworkerSharedCount],
  );
  const currentFilters = useMemo(
    () => ({
      tagIds: selectedTagIds.size > 0 ? [...selectedTagIds] : undefined,
      triggerTypes: selectedTriggerTypes.size > 0 ? [...selectedTriggerTypes] : undefined,
    }),
    [selectedTagIds, selectedTriggerTypes],
  );
  const hasActiveFilters = selectedTagIds.size > 0 || selectedTriggerTypes.size > 0;
  const displayedCoworkerList = useMemo(() => {
    let list = filterShared ? coworkerList.filter((c) => c.sharedAt != null) : coworkerList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      );
    }
    if (selectedTagIds.size > 0) {
      list = list.filter((c) => (c.tags ?? []).some((tag) => selectedTagIds.has(tag.id)));
    }
    if (selectedTriggerTypes.size > 0) {
      list = list.filter((c) => selectedTriggerTypes.has(c.triggerType));
    }
    return list;
  }, [coworkerList, filterShared, searchQuery, selectedTagIds, selectedTriggerTypes]);
  const displayedSharedCoworkerList = useMemo(() => {
    if (!searchQuery.trim()) {
      return sharedCoworkerList;
    }
    const q = searchQuery.toLowerCase();
    return sharedCoworkerList.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
    );
  }, [sharedCoworkerList, searchQuery]);

  const handleImportSharedCoworker = useCallback(
    async (sourceCoworkerId: string) => {
      setImportingSharedCoworkerId(sourceCoworkerId);
      try {
        const created = await importSharedCoworker.mutateAsync(sourceCoworkerId);
        toast.success(t("Coworker imported."));
        void navigate({ to: "/agents/edit/$id", params: { id: created.id } });
      } catch (error) {
        console.error("Failed to import coworker:", error);
        toast.error(t("Failed to import coworker."));
      } finally {
        setImportingSharedCoworkerId(null);
      }
    },
    [importSharedCoworker, navigate, t],
  );
  const handleImportCoworkerClick = useCallback(() => {
    if (importCoworkerDefinition.isPending) {
      return;
    }
    importFileInputRef.current?.click();
  }, [importCoworkerDefinition.isPending]);
  const handleImportCoworkerFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".json")) {
        toast.error(t("Select a .json coworker export."));
        return;
      }

      try {
        const definitionJson = await file.text();
        const created = await importCoworkerDefinition.mutateAsync(definitionJson);
        toast.success(t("Coworker imported in the off state."));
        void navigate({ to: "/agents/edit/$id", params: { id: created.id } });
      } catch (error) {
        console.error("Failed to import coworker definition:", error);
        toast.error(t("Failed to import coworker."));
      }
    },
    [importCoworkerDefinition, navigate, t],
  );
  const handleDeleteDialogChange = useCallback(
    (open: boolean) => {
      if (!open && deletingCoworkerId === null) {
        setCoworkerPendingDelete(null);
      }
    },
    [deletingCoworkerId],
  );
  const handleConfirmDelete = useCallback(async () => {
    if (!coworkerPendingDelete) {
      return;
    }
    setDeletingCoworkerId(coworkerPendingDelete.id);
    try {
      await deleteCoworker.mutateAsync(coworkerPendingDelete.id);
      toast.success(t("Coworker deleted."));
      setCoworkerPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete coworker:", error);
      toast.error(t("Failed to delete coworker."));
    } finally {
      setDeletingCoworkerId(null);
    }
  }, [coworkerPendingDelete, deleteCoworker, t]);

  const _stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        setInputPrefillRequest({
          id: `coworker-voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (error) {
      console.error("Coworker transcription error:", error);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe]);

  const _handleStartRecording = useCallback(() => {
    if (isCreating || isProcessingVoice || isRecordingRef.current) {
      return;
    }

    isRecordingRef.current = true;
    void startRecording();
  }, [isCreating, isProcessingVoice, startRecording]);
  const handleModelChange = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      const normalized = normalizeChatModelSelection(input);
      if (!normalized.model) {
        return;
      }

      setModel(normalized.model);
      setModelAuthSource(normalized.authSource);
    },
    [],
  );
  const _modelSelectorNode = useMemo(
    () => (
      <ModelSelector
        selectedModel={model}
        selectedAuthSource={modelAuthSource}
        providerAvailability={providerAvailability}
        onSelectionChange={handleModelChange}
        disabled={isCreating || isRecording || isProcessingVoice}
      />
    ),
    [
      handleModelChange,
      isCreating,
      isProcessingVoice,
      isRecording,
      model,
      modelAuthSource,
      providerAvailability,
    ],
  );

  const doCreate = useCallback(
    async ({
      initialMessage,
      name,
      prompt: coworkerPrompt,
      triggerType,
    }: {
      initialMessage?: string;
      name?: string;
      prompt: string;
      triggerType: "manual" | "schedule" | "email" | "webhook";
    }) => {
      const result = await createCoworker.mutateAsync({
        name,
        triggerType,
        prompt: coworkerPrompt,
        model,
        authSource: modelAuthSource,
        toolAccessMode: "all",
        allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
      });

      const text = initialMessage?.trim() ?? "";
      if (text) {
        await startCoworkerBuilderGeneration({
          coworkerId: result.id,
          content: text,
          model,
          authSource: modelAuthSource,
        });
      }

      void navigate({ to: "/agents/edit/$id", params: { id: result.id } });
    },
    [createCoworker, model, modelAuthSource, navigate],
  );

  const _handlePromptSubmit = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText || isCreating || isProcessingVoice) {
        return;
      }

      setIsCreating(true);
      try {
        await doCreate({
          initialMessage: trimmedText,
          name: "",
          prompt: "",
          triggerType: "manual",
        });
      } catch (error) {
        toast.error(normalizeGenerationError(error, "start_rpc").message);
        setIsCreating(false);
      }
    },
    [doCreate, isCreating, isProcessingVoice],
  );

  return (
    <div className="space-y-10">
      {/* Prompt bar — commented out, kept for future reference
      <div className="px-4 pt-[12vh] pb-8">
        <div className="mx-auto max-w-xl">
          <h1 className="text-foreground mb-2 text-center text-xl font-semibold tracking-tight">
            What do you want to automate?
          </h1>
          <p className="text-muted-foreground mb-6 text-center text-sm">
            Describe a task and we&apos;ll build it step by step
          </p>
          <PromptBar
            onSubmit={_handlePromptSubmit}
            isSubmitting={isCreating}
            disabled={isCreating || isRecording || isProcessingVoice}
            placeholder="e.g. Every morning, summarize my unread emails and send me a digest…"
            isRecording={isRecording}
            onStartRecording={_handleStartRecording}
            onStopRecording={_stopRecordingAndTranscribe}
            voiceInteractionMode="toggle"
            prefillRequest={inputPrefillRequest}
            renderModelSelector={_modelSelectorNode}
          />
          {(isRecording || isProcessingVoice || voiceError) && (
            <div className="mt-4">
              <VoiceIndicator
                isRecording={isRecording}
                isProcessing={isProcessingVoice}
                error={voiceError}
                recordingLabel="Recording... Click the mic again to stop"
              />
            </div>
          )}
        </div>
      </div>
      */}

      {coworkerList.length === 0 && !searchQuery.trim() && !isLoading ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
          <Image src="/tools/lobster.svg" alt="" width={64} height={64} className="mb-6" />
          <h2 className="text-foreground mb-1.5 text-center text-xl font-semibold tracking-tight">
            <T>Build your first coworker</T>
          </h2>
          <p className="text-muted-foreground mb-8 max-w-sm text-center text-sm">
            <T>Put repetitive tasks on autopilot.</T>
          </p>
          <Link
            href="/"
            className="bg-foreground text-background hover:bg-foreground/90 inline-flex h-10 items-center justify-center rounded-lg px-6 text-sm font-medium transition-colors"
          >
            <T>Start building</T>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openRecentDrawer}
                className="text-muted-foreground hover:text-foreground -ml-1 flex h-8 w-8 items-center justify-center rounded-md md:hidden"
                aria-label={t("Recent runs")}
              >
                <Menu className="h-5 w-5" />
              </button>
              <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <T>My coworkers</T>
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
                  {visibleCoworkerCount}
                </span>
              </h2>
              <Link
                href="/agents/overview"
                className="text-muted-foreground hover:text-foreground ml-1 flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
              >
                <Activity className="size-3.5" />
                <span className="hidden sm:inline">
                  <T>Overview</T>
                </span>
              </Link>
              <Link
                href="/agents/history"
                className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
              >
                <History className="size-3.5" />
                <span className="hidden sm:inline">
                  <T>History</T>
                </span>
              </Link>
              <Link
                href="/agents/usage"
                className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
              >
                <BarChart3 className="size-3.5" />
                <span className="hidden sm:inline">
                  <T>Usage</T>
                </span>
              </Link>
              <Link
                href="/agents/org-chart"
                className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
              >
                <Network className="size-3.5" />
                <span className="hidden sm:inline">
                  <T>Org Chart</T>
                </span>
              </Link>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative w-full sm:w-64">
                <Search className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder={t("Search coworkers...")}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "border-border/60 hover:border-border inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                      selectedTriggerTypes.size > 0
                        ? "border-foreground/20 bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Filter className="size-3" />
                    {selectedTriggerTypes.size > 0 ? (
                      <span className="bg-background/20 rounded px-1 text-[10px] tabular-nums">
                        {selectedTriggerTypes.size}
                      </span>
                    ) : (
                      <span className="hidden sm:inline">
                        <T>Trigger</T>
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1.5">
                  <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
                    <T>Trigger</T>
                  </p>
                  {TRIGGER_TYPE_OPTIONS.map((trigger) => {
                    const isActive = selectedTriggerTypes.has(trigger.value);
                    const Icon = trigger.icon;
                    return (
                      <button
                        key={trigger.value}
                        type="button"
                        data-trigger-type={trigger.value}
                        onClick={handleTriggerTypeButtonClick}
                        className="hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors"
                      >
                        <div
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                            isActive
                              ? "border-brand bg-brand text-primary-foreground"
                              : "border-input bg-transparent",
                          )}
                        >
                          {isActive && <X className="size-2.5" />}
                        </div>
                        <Icon className="text-muted-foreground size-3" />
                        <span className="text-foreground">{m(trigger.label)}</span>
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sharedByMeCount > 0 ? (
              <button
                type="button"
                onClick={handleToggleFilterShared}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filterShared
                    ? "border-foreground/20 bg-foreground text-background"
                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Share2 className="size-3" />
                <T>Shared with workspace</T>
                <span
                  className={cn(
                    "tabular-nums rounded-full px-1.5 text-[10px]",
                    filterShared ? "bg-background/20" : "bg-muted",
                  )}
                >
                  {sharedByMeCount}
                </span>
              </button>
            ) : null}
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label={t("Import coworker JSON file")}
              onChange={handleImportCoworkerFileChange}
            />
            <button
              type="button"
              onClick={handleImportCoworkerClick}
              disabled={importCoworkerDefinition.isPending}
              className="border-border/60 text-muted-foreground hover:border-border hover:text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {importCoworkerDefinition.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              <T>Import coworker</T>
            </button>
          </div>

          {/* View tabs with integrated tag filters */}
          <ViewTabs
            activeViewId={activeViewId}
            onSelectView={handleSelectView}
            currentFilters={currentFilters}
            hasActiveFilters={hasActiveFilters}
            initialTags={initialCoworkerTags}
            selectedTagIds={selectedTagIds}
            onToggleTag={handleToggleTagFilter}
            onClearAll={handleClearAllFilters}
          />

          {displayedCoworkerList.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed p-10 text-center">
              <p className="text-muted-foreground text-sm">
                <T>No coworkers match &ldquo;</T>
                {searchQuery}
                <T>&rdquo;</T>
              </p>
            </div>
          ) : (
            <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key="create-new"
                  layout
                  className="h-full"
                  initial={CARD_MOTION.initial}
                  animate={CARD_MOTION.animate}
                  exit={CARD_MOTION.exit}
                  transition={CARD_MOTION.transition}
                >
                  <Link
                    href="/"
                    className="border-foreground/20 hover:border-foreground/30 hover:bg-muted/30 group flex h-full min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed transition-all duration-150"
                  >
                    <div className="bg-muted/50 group-hover:bg-muted flex size-10 items-center justify-center rounded-xl transition-colors">
                      <Plus className="text-muted-foreground size-5" />
                    </div>
                    <span className="text-muted-foreground text-sm font-medium">
                      <T>Create new coworker</T>
                    </span>
                  </Link>
                </motion.div>
                {displayedCoworkerList.map((wf) => (
                  <motion.div
                    key={wf.id}
                    layout
                    className="h-full"
                    initial={CARD_MOTION.initial}
                    animate={CARD_MOTION.animate}
                    exit={CARD_MOTION.exit}
                    transition={CARD_MOTION.transition}
                  >
                    <InteractiveCoworkerCard coworker={wf} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      )}
      {displayedSharedCoworkerList.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">
              <T>Shared by teammates</T>
            </h2>
            <p className="text-muted-foreground text-sm">
              <T>Install a coworker into your own workspace environment.</T>
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {displayedSharedCoworkerList.map((coworker) => (
                <motion.div
                  key={coworker.id}
                  layout
                  className="h-full"
                  initial={CARD_MOTION.initial}
                  animate={CARD_MOTION.animate}
                  exit={CARD_MOTION.exit}
                  transition={CARD_MOTION.transition}
                >
                  <SharedCoworkerCard
                    coworker={coworker}
                    connectedIntegrationTypes={connectedIntegrationTypes}
                    isImporting={importingSharedCoworkerId === coworker.id}
                    onImport={handleImportSharedCoworker}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      ) : null}
      <AlertDialog open={coworkerPendingDelete !== null} onOpenChange={handleDeleteDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Delete coworker?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {coworkerPendingDelete
                ? `Delete ${getCoworkerDisplayName(coworkerPendingDelete.name)} and its run history? This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCoworkerId !== null}>
              <T>Cancel</T>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deletingCoworkerId !== null}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deletingCoworkerId !== null ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Delete</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
