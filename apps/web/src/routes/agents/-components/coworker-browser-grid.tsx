import { T } from "gt-react";
import type { ReactNode } from "react";
import {
  InteractiveCoworkerCard,
  type InteractiveCoworkerCardData,
} from "@/components/coworkers/interactive-coworker-card";
import type { IntegrationType } from "@/lib/integration-icons";
import type { CoworkerFolderItem, CoworkerItem } from "./coworkers-page";
import { FolderCard } from "./folder-card";
import { SharedCoworkerCard, type SharedCoworkerItem } from "./shared-coworker-card";

type CoworkerSection = {
  key: string;
  title: ReactNode;
  coworkers: CoworkerItem[];
};

function getLatestRunTime(coworker: CoworkerItem) {
  const startedAt = coworker.recentRuns?.[0]?.startedAt;
  if (!startedAt) {
    return null;
  }
  const time = new Date(startedAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function buildCoworkerSections(coworkers: CoworkerItem[]): CoworkerSection[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const favorites: CoworkerItem[] = [];
  const active14: CoworkerItem[] = [];
  const active30: CoworkerItem[] = [];
  const inactive60: CoworkerItem[] = [];
  const older: CoworkerItem[] = [];

  for (const coworker of coworkers) {
    if (coworker.isPinned) {
      favorites.push(coworker);
      continue;
    }
    const latestRunTime = getLatestRunTime(coworker);
    const ageDays =
      latestRunTime === null ? Number.POSITIVE_INFINITY : (now - latestRunTime) / dayMs;
    if (ageDays <= 14) {
      active14.push(coworker);
    } else if (ageDays <= 30) {
      active30.push(coworker);
    } else if (ageDays <= 60) {
      older.push(coworker);
    } else {
      inactive60.push(coworker);
    }
  }

  return [
    { key: "favorites", title: <T>Favorites</T>, coworkers: favorites },
    { key: "active-14", title: <T>Active in last 14 days</T>, coworkers: active14 },
    { key: "active-30", title: <T>Active in last 30 days</T>, coworkers: active30 },
    { key: "inactive-30-60", title: <T>Inactive 30 to 60 days</T>, coworkers: older },
    { key: "inactive-60", title: <T>Inactive 60+ days</T>, coworkers: inactive60 },
  ].filter((section) => section.coworkers.length > 0);
}

export function CoworkerBrowserGrid({
  connectedIntegrationTypes,
  displayedCoworkerList,
  displayedFolderList,
  displayedSharedCoworkerList,
  canManageFolder,
  getFolderPathLabel,
  handleDeleteFolderRequest,
  handleImportSharedCoworker,
  handleMoveCoworker,
  handleMoveFolder,
  handleOpenCreateChildFolderDialog,
  handleCoworkerDragEnd,
  handleCoworkerDragStart,
  handleFolderCardDragEnd,
  handleFolderCardDragStart,
  handleFolderDragEnter,
  handleFolderDragLeave,
  handleFolderDragOver,
  handleFolderDropCoworker,
  handleToggleFolderVisibilityRequest,
  importingSharedCoworkerId,
  isGlobalSearch,
  activeDropFolderId,
}: {
  connectedIntegrationTypes: IntegrationType[];
  displayedCoworkerList: CoworkerItem[];
  displayedFolderList: CoworkerFolderItem[];
  displayedSharedCoworkerList: SharedCoworkerItem[];
  activeDropFolderId: string | null;
  canManageFolder: (folder: CoworkerFolderItem) => boolean;
  getFolderPathLabel: (folder: CoworkerFolderItem) => string | undefined;
  handleDeleteFolderRequest: (folder: CoworkerFolderItem) => void;
  handleImportSharedCoworker: (id: string) => void;
  handleMoveCoworker: (coworker: InteractiveCoworkerCardData) => void;
  handleMoveFolder: (folder: CoworkerFolderItem) => void;
  handleOpenCreateChildFolderDialog: (folder: CoworkerFolderItem) => void;
  handleCoworkerDragEnd: () => void;
  handleCoworkerDragStart: (
    coworker: InteractiveCoworkerCardData,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  handleFolderCardDragEnd: () => void;
  handleFolderCardDragStart: (
    folder: CoworkerFolderItem,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  handleFolderDragEnter: (folder: CoworkerFolderItem) => void;
  handleFolderDragLeave: (folder: CoworkerFolderItem) => void;
  handleFolderDragOver: (
    folder: CoworkerFolderItem,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  handleFolderDropCoworker: (
    folder: CoworkerFolderItem,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
  handleToggleFolderVisibilityRequest: (folder: CoworkerFolderItem) => void;
  importingSharedCoworkerId: string | null;
  isGlobalSearch: boolean;
}) {
  const coworkerSections = buildCoworkerSections(displayedCoworkerList);

  return (
    <div className="space-y-7">
      {displayedFolderList.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium">
            <T>Folders</T>
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {displayedFolderList.map((folder) => (
              <div key={`folder-${folder.id}`} className="h-full">
                <FolderCard
                  canManage={canManageFolder(folder)}
                  canChangeVisibility={folder.parentId === null && canManageFolder(folder)}
                  folder={folder}
                  isDragTarget={activeDropFolderId === folder.id}
                  isDraggable={canManageFolder(folder)}
                  onCreateChild={handleOpenCreateChildFolderDialog}
                  onDelete={handleDeleteFolderRequest}
                  onDragEnd={handleFolderCardDragEnd}
                  onDragEnter={handleFolderDragEnter}
                  onDragLeave={handleFolderDragLeave}
                  onDragOver={handleFolderDragOver}
                  onDragStart={handleFolderCardDragStart}
                  onDropCoworker={handleFolderDropCoworker}
                  onMove={handleMoveFolder}
                  onToggleVisibility={handleToggleFolderVisibilityRequest}
                  pathLabel={isGlobalSearch ? getFolderPathLabel(folder) : undefined}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {coworkerSections.map((section) => (
        <section key={section.key} className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium">{section.title}</h3>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {section.coworkers.map((wf) => (
              <div key={wf.id} className="h-full">
                <InteractiveCoworkerCard
                  coworker={wf}
                  onDragEnd={handleCoworkerDragEnd}
                  onDragStart={handleCoworkerDragStart}
                  onMove={handleMoveCoworker}
                  sharingLocked={wf.folderId !== null}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
      {displayedSharedCoworkerList.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium">
            <T>Shared with workspace</T>
          </h3>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {displayedSharedCoworkerList.map((coworker) => (
              <div key={`shared-${coworker.id}`} className="h-full">
                <SharedCoworkerCard
                  coworker={coworker}
                  connectedIntegrationTypes={connectedIntegrationTypes}
                  isImporting={importingSharedCoworkerId === coworker.id}
                  onImport={handleImportSharedCoworker}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
