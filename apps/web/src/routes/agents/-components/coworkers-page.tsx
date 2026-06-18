// oxlint-disable eslint/no-underscore-dangle

import { useNavigate } from "@tanstack/react-router";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  ChevronRight,
  ChevronDown,
  Clock,
  Filter,
  Folder,
  Mail,
  Network,
  Loader2,
  Menu,
  Play,
  Search,
  Share2,
  Upload,
  UserPlus,
  Webhook,
  X,
} from "lucide-react";
import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { IntegrationType } from "@/lib/integration-icons";
import { ModelSelector } from "@/components/chat/model-selector";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { startCoworkerBuilderGeneration } from "@/components/landing/start-coworker-builder-generation";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useCreateCoworkerFolder,
  type CoworkerListData,
  type CoworkerFolderListData,
  useCoworkerFolderList,
  useCoworkerList,
  useDeleteCoworkerFolder,
  useDeleteCoworker,
  useImportCoworkerDefinition,
  useImportSharedCoworker,
  useMoveCoworkerFolder,
  useMoveCoworkerToFolder,
  useSharedCoworkerList,
  useUpdateCoworkerFolderVisibility,
} from "@/orpc/hooks/coworkers";
import { useIntegrationList } from "@/orpc/hooks/integrations";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { useCurrentUser } from "@/orpc/hooks/user";
import { useTranscribe } from "@/orpc/hooks/voice";
import { AppImage as Image } from "../-lib/app-image";
import { AppLink as Link } from "../-lib/app-link";
import { CoworkerBrowserGrid } from "./coworker-browser-grid";
import { CoworkerFolderDialogs } from "./coworker-folder-dialogs";
import type { SharedCoworkerItem } from "./shared-coworker-card";

export type CoworkerItem = CoworkerListData[number];
export type CoworkerFolderItem = CoworkerFolderListData[number];
type DraggedCoworker = { id: string; name?: string | null; folderId?: string | null };
type DraggedFolder = CoworkerFolderItem;
export type MoveTarget =
  | { type: "coworker"; id: string; name: string; currentFolderId: string | null }
  | { type: "folder"; id: string; name: string; currentFolderId: string | null };
const EMPTY_INITIAL_COWORKERS: CoworkerListData = [];

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

const TRIGGER_TYPE_OPTIONS = [
  { value: "manual", label: msg("Manual"), icon: Play },
  { value: "schedule", label: msg("Scheduled"), icon: Clock },
  { value: "email", label: msg("Email"), icon: Mail },
  { value: "webhook", label: msg("Webhook"), icon: Webhook },
] as const;

export default function CoworkersPage({
  currentFolderId = null,
  initialCoworkerSharedCount = 0,
  initialCoworkerTotalCount = 0,
  initialCoworkers,
}: {
  currentFolderId?: string | null;
  initialCoworkerSharedCount?: number;
  initialCoworkerTotalCount?: number;
  initialCoworkers?: CoworkerListData;
}) {
  const t = useGT();
  const m = useMessages();

  const navigate = useNavigate();
  const initialCoworkerList = initialCoworkers ?? EMPTY_INITIAL_COWORKERS;
  const { data: coworkers, isLoading } = useCoworkerList({ initialData: initialCoworkerList });
  const { data: folders } = useCoworkerFolderList();
  const { data: sharedCoworkers } = useSharedCoworkerList();
  const { data: integrations } = useIntegrationList();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: currentUser } = useCurrentUser();
  const createCoworker = useCreateCoworker();
  const createFolder = useCreateCoworkerFolder();
  const deleteFolder = useDeleteCoworkerFolder();
  const deleteCoworker = useDeleteCoworker();
  const importCoworkerDefinition = useImportCoworkerDefinition();
  const importSharedCoworker = useImportSharedCoworker();
  const moveCoworkerToFolder = useMoveCoworkerToFolder();
  const moveFolder = useMoveCoworkerFolder();
  const updateFolderVisibility = useUpdateCoworkerFolderVisibility();
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
  const [selectedTriggerTypes, setSelectedTriggerTypes] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(currentFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderVisibility, setNewFolderVisibility] = useState<"private" | "workspace">(
    "private",
  );
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [moveDestinationId, setMoveDestinationId] = useState<string>("top");
  const [folderPendingDelete, setFolderPendingDelete] = useState<CoworkerFolderItem | null>(null);
  const [folderPendingVisibilityChange, setFolderPendingVisibilityChange] =
    useState<CoworkerFolderItem | null>(null);
  const [draggedCoworker, setDraggedCoworker] = useState<DraggedCoworker | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<DraggedFolder | null>(null);
  const [activeDropFolderId, setActiveDropFolderId] = useState<string | null>(null);
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
    setSelectedTriggerTypes(new Set());
  }, []);
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
  const folderList = useMemo(() => (Array.isArray(folders) ? folders : []), [folders]);
  const folderById = useMemo(
    () => new Map(folderList.map((folder) => [folder.id, folder])),
    [folderList],
  );
  const getFolderRoot = useCallback(
    (folderId: string | null | undefined) => {
      if (!folderId) {
        return null;
      }
      let cursor = folderById.get(folderId) ?? null;
      const seen = new Set<string>();
      while (cursor?.parentId && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        cursor = folderById.get(cursor.parentId) ?? null;
      }
      return cursor;
    },
    [folderById],
  );
  const getFolderEffectiveVisibility = useCallback(
    (folderId: string | null | undefined) => getFolderRoot(folderId)?.visibility ?? null,
    [getFolderRoot],
  );
  const canManageFolder = useCallback(
    (folder: CoworkerFolderItem) => Boolean(currentUser?.id && folder.ownerId === currentUser.id),
    [currentUser?.id],
  );
  const currentFolder = currentFolderId ? (folderById.get(currentFolderId) ?? null) : null;
  const currentParentId = currentFolderId ?? null;
  const createFolderParent = createFolderParentId
    ? (folderById.get(createFolderParentId) ?? null)
    : null;
  const breadcrumbs = useMemo(() => {
    if (!currentFolder) {
      return [];
    }
    const trail: CoworkerFolderItem[] = [];
    const seen = new Set<string>();
    let cursor: CoworkerFolderItem | null = currentFolder;
    while (cursor && !seen.has(cursor.id)) {
      trail.unshift(cursor);
      seen.add(cursor.id);
      cursor = cursor.parentId ? (folderById.get(cursor.parentId) ?? null) : null;
    }
    return trail;
  }, [currentFolder, folderById]);
  const getFolderPathLabel = useCallback(
    (folder: CoworkerFolderItem) => {
      const names: string[] = [];
      const seen = new Set<string>();
      let cursor: CoworkerFolderItem | null = folder;
      while (cursor && !seen.has(cursor.id)) {
        names.unshift(cursor.name);
        seen.add(cursor.id);
        cursor = cursor.parentId ? (folderById.get(cursor.parentId) ?? null) : null;
      }
      return names.length > 1 ? names.join(" / ") : undefined;
    },
    [folderById],
  );
  const isFolderMoveDestinationDisabled = useCallback(
    (folder: CoworkerFolderItem) => {
      if (moveTarget?.type !== "folder") {
        return false;
      }
      if (folder.id === moveTarget.id) {
        return true;
      }
      let cursor: CoworkerFolderItem | null = folder;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        if (cursor.parentId === moveTarget.id) {
          return true;
        }
        seen.add(cursor.id);
        cursor = cursor.parentId ? (folderById.get(cursor.parentId) ?? null) : null;
      }
      return false;
    },
    [folderById, moveTarget],
  );
  const isFolderDescendant = useCallback(
    (folder: CoworkerFolderItem, ancestorId: string) => {
      let cursor: CoworkerFolderItem | null = folder;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        if (cursor.parentId === ancestorId) {
          return true;
        }
        seen.add(cursor.id);
        cursor = cursor.parentId ? (folderById.get(cursor.parentId) ?? null) : null;
      }
      return false;
    },
    [folderById],
  );
  const canDropFolderIntoFolder = useCallback(
    (source: CoworkerFolderItem, destination: CoworkerFolderItem) =>
      source.id !== destination.id &&
      source.parentId !== destination.id &&
      !isFolderDescendant(destination, source.id),
    [isFolderDescendant],
  );
  const isGlobalSearch = searchQuery.trim().length > 0;
  const displayedFolderList = useMemo(() => {
    if (isGlobalSearch) {
      const q = searchQuery.trim().toLowerCase();
      return folderList.filter((folder) => folder.name.toLowerCase().includes(q));
    }
    return folderList.filter((folder) => folder.parentId === currentParentId);
  }, [currentParentId, folderList, isGlobalSearch, searchQuery]);
  const hasActiveFilters = selectedTriggerTypes.size > 0;
  const displayedCoworkerList = useMemo(() => {
    let list = filterShared ? coworkerList.filter((c) => c.sharedAt != null) : coworkerList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      );
    } else {
      list = list.filter((c) => c.folderId === currentParentId);
    }
    if (selectedTriggerTypes.size > 0) {
      list = list.filter((c) => selectedTriggerTypes.has(c.triggerType));
    }
    return list;
  }, [coworkerList, currentParentId, filterShared, searchQuery, selectedTriggerTypes]);
  const displayedSharedCoworkerList = useMemo(() => {
    let list = sharedCoworkerList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      );
    } else {
      list = list.filter((c) => (c.folderId ?? null) === currentParentId);
    }
    if (selectedTriggerTypes.size > 0) {
      list = list.filter((c) => selectedTriggerTypes.has(c.triggerType));
    }
    return list;
  }, [currentParentId, searchQuery, selectedTriggerTypes, sharedCoworkerList]);
  const moveVisibilityMessage = useMemo(() => {
    if (!moveTarget) {
      return null;
    }
    const destinationFolderId = moveDestinationId === "top" ? null : moveDestinationId;
    if (moveTarget.type === "coworker") {
      const destinationVisibility = getFolderEffectiveVisibility(destinationFolderId);
      if (!destinationVisibility) {
        return null;
      }
      return destinationVisibility === "workspace"
        ? t("Moving into this folder will share the coworker with the workspace.")
        : t("Moving into this folder will make the coworker private.");
    }
    const currentVisibility = getFolderEffectiveVisibility(moveTarget.id);
    const destinationVisibility = getFolderEffectiveVisibility(destinationFolderId);
    if (
      !currentVisibility ||
      !destinationVisibility ||
      currentVisibility === destinationVisibility
    ) {
      return null;
    }
    return destinationVisibility === "workspace"
      ? t("Moving this folder will share all contained coworkers with the workspace.")
      : t("Moving this folder will make all contained coworkers private.");
  }, [getFolderEffectiveVisibility, moveDestinationId, moveTarget, t]);

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
  const handleCreateFolderDialogChange = useCallback(
    (open: boolean) => {
      setIsCreatingFolder(open);
      if (!open) {
        setCreateFolderParentId(currentFolderId);
        setNewFolderName("");
        setNewFolderVisibility("private");
      }
    },
    [currentFolderId],
  );
  const handleOpenCreateFolderDialog = useCallback(() => {
    setCreateFolderParentId(currentFolderId);
    handleCreateFolderDialogChange(true);
  }, [currentFolderId, handleCreateFolderDialogChange]);
  const handleOpenCreateChildFolderDialog = useCallback(
    (folder: CoworkerFolderItem) => {
      setCreateFolderParentId(folder.id);
      handleCreateFolderDialogChange(true);
    },
    [handleCreateFolderDialogChange],
  );
  const handleNewFolderNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setNewFolderName(event.target.value);
  }, []);
  const handleNewFolderVisibilityClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const visibility = event.currentTarget.dataset.visibility;
      if (visibility === "private" || visibility === "workspace") {
        setNewFolderVisibility(visibility);
      }
    },
    [],
  );
  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      return;
    }
    try {
      await createFolder.mutateAsync({
        name,
        parentId: createFolderParentId,
        visibility: createFolderParentId ? undefined : newFolderVisibility,
      });
      toast.success(t("Folder created."));
      handleCreateFolderDialogChange(false);
    } catch {
      toast.error(t("Failed to create folder."));
    }
  }, [
    createFolder,
    createFolderParentId,
    handleCreateFolderDialogChange,
    newFolderName,
    newFolderVisibility,
    t,
  ]);
  const handleMoveCoworker = useCallback(
    (coworker: { id: string; name?: string | null; folderId?: string | null }) => {
      setMoveTarget({
        type: "coworker",
        id: coworker.id,
        name: getCoworkerDisplayName(coworker.name),
        currentFolderId: coworker.folderId ?? null,
      });
      setMoveDestinationId(coworker.folderId ?? "top");
    },
    [],
  );
  const handleCoworkerDragStart = useCallback(
    (coworker: DraggedCoworker, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedCoworker(coworker);
      setDraggedFolder(null);
      setActiveDropFolderId(null);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-bap-coworker-id", coworker.id);
      event.dataTransfer.setData("text/plain", coworker.id);
    },
    [],
  );
  const handleCoworkerDragEnd = useCallback(() => {
    setDraggedCoworker(null);
    setActiveDropFolderId(null);
  }, []);
  const handleFolderCardDragStart = useCallback(
    (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedFolder(folder);
      setDraggedCoworker(null);
      setActiveDropFolderId(null);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-bap-folder-id", folder.id);
      event.dataTransfer.setData("text/plain", folder.id);
    },
    [],
  );
  const handleFolderCardDragEnd = useCallback(() => {
    setDraggedFolder(null);
    setActiveDropFolderId(null);
  }, []);
  const handleFolderDragEnter = useCallback(
    (folder: CoworkerFolderItem) => {
      if (draggedCoworker && draggedCoworker.folderId !== folder.id) {
        setActiveDropFolderId(folder.id);
        return;
      }
      if (draggedFolder && canDropFolderIntoFolder(draggedFolder, folder)) {
        setActiveDropFolderId(folder.id);
        return;
      }
    },
    [canDropFolderIntoFolder, draggedCoworker, draggedFolder],
  );
  const handleFolderDragLeave = useCallback((folder: CoworkerFolderItem) => {
    setActiveDropFolderId((current) => (current === folder.id ? null : current));
  }, []);
  const handleFolderDragOver = useCallback(
    (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => {
      const canDropCoworker = Boolean(draggedCoworker && draggedCoworker.folderId !== folder.id);
      const canDropFolder = Boolean(
        draggedFolder && canDropFolderIntoFolder(draggedFolder, folder),
      );
      if (!canDropCoworker && !canDropFolder) {
        event.dataTransfer.dropEffect = "none";
        return;
      }
      setActiveDropFolderId(folder.id);
    },
    [canDropFolderIntoFolder, draggedCoworker, draggedFolder],
  );
  const handleFolderDropCoworker = useCallback(
    async (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => {
      if (draggedFolder) {
        if (!canDropFolderIntoFolder(draggedFolder, folder)) {
          setDraggedFolder(null);
          setActiveDropFolderId(null);
          return;
        }
        const currentVisibility = getFolderEffectiveVisibility(draggedFolder.id);
        const destinationVisibility = getFolderEffectiveVisibility(folder.id);
        setDraggedFolder(null);
        setActiveDropFolderId(null);
        if (
          currentVisibility &&
          destinationVisibility &&
          currentVisibility !== destinationVisibility
        ) {
          setMoveTarget({
            type: "folder",
            id: draggedFolder.id,
            name: draggedFolder.name,
            currentFolderId: draggedFolder.parentId,
          });
          setMoveDestinationId(folder.id);
          return;
        }
        try {
          await moveFolder.mutateAsync({ folderId: draggedFolder.id, parentId: folder.id });
          toast.success(t("Folder moved."));
        } catch {
          toast.error(t("Failed to move folder."));
        }
        return;
      }
      const coworkerId =
        draggedCoworker?.id || event.dataTransfer.getData("application/x-bap-coworker-id");
      if (!coworkerId || draggedCoworker?.folderId === folder.id) {
        setDraggedCoworker(null);
        setActiveDropFolderId(null);
        return;
      }
      try {
        await moveCoworkerToFolder.mutateAsync({ coworkerId, folderId: folder.id });
        toast.success(t("Coworker moved."));
      } catch {
        toast.error(t("Failed to move coworker."));
      } finally {
        setDraggedCoworker(null);
        setActiveDropFolderId(null);
      }
    },
    [
      canDropFolderIntoFolder,
      draggedCoworker,
      draggedFolder,
      getFolderEffectiveVisibility,
      moveCoworkerToFolder,
      moveFolder,
      t,
    ],
  );
  const handleMoveFolder = useCallback((folder: CoworkerFolderItem) => {
    setMoveTarget({
      type: "folder",
      id: folder.id,
      name: folder.name,
      currentFolderId: folder.parentId,
    });
    setMoveDestinationId(folder.parentId ?? "top");
  }, []);
  const handleDeleteFolderRequest = useCallback((folder: CoworkerFolderItem) => {
    setFolderPendingDelete(folder);
  }, []);
  const handleToggleFolderVisibilityRequest = useCallback((folder: CoworkerFolderItem) => {
    setFolderPendingVisibilityChange(folder);
  }, []);
  const handleMoveDestinationChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setMoveDestinationId(event.target.value);
  }, []);
  const handleMoveDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setMoveTarget(null);
      setMoveDestinationId("top");
    }
  }, []);
  const handleConfirmMove = useCallback(async () => {
    if (!moveTarget) {
      return;
    }
    const folderId = moveDestinationId === "top" ? null : moveDestinationId;
    try {
      if (moveTarget.type === "coworker") {
        await moveCoworkerToFolder.mutateAsync({ coworkerId: moveTarget.id, folderId });
        toast.success(t("Coworker moved."));
      } else {
        await moveFolder.mutateAsync({ folderId: moveTarget.id, parentId: folderId });
        toast.success(t("Folder moved."));
      }
      handleMoveDialogChange(false);
    } catch {
      toast.error(t("Failed to move."));
    }
  }, [handleMoveDialogChange, moveCoworkerToFolder, moveDestinationId, moveFolder, moveTarget, t]);
  const handleConfirmDeleteFolder = useCallback(async () => {
    if (!folderPendingDelete) {
      return;
    }
    try {
      await deleteFolder.mutateAsync(folderPendingDelete.id);
      toast.success(t("Folder deleted."));
      setFolderPendingDelete(null);
    } catch {
      toast.error(t("Failed to delete folder."));
    }
  }, [deleteFolder, folderPendingDelete, t]);
  const handleFolderDeleteDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setFolderPendingDelete(null);
    }
  }, []);
  const handleVisibilityDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setFolderPendingVisibilityChange(null);
    }
  }, []);
  const handleConfirmFolderVisibilityChange = useCallback(async () => {
    if (!folderPendingVisibilityChange) {
      return;
    }
    const visibility =
      folderPendingVisibilityChange.visibility === "workspace" ? "private" : "workspace";
    try {
      await updateFolderVisibility.mutateAsync({
        id: folderPendingVisibilityChange.id,
        visibility,
      });
      toast.success(
        visibility === "workspace" ? t("Folder shared with workspace.") : t("Folder made private."),
      );
      setFolderPendingVisibilityChange(null);
    } catch {
      toast.error(t("Failed to update folder visibility."));
    }
  }, [folderPendingVisibilityChange, t, updateFolderVisibility]);
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
        folderId: currentFolderId,
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
    [createCoworker, currentFolderId, model, modelAuthSource, navigate],
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
      {coworkerList.length === 0 &&
      folderList.length === 0 &&
      !currentFolderId &&
      !searchQuery.trim() &&
      !isLoading ? (
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
                href="/agents/org-chart"
                className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
              >
                <Network className="size-3.5" />
                <span className="hidden sm:inline">
                  <T>Org Chart</T>
                </span>
              </Link>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors"
                >
                  <T>Create</T>
                  <ChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem asChild>
                  <Link href="/" className="flex items-center gap-2">
                    <UserPlus className="size-4" />
                    <T>Create coworker</T>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleOpenCreateFolderDialog}>
                  <Folder className="size-4" />
                  <T>Create folder</T>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={t("Search folders and coworkers...")}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "border-border/60 hover:border-border inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
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
              {sharedByMeCount > 0 ? (
                <button
                  type="button"
                  onClick={handleToggleFilterShared}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
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
                className="border-border/60 text-muted-foreground hover:border-border hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                {importCoworkerDefinition.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Upload className="size-3" />
                )}
                <T>Import coworker</T>
              </button>
            </div>
          </div>

          {currentFolderId || hasActiveFilters ? (
            <div className="flex items-center gap-1 overflow-x-auto text-xs">
              {currentFolderId ? (
                <Link
                  href="/agents"
                  className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1 font-medium whitespace-nowrap"
                >
                  <T>All coworkers</T>
                </Link>
              ) : null}
              {breadcrumbs.map((folder) => (
                <div key={folder.id} className="flex items-center gap-1">
                  <ChevronRight className="text-muted-foreground/60 size-3" />
                  <Link
                    href={`/agents/folders/${encodeURIComponent(folder.id)}`}
                    className={cn(
                      "text-muted-foreground hover:text-foreground rounded-md px-2 py-1 font-medium whitespace-nowrap",
                      folder.id === currentFolderId && "bg-muted text-foreground",
                    )}
                  >
                    {folder.name}
                  </Link>
                </div>
              ))}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="text-muted-foreground hover:text-foreground ml-2 rounded-md px-2 py-1 text-xs font-medium"
                >
                  <T>Clear filters</T>
                </button>
              ) : null}
            </div>
          ) : null}

          {displayedCoworkerList.length === 0 &&
          displayedFolderList.length === 0 &&
          displayedSharedCoworkerList.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed p-10 text-center">
              <p className="text-muted-foreground text-sm">
                {searchQuery.trim() ? (
                  <>
                    <T>No folders or coworkers match &ldquo;</T>
                    {searchQuery}
                    <T>&rdquo;</T>
                  </>
                ) : (
                  <T>This folder is empty.</T>
                )}
              </p>
            </div>
          ) : (
            <CoworkerBrowserGrid
              connectedIntegrationTypes={connectedIntegrationTypes}
              displayedCoworkerList={displayedCoworkerList}
              displayedFolderList={displayedFolderList}
              displayedSharedCoworkerList={displayedSharedCoworkerList}
              activeDropFolderId={activeDropFolderId}
              canManageFolder={canManageFolder}
              getFolderPathLabel={getFolderPathLabel}
              handleDeleteFolderRequest={handleDeleteFolderRequest}
              handleImportSharedCoworker={handleImportSharedCoworker}
              handleMoveCoworker={handleMoveCoworker}
              handleMoveFolder={handleMoveFolder}
              handleOpenCreateChildFolderDialog={handleOpenCreateChildFolderDialog}
              handleCoworkerDragEnd={handleCoworkerDragEnd}
              handleCoworkerDragStart={handleCoworkerDragStart}
              handleFolderCardDragEnd={handleFolderCardDragEnd}
              handleFolderCardDragStart={handleFolderCardDragStart}
              handleFolderDragEnter={handleFolderDragEnter}
              handleFolderDragLeave={handleFolderDragLeave}
              handleFolderDragOver={handleFolderDragOver}
              handleFolderDropCoworker={handleFolderDropCoworker}
              handleToggleFolderVisibilityRequest={handleToggleFolderVisibilityRequest}
              importingSharedCoworkerId={importingSharedCoworkerId}
              isGlobalSearch={isGlobalSearch}
            />
          )}
        </div>
      )}
      <CoworkerFolderDialogs
        isCreatingFolder={isCreatingFolder}
        onCreateFolderDialogChange={handleCreateFolderDialogChange}
        createFolderParent={createFolderParent}
        newFolderName={newFolderName}
        onNewFolderNameChange={handleNewFolderNameChange}
        t={t}
        createFolderParentId={createFolderParentId}
        newFolderVisibility={newFolderVisibility}
        onNewFolderVisibilityClick={handleNewFolderVisibilityClick}
        isCreateFolderPending={createFolder.isPending}
        onCreateFolder={handleCreateFolder}
        moveTarget={moveTarget}
        onMoveDialogChange={handleMoveDialogChange}
        moveDestinationId={moveDestinationId}
        onMoveDestinationChange={handleMoveDestinationChange}
        folderList={folderList}
        isFolderMoveDestinationDisabled={isFolderMoveDestinationDisabled}
        getFolderPathLabel={getFolderPathLabel}
        moveVisibilityMessage={moveVisibilityMessage}
        isMovePending={moveCoworkerToFolder.isPending || moveFolder.isPending}
        onConfirmMove={handleConfirmMove}
        folderPendingVisibilityChange={folderPendingVisibilityChange}
        onVisibilityDialogChange={handleVisibilityDialogChange}
        isUpdateFolderVisibilityPending={updateFolderVisibility.isPending}
        onConfirmFolderVisibilityChange={handleConfirmFolderVisibilityChange}
        folderPendingDelete={folderPendingDelete}
        onFolderDeleteDialogChange={handleFolderDeleteDialogChange}
        isDeleteFolderPending={deleteFolder.isPending}
        onConfirmDeleteFolder={handleConfirmDeleteFolder}
        coworkerPendingDelete={coworkerPendingDelete}
        onDeleteDialogChange={handleDeleteDialogChange}
        deletingCoworkerId={deletingCoworkerId}
        onConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
}
