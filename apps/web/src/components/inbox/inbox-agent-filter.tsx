"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { InboxCoworkerSelector, type InboxCoworkerSelectorItem } from "./inbox-coworker-selector";
import type { InboxItemStatus } from "./types";

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

type Props = {
  statusFilters: InboxItemStatus[];
  onToggleStatus: (status: InboxItemStatus) => void;
  sourceCoworkerId?: string;
  onSourceCoworkerChange: (coworkerId?: string) => void;
  coworkers: InboxCoworkerSelectorItem[];
  isLoadingCoworkers?: boolean;
};

export function InboxAgentFilter({
  statusFilters,
  onToggleStatus,
  sourceCoworkerId,
  onSourceCoworkerChange,
  coworkers,
  isLoadingCoworkers,
}: Props) {
  const handleAwaitingApprovalToggle = useCallback(() => {
    onToggleStatus("awaiting_approval");
  }, [onToggleStatus]);
  const handleNeedsUserInputToggle = useCallback(() => {
    onToggleStatus("needs_user_input");
  }, [onToggleStatus]);
  const handleRunningToggle = useCallback(() => {
    onToggleStatus("running");
  }, [onToggleStatus]);
  const handleAwaitingAuthToggle = useCallback(() => {
    onToggleStatus("awaiting_auth");
  }, [onToggleStatus]);
  const handlePausedToggle = useCallback(() => {
    onToggleStatus("paused");
  }, [onToggleStatus]);
  const handleCompletedToggle = useCallback(() => {
    onToggleStatus("completed");
  }, [onToggleStatus]);
  const handleErrorToggle = useCallback(() => {
    onToggleStatus("error");
  }, [onToggleStatus]);
  const handleCancelledToggle = useCallback(() => {
    onToggleStatus("cancelled");
  }, [onToggleStatus]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Needs your input"
          active={statusFilters.includes("needs_user_input")}
          onClick={handleNeedsUserInputToggle}
        />
        <FilterChip
          label="Awaiting approval"
          active={statusFilters.includes("awaiting_approval")}
          onClick={handleAwaitingApprovalToggle}
        />
        <FilterChip
          label="Running"
          active={statusFilters.includes("running")}
          onClick={handleRunningToggle}
        />
        <FilterChip
          label="Awaiting auth"
          active={statusFilters.includes("awaiting_auth")}
          onClick={handleAwaitingAuthToggle}
        />
        <FilterChip
          label="Needs continuation"
          active={statusFilters.includes("paused")}
          onClick={handlePausedToggle}
        />
        <FilterChip
          label="Completed"
          active={statusFilters.includes("completed")}
          onClick={handleCompletedToggle}
        />
        <FilterChip
          label="Error"
          active={statusFilters.includes("error")}
          onClick={handleErrorToggle}
        />
        <FilterChip
          label="Cancelled"
          active={statusFilters.includes("cancelled")}
          onClick={handleCancelledToggle}
        />

        <InboxCoworkerSelector
          coworkers={coworkers}
          selectedCoworkerId={sourceCoworkerId}
          onSelectCoworker={onSourceCoworkerChange}
          isLoading={isLoadingCoworkers}
        />
      </div>
    </div>
  );
}
