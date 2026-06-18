import { T } from "gt-react";
import { Ellipsis, Folder, FolderPlus, Lock, Move, Trash2, Users } from "lucide-react";
import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AppLink as Link } from "../-lib/app-link";
import type { CoworkerFolderItem } from "./coworkers-page";

function setFolderDragImage(event: React.DragEvent<HTMLDivElement>) {
  const source = event.currentTarget;
  const rect = source.getBoundingClientRect();
  const clone = source.cloneNode(true);

  if (!(clone instanceof HTMLElement)) {
    return;
  }

  clone.style.position = "fixed";
  clone.style.top = "-1000px";
  clone.style.left = "-1000px";
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.pointerEvents = "none";
  clone.style.opacity = "0.92";
  clone.style.boxShadow = "0 12px 32px -18px oklch(0.145 0 0 / 0.45)";
  clone.style.transform = "translateZ(0)";
  document.body.append(clone);
  event.dataTransfer.setDragImage(clone, rect.width / 2, rect.height / 2);
  window.requestAnimationFrame(() => clone.remove());
}

export function FolderCard({
  canManage,
  canChangeVisibility,
  folder,
  isDragTarget = false,
  isDraggable = false,
  onCreateChild,
  onDelete,
  onDragEnter,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDropCoworker,
  onDragStart,
  onMove,
  onToggleVisibility,
  pathLabel,
}: {
  canManage: boolean;
  canChangeVisibility: boolean;
  folder: CoworkerFolderItem;
  isDragTarget?: boolean;
  isDraggable?: boolean;
  onCreateChild: (folder: CoworkerFolderItem) => void;
  onDelete: (folder: CoworkerFolderItem) => void;
  onDragEnter?: (folder: CoworkerFolderItem) => void;
  onDragEnd?: () => void;
  onDragLeave?: (folder: CoworkerFolderItem) => void;
  onDragOver?: (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => void;
  onDropCoworker?: (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => void;
  onDragStart?: (folder: CoworkerFolderItem, event: React.DragEvent<HTMLDivElement>) => void;
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
  const handleDragEnter = useCallback(() => onDragEnter?.(folder), [folder, onDragEnter]);
  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      onDragLeave?.(folder);
    },
    [folder, onDragLeave],
  );
  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropCoworker) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      onDragOver?.(folder, event);
    },
    [folder, onDragOver, onDropCoworker],
  );
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropCoworker) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onDropCoworker(folder, event);
    },
    [folder, onDropCoworker],
  );
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isDraggable || !onDragStart) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button,[role='menuitem']")) {
        event.preventDefault();
        return;
      }
      setFolderDragImage(event);
      onDragStart(folder, event);
    },
    [folder, isDraggable, onDragStart],
  );

  return (
    <div
      draggable={isDraggable}
      onDragEnd={onDragEnd}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      className={cn(
        "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex min-h-20 items-center gap-3 rounded-lg border p-3 transition-all duration-150",
        isDragTarget && "border-brand bg-brand/5 ring-brand/20 ring-2",
        isDraggable && "active:cursor-grabbing",
      )}
    >
      <Link
        href={`/agents/folders/${encodeURIComponent(folder.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <div className="bg-muted/60 flex size-10 shrink-0 items-center justify-center rounded-md">
          <Folder className="text-muted-foreground size-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-foreground truncate text-sm font-semibold">{folder.name}</h3>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[11px] font-medium">
              <VisibilityIcon className="size-3" />
              {visibility === "workspace" ? <T>Workspace</T> : <T>Private</T>}
            </span>
            {pathLabel ? (
              <span className="text-muted-foreground truncate text-[11px]">{pathLabel}</span>
            ) : null}
          </div>
        </div>
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-1">
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
    </div>
  );
}
