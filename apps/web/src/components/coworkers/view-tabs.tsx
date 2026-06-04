import { Bookmark, Ellipsis, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useCoworkerTagList,
  useCoworkerViewList,
  useCreateCoworkerView,
  useUpdateCoworkerView,
  useDeleteCoworkerView,
} from "@/orpc/hooks/coworkers";

type ViewFilters = {
  tagIds?: string[];
  statuses?: string[];
  triggerTypes?: string[];
};

type ViewTabsProps = {
  activeViewId: string | null;
  onSelectView: (viewId: string | null) => void;
  currentFilters: ViewFilters;
  hasActiveFilters: boolean;
  selectedTagIds: Set<string>;
  onToggleTag: (tagId: string) => void;
  onClearAll: () => void;
};

function TagIndicator({ color }: { color?: string | null }) {
  const style = useMemo(() => ({ backgroundColor: color || "#6b7280" }), [color]);

  return <span className="size-1.5 shrink-0 rounded-full" style={style} />;
}

export function ViewTabs({
  activeViewId,
  onSelectView,
  currentFilters,
  hasActiveFilters,
  selectedTagIds,
  onToggleTag,
  onClearAll,
}: ViewTabsProps) {
  const { data: tags } = useCoworkerTagList();
  const { data: views } = useCoworkerViewList();
  const createView = useCreateCoworkerView();
  const updateView = useUpdateCoworkerView();
  const deleteView = useDeleteCoworkerView();

  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const saveInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleSaveView = useCallback(async () => {
    const name = saveName.trim();
    if (!name) {
      return;
    }
    try {
      const view = await createView.mutateAsync({ name, filters: currentFilters });
      setSaveName("");
      setIsSaving(false);
      onSelectView(view.id);
    } catch {
      // name conflict
    }
  }, [saveName, currentFilters, createView, onSelectView]);

  const handleRename = useCallback(
    async (viewId: string) => {
      const name = renameValue.trim();
      if (!name) {
        return;
      }
      await updateView.mutateAsync({ id: viewId, name });
      setRenamingId(null);
      setRenameValue("");
    },
    [renameValue, updateView],
  );

  const handleDelete = useCallback(
    async (viewId: string) => {
      await deleteView.mutateAsync(viewId);
      if (activeViewId === viewId) {
        onSelectView(null);
      }
    },
    [deleteView, activeViewId, onSelectView],
  );

  const hasViews = (views ?? []).length > 0;
  const isAllSelected = activeViewId === null && selectedTagIds.size === 0;
  const handleTagClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const tagId = event.currentTarget.dataset.tagId;
      if (tagId) {
        onToggleTag(tagId);
      }
    },
    [onToggleTag],
  );
  const handleRenameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRenameValue(event.target.value);
  }, []);
  const handleRenameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!renamingId) {
        return;
      }
      if (event.key === "Enter") {
        void handleRename(renamingId);
      }
      if (event.key === "Escape") {
        setRenamingId(null);
        setRenameValue("");
      }
    },
    [handleRename, renamingId],
  );
  const handleRenameBlur = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);
  const handleViewSelect = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const viewId = event.currentTarget.dataset.viewId;
      if (viewId) {
        onSelectView(viewId);
      }
    },
    [onSelectView],
  );
  const handleStartRename = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const { viewId, viewName } = event.currentTarget.dataset;
    if (!viewId || !viewName) {
      return;
    }
    setRenamingId(viewId);
    setRenameValue(viewName);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, []);
  const handleDeleteView = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const { viewId } = event.currentTarget.dataset;
      if (viewId) {
        void handleDelete(viewId);
      }
    },
    [handleDelete],
  );
  const handleSaveNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSaveName(event.target.value);
  }, []);
  const handleSaveNameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        void handleSaveView();
      }
      if (event.key === "Escape") {
        setIsSaving(false);
        setSaveName("");
      }
    },
    [handleSaveView],
  );
  const handleStartSaving = useCallback(() => {
    setIsSaving(true);
    setTimeout(() => saveInputRef.current?.focus(), 0);
  }, []);

  return (
    <div className="border-border/40 scrollbar-none inline-flex w-fit items-center gap-1.5 overflow-x-auto rounded-lg border p-1">
      {/* All tab */}
      <button
        type="button"
        onClick={onClearAll}
        className={cn(
          "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
          isAllSelected
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        All
      </button>

      <div className="bg-border/60 h-4 w-px shrink-0" />

      {/* Tag filter chips */}
      {(tags ?? []).map((tag) => {
        const isActive = selectedTagIds.has(tag.id);
        return (
          <button
            key={`tag-${tag.id}`}
            type="button"
            data-tag-id={tag.id}
            onClick={handleTagClick}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
              isActive
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <TagIndicator color={tag.color} />
            {tag.name}
            {isActive && <X className="size-2.5 opacity-60" />}
          </button>
        );
      })}

      {/* Separator before saved views */}
      {hasViews && <div className="bg-border/60 h-4 w-px shrink-0" />}

      {/* Saved view tabs */}
      {(views ?? []).map((view) => (
        <div key={view.id} className="group relative flex shrink-0 items-center">
          {renamingId === view.id ? (
            <Input
              ref={renameInputRef}
              value={renameValue}
              onChange={handleRenameChange}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              className="h-6 w-24 rounded-md px-2 text-xs"
              autoFocus
            />
          ) : (
            <button
              type="button"
              data-view-id={view.id}
              onClick={handleViewSelect}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                activeViewId === view.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <Bookmark className="mr-1 inline size-3 opacity-50" />
              {view.name}
            </button>
          )}

          {/* Context menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "text-muted-foreground/40 hover:text-muted-foreground -ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-all group-hover:opacity-100",
                  activeViewId === view.id && "opacity-60",
                )}
              >
                <Ellipsis className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-32">
              <DropdownMenuItem
                data-view-id={view.id}
                data-view-name={view.name}
                onClick={handleStartRename}
                className="text-xs"
              >
                <Pencil className="mr-1.5 size-3" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                data-view-id={view.id}
                onClick={handleDeleteView}
                className="text-destructive focus:text-destructive text-xs"
              >
                <Trash2 className="mr-1.5 size-3" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {/* Save current filters as view */}
      {hasActiveFilters && activeViewId === null && (
        <>
          <div className="bg-border/60 h-4 w-px shrink-0" />
          {isSaving ? (
            <div className="flex shrink-0 items-center gap-1">
              <Input
                ref={saveInputRef}
                value={saveName}
                onChange={handleSaveNameChange}
                onKeyDown={handleSaveNameKeyDown}
                placeholder="View name..."
                className="h-6 w-28 rounded-md px-2 text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveView}
                disabled={!saveName.trim() || createView.isPending}
                className="bg-foreground/10 text-foreground shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleStartSaving}
              className="text-muted-foreground/60 hover:text-muted-foreground flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
            >
              <Bookmark className="size-3" />
              Save view
            </button>
          )}
        </>
      )}
    </div>
  );
}
