"use client";

import { Search } from "lucide-react";
import { useCallback, useMemo, useState, type DragEvent } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CoworkerSummary = {
  id: string;
  name?: string | null;
  username?: string | null;
  status: "on" | "off";
  triggerType: string;
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  email: "Email",
  webhook: "Webhook",
};

function SidebarCard({
  coworker,
  onAdd,
}: {
  coworker: CoworkerSummary;
  onAdd?: (coworkerId: string) => void;
}) {
  const isOn = coworker.status === "on";

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData("application/cmdclaw-coworker", coworker.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [coworker.id],
  );

  const handleClick = useCallback(() => {
    onAdd?.(coworker.id);
  }, [onAdd, coworker.id]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-150",
        "bg-card border-border/20 border",
        "hover:bg-muted/50 hover:border-border/40 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.03)]",
        "active:scale-[0.98] active:shadow-none",
      )}
    >
      <div className="relative shrink-0">
        <CoworkerAvatar username={coworker.username} size={24} />
        <span
          className={cn(
            "absolute -right-px -bottom-px size-2 rounded-full ring-[1.5px] ring-white dark:ring-neutral-900",
            isOn ? "bg-emerald-500" : "bg-muted-foreground/25",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-foreground/90 truncate text-xs font-medium tracking-[-0.01em]">
          {coworker.name?.trim() || "New Coworker"}
        </p>
        <span className="text-muted-foreground/60 text-[10px]">
          {TRIGGER_LABELS[coworker.triggerType] ?? coworker.triggerType}
        </span>
      </div>
    </div>
  );
}

export function UnassignedSidebarContent({
  coworkers,
  onAdd,
}: {
  coworkers: CoworkerSummary[];
  onAdd?: (coworkerId: string) => void;
}) {
  const [search, setSearch] = useState("");

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const filtered = useMemo(
    () => coworkers.filter((c) => (c.name ?? "").toLowerCase().includes(search.toLowerCase())),
    [coworkers, search],
  );

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3.5">
        <h3 className="text-foreground/80 text-xs font-semibold tracking-widest uppercase">
          Unassigned
        </h3>
        <span className="bg-muted text-muted-foreground/70 rounded-md px-1.5 py-px text-[10px] font-medium tabular-nums">
          {coworkers.length}
        </span>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="text-muted-foreground/40 pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Filter coworkers..."
            className="border-border/20 bg-muted/30 focus-visible:border-border/50 h-8 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-12 pb-6">
            <div className="bg-muted/50 flex size-10 items-center justify-center rounded-xl">
              <Search className="text-muted-foreground/30 size-4" />
            </div>
            <p className="text-muted-foreground/50 text-center text-xs leading-relaxed">
              {coworkers.length === 0
                ? "All coworkers placed on canvas"
                : "No coworkers match your filter"}
            </p>
          </div>
        ) : (
          filtered.map((c) => <SidebarCard key={c.id} coworker={c} onAdd={onAdd} />)
        )}
      </div>
    </>
  );
}

export function UnassignedSidebar({
  coworkers,
  onAdd,
}: {
  coworkers: CoworkerSummary[];
  onAdd?: (coworkerId: string) => void;
}) {
  return (
    <div className="bg-background/80 border-border/30 hidden h-full w-[280px] shrink-0 flex-col border-l backdrop-blur-sm md:flex">
      <UnassignedSidebarContent coworkers={coworkers} onAdd={onAdd} />
    </div>
  );
}
