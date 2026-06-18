import { T } from "gt-react";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  InteractiveCoworkerCard,
  type InteractiveCoworkerCardData,
} from "@/components/coworkers/interactive-coworker-card";
import type { IntegrationType } from "@/lib/integration-icons";
import { AppLink as Link } from "../-lib/app-link";
import type { CoworkerFolderItem, CoworkerItem } from "./coworkers-page";
import { FolderCard } from "./folder-card";
import { SharedCoworkerCard, type SharedCoworkerItem } from "./shared-coworker-card";

const CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;

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
  handleToggleFolderVisibilityRequest,
  importingSharedCoworkerId,
  isGlobalSearch,
}: {
  connectedIntegrationTypes: IntegrationType[];
  displayedCoworkerList: CoworkerItem[];
  displayedFolderList: CoworkerFolderItem[];
  displayedSharedCoworkerList: SharedCoworkerItem[];
  canManageFolder: (folder: CoworkerFolderItem) => boolean;
  getFolderPathLabel: (folder: CoworkerFolderItem) => string | undefined;
  handleDeleteFolderRequest: (folder: CoworkerFolderItem) => void;
  handleImportSharedCoworker: (id: string) => void;
  handleMoveCoworker: (coworker: InteractiveCoworkerCardData) => void;
  handleMoveFolder: (folder: CoworkerFolderItem) => void;
  handleOpenCreateChildFolderDialog: (folder: CoworkerFolderItem) => void;
  handleToggleFolderVisibilityRequest: (folder: CoworkerFolderItem) => void;
  importingSharedCoworkerId: string | null;
  isGlobalSearch: boolean;
}) {
  return (
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
        {displayedFolderList.map((folder) => (
          <motion.div
            key={`folder-${folder.id}`}
            layout
            className="h-full"
            initial={CARD_MOTION.initial}
            animate={CARD_MOTION.animate}
            exit={CARD_MOTION.exit}
            transition={CARD_MOTION.transition}
          >
            <FolderCard
              canManage={canManageFolder(folder)}
              canChangeVisibility={folder.parentId === null && canManageFolder(folder)}
              folder={folder}
              onCreateChild={handleOpenCreateChildFolderDialog}
              onDelete={handleDeleteFolderRequest}
              onMove={handleMoveFolder}
              onToggleVisibility={handleToggleFolderVisibilityRequest}
              pathLabel={isGlobalSearch ? getFolderPathLabel(folder) : undefined}
            />
          </motion.div>
        ))}
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
            <InteractiveCoworkerCard
              coworker={wf}
              onMove={handleMoveCoworker}
              sharingLocked={wf.folderId !== null}
            />
          </motion.div>
        ))}
        {displayedSharedCoworkerList.map((coworker) => (
          <motion.div
            key={`shared-${coworker.id}`}
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
  );
}
