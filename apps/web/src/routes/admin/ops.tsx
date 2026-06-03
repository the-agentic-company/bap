import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, RefreshCw, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import {
  useAdminOpsScheduledCoworkers,
  useEnqueueAdminScheduledCoworkersNow,
  useResetOnboarding,
} from "@/orpc/hooks";

export const Route = createFileRoute("/admin/ops")({
  head: () => ({ meta: [{ title: "Ops - CmdClaw" }] }),
  component: AdminOpsPage,
});

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "never";
  }

  const date = value instanceof Date ? value : new Date(value);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleString();
}

function formatSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") {
    return "Invalid";
  }

  const value = schedule as Record<string, unknown>;

  if (value.type === "interval" && typeof value.intervalMinutes === "number") {
    return `Every ${value.intervalMinutes} min`;
  }
  if (value.type === "daily" && typeof value.time === "string") {
    return `Daily ${value.time}`;
  }
  if (
    value.type === "weekly" &&
    typeof value.time === "string" &&
    Array.isArray(value.daysOfWeek)
  ) {
    return `Weekly ${value.time}`;
  }
  if (
    value.type === "monthly" &&
    typeof value.time === "string" &&
    typeof value.dayOfMonth === "number"
  ) {
    return `Monthly day ${value.dayOfMonth} ${value.time}`;
  }

  return "Invalid";
}

function AdminOpsPage() {
  const navigate = useNavigate();
  const { data: scheduledCoworkers, isLoading, error, refetch } = useAdminOpsScheduledCoworkers();
  const enqueueScheduled = useEnqueueAdminScheduledCoworkersNow();
  const resetOnboarding = useResetOnboarding();

  const [search, setSearch] = useState("");
  const [hourlyOnly, setHourlyOnly] = useState(true);
  const [onOnly, setOnOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (scheduledCoworkers ?? []).filter((row) => {
      if (hourlyOnly && !row.isHourlyInterval) {
        return false;
      }
      if (onOnly && row.status !== "on") {
        return false;
      }
      if (!query) {
        return true;
      }

      return (
        row.id.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        (row.username?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [hourlyOnly, onOnly, scheduledCoworkers, search]);

  useEffect(() => {
    const visibleIds = new Set(filteredRows.map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [filteredRows]);

  const visibleIds = useMemo(() => filteredRows.map((row) => row.id), [filteredRows]);

  const handleToggleSelected = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  }, []);

  const handleHourlyOnlyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setHourlyOnly(event.target.checked);
  }, []);

  const handleOnOnlyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setOnOnly(event.target.checked);
  }, []);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleSelectedCheckboxChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const id = event.currentTarget.dataset.coworkerId;
      if (!id) {
        return;
      }

      handleToggleSelected(id);
    },
    [handleToggleSelected],
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const handleToggleAll = useCallback(() => {
    setSelectedIds(allVisibleSelected ? [] : visibleIds);
  }, [allVisibleSelected, visibleIds]);

  const runEnqueue = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        setActionError("Select at least one scheduled coworker.");
        setActionMessage(null);
        return;
      }

      setActionError(null);
      setActionMessage(null);

      try {
        const result = await enqueueScheduled.mutateAsync({ ids });
        const skipped = result.results
          .filter((entry) => !entry.ok)
          .map((entry) => entry.id)
          .slice(0, 5);

        setActionMessage(
          result.skippedCount > 0
            ? `Enqueued ${result.enqueuedCount} coworker(s); skipped ${result.skippedCount}${skipped.length > 0 ? ` (${skipped.join(", ")})` : ""}.`
            : `Enqueued ${result.enqueuedCount} coworker(s) using the real scheduled trigger path.`,
        );
        setSelectedIds([]);
        void refetch();
      } catch (mutationError) {
        setActionError(toErrorMessage(mutationError, "Failed to enqueue scheduled coworkers."));
      }
    },
    [enqueueScheduled, refetch],
  );

  const handleEnqueue = useCallback(() => {
    void runEnqueue(selectedIds.length > 0 ? selectedIds : visibleIds);
  }, [runEnqueue, selectedIds, visibleIds]);

  const handleResetOnboarding = useCallback(async () => {
    setActionMessage(null);
    setActionError(null);

    try {
      await resetOnboarding.mutateAsync();
      void navigate({ to: "/onboarding/subscriptions" });
    } catch (err) {
      setActionError(toErrorMessage(err, "Failed to reset onboarding."));
    }
  }, [resetOnboarding, navigate]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Ops</h2>
        <p className="text-muted-foreground mt-1 text-sm">Admin-only operational tools.</p>
      </div>

      <section className="bg-card space-y-4 rounded-lg border p-6">
        <div className="space-y-2">
          <h3 className="text-base font-semibold">Scheduled Coworkers</h3>
          <p className="text-muted-foreground text-sm">
            Enqueue real <code>coworker:scheduled-trigger</code> jobs immediately to reproduce
            schedule-only runtime failures without waiting for the next hour.
          </p>
        </div>

        {(actionError || actionMessage) && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              actionError
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
            }`}
          >
            {actionError ?? actionMessage}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, username, or id"
            className="sm:max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" checked={hourlyOnly} onChange={handleHourlyOnlyChange} />
            Hourly only
          </label>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" checked={onOnly} onChange={handleOnOnlyChange} />
            Status on only
          </label>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Button type="button" variant="ghost" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleEnqueue}
              disabled={enqueueScheduled.isPending || visibleIds.length === 0}
            >
              {enqueueScheduled.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {selectedIds.length > 0
                ? `Enqueue ${selectedIds.length} selected`
                : "Enqueue all visible"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
            {toErrorMessage(error, "Failed to load scheduled coworkers.")}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
            No scheduled coworkers match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={handleToggleAll}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Coworker</th>
                  <th className="px-3 py-2 text-left font-medium">State</th>
                  <th className="px-3 py-2 text-left font-medium">Schedule</th>
                  <th className="px-3 py-2 text-left font-medium">Latest Run</th>
                  <th className="px-3 py-2 text-left font-medium">Latest Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        data-coworker-id={row.id}
                        checked={selectedIds.includes(row.id)}
                        onChange={handleSelectedCheckboxChange}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className="space-y-1 px-3 py-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-muted-foreground text-xs">{row.id}</div>
                      {row.username ? (
                        <div className="text-muted-foreground text-xs">@{row.username}</div>
                      ) : null}
                      <Link
                        to="/agents/edit/$id"
                        // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
                        params={{ id: row.id }}
                        className="inline-flex text-xs underline underline-offset-2"
                      >
                        Open builder
                      </Link>
                    </td>
                    <td className="space-y-1 px-3 py-3">
                      <div>{row.status}</div>
                      <div className="text-muted-foreground text-xs">
                        {row.isHourlyInterval ? "hourly interval" : "scheduled"}
                      </div>
                    </td>
                    <td className="space-y-1 px-3 py-3">
                      <div>{formatSchedule(row.schedule)}</div>
                      <div className="text-muted-foreground text-xs">
                        Updated {formatRelativeTime(row.updatedAt)}
                      </div>
                    </td>
                    <td className="space-y-1 px-3 py-3">
                      {row.latestRun ? (
                        <>
                          <div>{getCoworkerRunStatusLabel(row.latestRun.status)}</div>
                          <div className="text-muted-foreground text-xs">
                            {formatRelativeTime(row.latestRun.startedAt)}
                          </div>
                          <Link
                            to="/agents/runs/$id"
                            // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
                            params={{ id: row.latestRun.id }}
                            className="text-xs underline underline-offset-2"
                          >
                            Open run
                          </Link>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">No runs yet</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-muted-foreground max-w-sm text-xs">
                        {row.latestRun?.errorMessage ?? "—"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-card space-y-4 rounded-lg border p-6">
        <div className="space-y-2">
          <h3 className="text-base font-semibold">Onboarding</h3>
          <p className="text-muted-foreground text-sm">
            Clear your onboarding status and jump back into the onboarding flow from the start.
          </p>
        </div>

        <div className="rounded-lg border p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Reset current user onboarding</p>
              <p className="text-muted-foreground text-sm">
                Use this to re-run the onboarding experience on your current account.
              </p>
            </div>
            <Button onClick={handleResetOnboarding} disabled={resetOnboarding.isPending}>
              {resetOnboarding.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Reset my onboarding"
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
