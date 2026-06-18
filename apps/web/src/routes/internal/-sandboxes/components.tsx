import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ENV_COLORS, PROVIDER_META, type Provider, type SortDir, type SortKey } from "./shared";

export function EnvironmentBadge({ env }: { env: string | null }) {
  if (!env) {
    return <span className="text-muted-foreground">--</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        ENV_COLORS[env] ?? "bg-gray-500/10 text-gray-700 dark:text-gray-400",
      )}
    >
      {env}
    </span>
  );
}

export function ProviderPill({ provider }: { provider: Provider }) {
  const meta = PROVIDER_META[provider];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider tabular-nums",
        meta.pillClass,
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", meta.dotClass)} />
      {meta.label}
    </span>
  );
}

export function KillButton({
  sandboxId,
  provider,
  isKilling,
  onKill,
}: {
  sandboxId: string;
  provider: Provider;
  isKilling: boolean;
  onKill: (id: string, provider: Provider) => void;
}) {
  const handleClick = useCallback(() => onKill(sandboxId, provider), [sandboxId, provider, onKill]);
  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={isKilling}>
      {isKilling ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4 text-red-500" />
      )}
    </Button>
  );
}

export function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const handleClick = useCallback(() => onSort(sortKey), [onSort, sortKey]);
  const isActive = currentKey === sortKey;
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-4 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
      onClick={handleClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="text-muted-foreground/50 h-3 w-3" />
        )}
      </span>
    </th>
  );
}

export function ProviderFilterButton({
  filterKey,
  label,
  count,
  active,
  onSelect,
}: {
  filterKey: "all" | Provider;
  label: string;
  count: number;
  active: boolean;
  onSelect: (key: "all" | Provider) => void;
}) {
  const handleClick = useCallback(() => onSelect(filterKey), [filterKey, onSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "rounded px-2.5 py-1 font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="text-muted-foreground ml-1.5 tabular-nums">{count}</span>
    </button>
  );
}
