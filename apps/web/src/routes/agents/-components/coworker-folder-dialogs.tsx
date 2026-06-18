import { T } from "gt-react";
import { Loader2, Lock, Users } from "lucide-react";
import type { ChangeEventHandler, MouseEventHandler } from "react";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
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
import { cn } from "@/lib/utils";
import type { CoworkerFolderItem, CoworkerItem, MoveTarget } from "./coworkers-page";

type CoworkerFolderDialogsProps = {
  isCreatingFolder: boolean;
  onCreateFolderDialogChange: (open: boolean) => void;
  createFolderParent: CoworkerFolderItem | null;
  newFolderName: string;
  onNewFolderNameChange: ChangeEventHandler<HTMLInputElement>;
  t: (message: string) => string;
  createFolderParentId: string | null;
  newFolderVisibility: "private" | "workspace";
  onNewFolderVisibilityClick: MouseEventHandler<HTMLButtonElement>;
  isCreateFolderPending: boolean;
  onCreateFolder: MouseEventHandler<HTMLButtonElement>;
  moveTarget: MoveTarget | null;
  onMoveDialogChange: (open: boolean) => void;
  moveDestinationId: string;
  onMoveDestinationChange: ChangeEventHandler<HTMLSelectElement>;
  folderList: CoworkerFolderItem[];
  isFolderMoveDestinationDisabled: (folder: CoworkerFolderItem) => boolean;
  getFolderPathLabel: (folder: CoworkerFolderItem) => string | undefined;
  moveVisibilityMessage: string | null;
  isMovePending: boolean;
  onConfirmMove: MouseEventHandler<HTMLButtonElement>;
  folderPendingVisibilityChange: CoworkerFolderItem | null;
  onVisibilityDialogChange: (open: boolean) => void;
  isUpdateFolderVisibilityPending: boolean;
  onConfirmFolderVisibilityChange: MouseEventHandler<HTMLButtonElement>;
  folderPendingDelete: CoworkerFolderItem | null;
  onFolderDeleteDialogChange: (open: boolean) => void;
  isDeleteFolderPending: boolean;
  onConfirmDeleteFolder: MouseEventHandler<HTMLButtonElement>;
  coworkerPendingDelete: CoworkerItem | null;
  onDeleteDialogChange: (open: boolean) => void;
  deletingCoworkerId: string | null;
  onConfirmDelete: MouseEventHandler<HTMLButtonElement>;
};

export function CoworkerFolderDialogs({
  isCreatingFolder,
  onCreateFolderDialogChange,
  createFolderParent,
  newFolderName,
  onNewFolderNameChange,
  t,
  createFolderParentId,
  newFolderVisibility,
  onNewFolderVisibilityClick,
  isCreateFolderPending,
  onCreateFolder,
  moveTarget,
  onMoveDialogChange,
  moveDestinationId,
  onMoveDestinationChange,
  folderList,
  isFolderMoveDestinationDisabled,
  getFolderPathLabel,
  moveVisibilityMessage,
  isMovePending,
  onConfirmMove,
  folderPendingVisibilityChange,
  onVisibilityDialogChange,
  isUpdateFolderVisibilityPending,
  onConfirmFolderVisibilityChange,
  folderPendingDelete,
  onFolderDeleteDialogChange,
  isDeleteFolderPending,
  onConfirmDeleteFolder,
  coworkerPendingDelete,
  onDeleteDialogChange,
  deletingCoworkerId,
  onConfirmDelete,
}: CoworkerFolderDialogsProps) {
  return (
    <>
      <AlertDialog open={isCreatingFolder} onOpenChange={onCreateFolderDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>New folder</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {createFolderParent ? (
                <>
                  <T>Create a folder inside</T> {createFolderParent.name}.
                </>
              ) : (
                <T>Create a top-level folder for your coworkers.</T>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={newFolderName}
              onChange={onNewFolderNameChange}
              placeholder={t("Folder name")}
              className="h-9 text-sm"
            />
            {!createFolderParentId ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-visibility="private"
                  onClick={onNewFolderVisibilityClick}
                  className={cn(
                    "border-border/60 hover:border-border flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                    newFolderVisibility === "private" && "border-foreground/30 bg-muted",
                  )}
                >
                  <Lock className="size-3.5" />
                  <T>Private</T>
                </button>
                <button
                  type="button"
                  data-visibility="workspace"
                  onClick={onNewFolderVisibilityClick}
                  className={cn(
                    "border-border/60 hover:border-border flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                    newFolderVisibility === "workspace" && "border-foreground/30 bg-muted",
                  )}
                >
                  <Users className="size-3.5" />
                  <T>Workspace</T>
                </button>
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreateFolderPending}>
              <T>Cancel</T>
            </AlertDialogCancel>
            <AlertDialogAction onClick={onCreateFolder} disabled={isCreateFolderPending}>
              {isCreateFolderPending ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Create</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={moveTarget !== null} onOpenChange={onMoveDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Move</T> {moveTarget?.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>Choose where this item should live.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <select
              value={moveDestinationId}
              onChange={onMoveDestinationChange}
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="top">{t("Top level")}</option>
              {folderList.map((folder) => (
                <option
                  key={folder.id}
                  value={folder.id}
                  disabled={isFolderMoveDestinationDisabled(folder)}
                >
                  {getFolderPathLabel(folder) ?? folder.name}
                </option>
              ))}
            </select>
            {moveVisibilityMessage ? (
              <p className="text-muted-foreground mt-3 text-xs">{moveVisibilityMessage}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMovePending}>
              <T>Cancel</T>
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmMove} disabled={isMovePending}>
              {isMovePending ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Move</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={folderPendingVisibilityChange !== null}
        onOpenChange={onVisibilityDialogChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {folderPendingVisibilityChange?.visibility === "workspace" ? (
                <T>Make folder private?</T>
              ) : (
                <T>Share folder with workspace?</T>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {folderPendingVisibilityChange?.visibility === "workspace" ? (
                <T>Contained coworkers will become private.</T>
              ) : (
                <T>Contained coworkers will be shared with the workspace.</T>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdateFolderVisibilityPending}>
              <T>Cancel</T>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmFolderVisibilityChange}
              disabled={isUpdateFolderVisibilityPending}
            >
              {isUpdateFolderVisibilityPending ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Confirm</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={folderPendingDelete !== null} onOpenChange={onFolderDeleteDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Delete folder?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {folderPendingDelete ? (
                <>
                  <T>Delete</T> {folderPendingDelete.name}
                  <T>? Its contents will move up one level.</T>
                </>
              ) : (
                <T>Its contents will move up one level.</T>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleteFolderPending}>
              <T>Cancel</T>
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteFolder} disabled={isDeleteFolderPending}>
              {isDeleteFolderPending ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Delete</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={coworkerPendingDelete !== null} onOpenChange={onDeleteDialogChange}>
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
              onClick={onConfirmDelete}
              disabled={deletingCoworkerId !== null}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deletingCoworkerId !== null ? <Loader2 className="size-3 animate-spin" /> : null}
              <T>Delete</T>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
