import { T } from "gt-react";
import {
  ChevronRight,
  Ellipsis,
  Folder,
  FolderPlus,
  Lock,
  Move,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppLink as Link } from "../-lib/app-link";
import type { CoworkerFolderItem } from "./coworkers-page";

export function FolderCard({
  canManage,
  canChangeVisibility,
  folder,
  onCreateChild,
  onDelete,
  onMove,
  onToggleVisibility,
  pathLabel,
}: {
  canManage: boolean;
  canChangeVisibility: boolean;
  folder: CoworkerFolderItem;
  onCreateChild: (folder: CoworkerFolderItem) => void;
  onDelete: (folder: CoworkerFolderItem) => void;
  onMove: (folder: CoworkerFolderItem) => void;
  onToggleVisibility: (folder: CoworkerFolderItem) => void;
  pathLabel?: string;
}) {
  const visibility = folder.visibility;
  const VisibilityIcon = visibility === "workspace" ? Users : Lock;
  const handleCreateChild = useCallback(() => onCreateChild(folder), [folder, onCreateChild]);
  const handleMove = useCallback(() => onMove(folder), [folder, onMove]);
  const handleDelete = useCallback(() => onDelete(folder), [folder, onDelete]);
  const handleToggleVisibility = useCallback(
    () => onToggleVisibility(folder),
    [folder, onToggleVisibility],
  );
  const handleStopPropagation = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div className="border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full min-h-[180px] flex-col gap-4 rounded-xl border p-5 transition-all duration-150">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/agents/folders/${encodeURIComponent(folder.id)}`}
          className="flex min-w-0 flex-1 items-start gap-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <div className="bg-muted/60 flex size-11 shrink-0 items-center justify-center rounded-lg">
            <Folder className="text-muted-foreground size-5" />
          </div>
          <span className="text-muted-foreground mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium">
            <VisibilityIcon className="size-3" />
            {visibility === "workspace" ? <T>Workspace</T> : <T>Private</T>}
          </span>
        </Link>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={handleStopPropagation}
                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 items-center justify-center rounded-md transition-colors"
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={handleStopPropagation}>
              <DropdownMenuItem onSelect={handleCreateChild}>
                <FolderPlus className="size-4" />
                <T>New subfolder</T>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleMove}>
                <Move className="size-4" />
                <T>Move folder</T>
              </DropdownMenuItem>
              {canChangeVisibility ? (
                <DropdownMenuItem onSelect={handleToggleVisibility}>
                  {visibility === "workspace" ? (
                    <>
                      <Lock className="size-4" />
                      <T>Make private</T>
                    </>
                  ) : (
                    <>
                      <Users className="size-4" />
                      <T>Share with workspace</T>
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                <T>Delete folder</T>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Link
        href={`/agents/folders/${encodeURIComponent(folder.id)}`}
        className="min-w-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <h3 className="text-foreground truncate text-sm font-semibold">{folder.name}</h3>
        {pathLabel ? (
          <p className="text-muted-foreground mt-1 truncate text-xs">{pathLabel}</p>
        ) : null}
      </Link>
      <Link
        href={`/agents/folders/${encodeURIComponent(folder.id)}`}
        className="mt-auto flex items-center justify-between pt-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          <T>Folder</T>
        </span>
        <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
