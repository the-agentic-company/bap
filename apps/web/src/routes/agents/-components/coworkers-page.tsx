import {
  ChevronRight,
  ChevronDown,
  Filter,
  Folder,
  Loader2,
  Menu,
  Search,
  Share2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { T, useMessages } from "gt-react";
import type { CoworkerListData, CoworkerFolderListData } from "@/orpc/hooks/coworkers";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AppImage as Image } from "../-lib/app-image";
import { AppLink as Link } from "../-lib/app-link";
import { CoworkerBrowserGrid } from "./coworker-browser-grid";
import { CoworkerFolderDialogs } from "./coworker-folder-dialogs";
import { CoworkerInventoryLoading } from "./coworker-inventory-loading";
import { TRIGGER_TYPE_OPTIONS } from "./coworker-trigger-type-options";
import { useCoworkerInventory } from "./coworkers/use-coworker-inventory";

export type CoworkerItem = CoworkerListData[number];
export type CoworkerFolderItem = CoworkerFolderListData[number];
export type { MoveTarget } from "./coworkers/use-coworker-inventory";

export default function CoworkersPage({
  currentFolderId = null,
  initialCoworkerSharedCount = 0,
  initialCoworkerTotalCount = 0,
  initialCoworkers,
  initialFolders,
}: {
  currentFolderId?: string | null;
  initialCoworkerSharedCount?: number;
  initialCoworkerTotalCount?: number;
  initialCoworkers?: CoworkerListData;
  initialFolders?: CoworkerFolderListData;
}) {
  const m = useMessages();
  const inventory = useCoworkerInventory({
    currentFolderId,
    initialCoworkerSharedCount,
    initialCoworkerTotalCount,
    initialCoworkers,
    initialFolders,
  });
  const {
    t,
    openRecentDrawer,
    coworkerList,
    folderList,
    visibleCoworkerCount,
    connectedIntegrationTypes,
    sharedByMeCount,
    breadcrumbs,
    createFolderParent,
    getFolderPathLabel,
    canManageFolder,
    isFolderMoveDestinationDisabled,
    moveVisibilityMessage,
    isGlobalSearch,
    hasActiveFilters,
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
  } = inventory;

  return (
    <div className="space-y-10">
      {coworkerList.length === 0 &&
      folderList.length === 0 &&
      !currentFolderId &&
      !searchQuery.trim() &&
      !isInventoryLoading ? (
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

          {isInventoryLoading ? (
            <CoworkerInventoryLoading label={t("Loading coworkers")} />
          ) : displayedCoworkerList.length === 0 &&
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
