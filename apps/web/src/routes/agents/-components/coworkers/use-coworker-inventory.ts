import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { IntegrationType } from "@/lib/integration-icons";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { COWORKERS_OPEN_RECENT_DRAWER_EVENT } from "@/lib/coworkers-events";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import {
  type CoworkerListData,
  type CoworkerFolderListData,
  useCreateCoworkerFolder,
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
import { useCurrentUser } from "@/orpc/hooks/user";
import type { SharedCoworkerItem } from "../shared-coworker-card";
import { useCoworkerComposer } from "./use-coworker-composer";

export type CoworkerItem = CoworkerListData[number];
export type CoworkerFolderItem = CoworkerFolderListData[number];
type DraggedCoworker = { id: string; name?: string | null; folderId?: string | null };
type DraggedFolder = CoworkerFolderItem;
export type MoveTarget =
  | { type: "coworker"; id: string; name: string; currentFolderId: string | null }
  | { type: "folder"; id: string; name: string; currentFolderId: string | null };

const EMPTY_INITIAL_COWORKERS: CoworkerListData = [];
const EMPTY_INITIAL_FOLDERS: CoworkerFolderListData = [];

type UseCoworkerInventoryInput = {
  currentFolderId?: string | null;
  initialCoworkerSharedCount?: number;
  initialCoworkerTotalCount?: number;
  initialCoworkers?: CoworkerListData;
  initialFolders?: CoworkerFolderListData;
};

/**
 * Owns the entire coworker inventory surface: data loading, folder-tree
 * traversal (roots, breadcrumbs, path labels, descendant/ancestor checks),
 * effective-visibility resolution, the drag-and-drop state machine, and every
 * create/move/delete/import/visibility mutation handler. The coworkers page is
 * a thin presentational shell that reads the returned object and renders the
 * grid, header controls, and dialogs from it.
 */
export function useCoworkerInventory({
  currentFolderId = null,
  initialCoworkerSharedCount = 0,
  initialCoworkerTotalCount = 0,
  initialCoworkers = EMPTY_INITIAL_COWORKERS,
  initialFolders = EMPTY_INITIAL_FOLDERS,
}: UseCoworkerInventoryInput) {
  const t = useGT();
  const navigate = useNavigate();

  const { data: coworkers, isLoading: isCoworkersLoading } = useCoworkerList({
    initialData: initialCoworkers,
  });
  const { data: folders, isLoading: isFoldersLoading } = useCoworkerFolderList({
    initialData: initialFolders,
  });
  const { data: sharedCoworkers } = useSharedCoworkerList();
  const { data: integrations } = useIntegrationList();
  const { data: currentUser } = useCurrentUser();
  const createFolder = useCreateCoworkerFolder();
  const deleteFolder = useDeleteCoworkerFolder();
  const deleteCoworker = useDeleteCoworker();
  const importCoworkerDefinition = useImportCoworkerDefinition();
  const importSharedCoworker = useImportSharedCoworker();
  const moveCoworkerToFolder = useMoveCoworkerToFolder();
  const moveFolder = useMoveCoworkerFolder();
  const updateFolderVisibility = useUpdateCoworkerFolderVisibility();

  const composer = useCoworkerComposer({ currentFolderId });
  const { doCreate, isCreating, setIsCreating } = composer;

  const openRecentDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COWORKERS_OPEN_RECENT_DRAWER_EVENT));
  }, []);
  const [importingSharedCoworkerId, setImportingSharedCoworkerId] = useState<string | null>(null);
  const [deletingCoworkerId, setDeletingCoworkerId] = useState<string | null>(null);
  const [coworkerPendingDelete, setCoworkerPendingDelete] = useState<CoworkerItem | null>(null);
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

  const hasInventoryData =
    coworkerList.length > 0 || folderList.length > 0 || displayedSharedCoworkerList.length > 0;
  const isInventoryLoading =
    !currentFolderId && !hasInventoryData && (isCoworkersLoading || isFoldersLoading);

  return {
    t,
    composer,
    doCreate,
    isCreating,
    setIsCreating,
    openRecentDrawer,
    coworkerList,
    folderList,
    visibleCoworkerCount,
    connectedIntegrationTypes,
    sharedByMeCount,
    breadcrumbs,
    currentFolder,
    createFolderParent,
    getFolderPathLabel,
    canManageFolder,
    isFolderMoveDestinationDisabled,
    moveVisibilityMessage,
    isGlobalSearch,
    hasActiveFilters,
    hasInventoryData,
    isInventoryLoading,
    displayedFolderList,
    displayedCoworkerList,
    displayedSharedCoworkerList,
    activeDropFolderId,
    importingSharedCoworkerId,
    deletingCoworkerId,
    coworkerPendingDelete,
    filterShared,
    searchQuery,
    selectedTriggerTypes,
    isCreatingFolder,
    createFolderParentId,
    newFolderName,
    newFolderVisibility,
    moveTarget,
    moveDestinationId,
    folderPendingDelete,
    folderPendingVisibilityChange,
    importCoworkerDefinition,
    createFolder,
    deleteFolder,
    updateFolderVisibility,
    moveCoworkerToFolder,
    moveFolder,
    importFileInputRef,
    handleToggleFilterShared,
    handleToggleTriggerType,
    handleTriggerTypeButtonClick,
    handleClearAllFilters,
    handleSearchChange,
    handleImportSharedCoworker,
    handleImportCoworkerClick,
    handleCreateFolderDialogChange,
    handleOpenCreateFolderDialog,
    handleOpenCreateChildFolderDialog,
    handleNewFolderNameChange,
    handleNewFolderVisibilityClick,
    handleCreateFolder,
    handleMoveCoworker,
    handleCoworkerDragStart,
    handleCoworkerDragEnd,
    handleFolderCardDragStart,
    handleFolderCardDragEnd,
    handleFolderDragEnter,
    handleFolderDragLeave,
    handleFolderDragOver,
    handleFolderDropCoworker,
    handleMoveFolder,
    handleDeleteFolderRequest,
    handleToggleFolderVisibilityRequest,
    handleMoveDestinationChange,
    handleMoveDialogChange,
    handleConfirmMove,
    handleConfirmDeleteFolder,
    handleFolderDeleteDialogChange,
    handleVisibilityDialogChange,
    handleConfirmFolderVisibilityChange,
    handleImportCoworkerFileChange,
    handleDeleteDialogChange,
    handleConfirmDelete,
  };
}
