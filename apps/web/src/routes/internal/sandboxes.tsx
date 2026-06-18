import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAdminKillSandbox, useAdminListSandboxes } from "@/orpc/hooks/admin";
import {
  EnvironmentBadge,
  KillButton,
  ProviderFilterButton,
  ProviderPill,
  SortableHeader,
} from "./-sandboxes/components";
import {
  formatRelativeTime,
  formatUptime,
  getEnvBaseUrl,
  getSortValue,
  truncateId,
  type ConfirmState,
  type Provider,
  type SandboxRow,
  type SortDir,
  type SortKey,
} from "./-sandboxes/shared";
import { UsageChart } from "./-sandboxes/usage-chart";

export const Route = createFileRoute("/internal/sandboxes")({
  head: () => ({ meta: [{ title: "Sandboxes - Bap" }] }),
  component: AdminSandboxesPage,
});

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PROVIDER_FILTERS: Array<{ key: "all" | Provider; label: string }> = [
  { key: "all", label: "All" },
  { key: "e2b", label: "E2B" },
  { key: "daytona", label: "Daytona" },
];

function AdminSandboxesPage() {
  const { data, isLoading, error, refetch } = useAdminListSandboxes();
  const killMutation = useAdminKillSandbox();
  const [killingId, setKillingId] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("startedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [providerFilter, setProviderFilter] = useState<"all" | Provider>("all");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const confirmActionRef = useRef<(() => Promise<void>) | null>(null);

  const rawSandboxes = useMemo(() => (data?.sandboxes ?? []) as SandboxRow[], [data]);

  const filteredSandboxes = useMemo(
    () =>
      providerFilter === "all"
        ? rawSandboxes
        : rawSandboxes.filter((s) => s.provider === providerFilter),
    [rawSandboxes, providerFilter],
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const sandboxes = useMemo(() => {
    const sorted = filteredSandboxes.toSorted((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (aVal < bVal) {
        return sortDir === "asc" ? -1 : 1;
      }
      if (aVal > bVal) {
        return sortDir === "asc" ? 1 : -1;
      }
      return 0;
    });
    return sorted;
  }, [filteredSandboxes, sortKey, sortDir]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleKill = useCallback(
    (sandboxId: string, provider: Provider) => {
      const action = async () => {
        setKillingId(sandboxId);
        try {
          await killMutation.mutateAsync({ sandboxId, provider });
        } finally {
          setKillingId(null);
        }
      };
      confirmActionRef.current = action;
      setConfirm({
        title: "Kill sandbox",
        description: `This will terminate ${provider.toUpperCase()} sandbox ${sandboxId}. This action cannot be undone.`,
        action,
      });
    },
    [killMutation],
  );

  const handleKillAll = useCallback(() => {
    const targets = filteredSandboxes;
    const count = targets.length;
    const label =
      providerFilter === "all" ? "across all providers" : `on ${providerFilter.toUpperCase()}`;
    const action = async () => {
      setKillingAll(true);
      try {
        await Promise.allSettled(
          targets.map((s) =>
            killMutation.mutateAsync({ sandboxId: s.sandboxId, provider: s.provider }),
          ),
        );
      } finally {
        setKillingAll(false);
      }
    };
    confirmActionRef.current = action;
    setConfirm({
      title: "Kill all sandboxes",
      description: `This will terminate all ${count} sandboxes ${label}. This action cannot be undone.`,
      action,
    });
  }, [filteredSandboxes, providerFilter, killMutation]);

  const handleConfirm = useCallback(() => {
    const action = confirmActionRef.current;
    setConfirm(null);
    confirmActionRef.current = null;
    if (action) {
      void action();
    }
  }, []);

  const handleCancel = useCallback(() => {
    setConfirm(null);
    confirmActionRef.current = null;
  }, []);

  const runningCount = sandboxes.filter((s) => s.state === "running").length;
  const pausedCount = sandboxes.filter((s) => s.state === "paused").length;
  const errorCount = sandboxes.filter((s) => s.state === "error").length;

  const providerCounts = useMemo(() => {
    const counts: Record<Provider, number> = { e2b: 0, daytona: 0 };
    for (const s of rawSandboxes) {
      counts[s.provider] = (counts[s.provider] ?? 0) + 1;
    }
    return counts;
  }, [rawSandboxes]);

  const envCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sandboxes) {
      const env = s.environment ?? "unknown";
      counts[env] = (counts[env] ?? 0) + 1;
    }
    return counts;
  }, [sandboxes]);

  return (
    <div>
      <AlertDialog open={confirm !== null} onOpenChange={handleCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Kill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            Sandboxes{" "}
            {!isLoading && (
              <span className="text-muted-foreground text-base font-normal">
                ({sandboxes.length}
                {providerFilter !== "all" ? ` / ${rawSandboxes.length}` : ""})
              </span>
            )}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Live sandboxes across E2B and Daytona, with rolling credit burn.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          {sandboxes.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleKillAll} disabled={killingAll}>
              {killingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Kill {providerFilter === "all" ? "all" : providerFilter.toUpperCase()}
            </Button>
          )}
        </div>
      </div>

      <UsageChart />

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-lg border p-3 text-sm">
          {error instanceof Error ? error.message : "Failed to load sandboxes."}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="bg-muted/60 flex items-center rounded-md p-0.5 text-xs">
          {PROVIDER_FILTERS.map((opt) => {
            const badgeCount =
              opt.key === "all" ? rawSandboxes.length : (providerCounts[opt.key] ?? 0);
            return (
              <ProviderFilterButton
                key={opt.key}
                filterKey={opt.key}
                label={opt.label}
                count={badgeCount}
                active={providerFilter === opt.key}
                onSelect={setProviderFilter}
              />
            );
          })}
        </div>

        {!isLoading && sandboxes.length > 0 && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-green-600 dark:text-green-400">{runningCount} running</span>
            {pausedCount > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400">{pausedCount} paused</span>
            )}
            {errorCount > 0 && (
              <span className="text-red-600 dark:text-red-400">{errorCount} error</span>
            )}
            <span className="text-muted-foreground">|</span>
            {Object.entries(envCounts).map(([env, count]) => (
              <span key={env} className="inline-flex items-center gap-1">
                <EnvironmentBadge env={env} />
                <span className="tabular-nums">{count}</span>
              </span>
            ))}
          </>
        )}
      </div>

      <div className="bg-card rounded-lg border">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : sandboxes.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            No sandboxes running.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <SortableHeader
                    label="Provider"
                    sortKey="provider"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Sandbox ID"
                    sortKey="sandboxId"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Env"
                    sortKey="environment"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="State"
                    sortKey="state"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Started"
                    sortKey="startedAt"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <th className="px-4 py-3 text-left font-medium">Uptime</th>
                  <SortableHeader
                    label="User"
                    sortKey="userEmail"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Details"
                    sortKey="details"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sandboxes.map((s) => (
                  <tr
                    key={`${s.provider}:${s.sandboxId}`}
                    className="hover:bg-muted/50 border-b last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <ProviderPill provider={s.provider} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" title={s.sandboxId}>
                      {truncateId(s.sandboxId)}
                    </td>
                    <td className="px-4 py-3">
                      <EnvironmentBadge env={s.environment} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                          s.state === "running"
                            ? "bg-green-500/10 text-green-700 dark:text-green-400"
                            : s.state === "paused"
                              ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                              : s.state === "error"
                                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                                : "bg-gray-500/10 text-gray-700 dark:text-gray-400",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            s.state === "running"
                              ? "bg-green-500"
                              : s.state === "paused"
                                ? "bg-yellow-500"
                                : s.state === "error"
                                  ? "bg-red-500"
                                  : "bg-gray-500",
                          )}
                        />
                        {s.state}
                      </span>
                    </td>
                    <td className="px-4 py-3">{formatRelativeTime(s.startedAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatUptime(s.startedAt)}</td>
                    <td className="px-4 py-3">
                      {s.userEmail ? (
                        <span title={s.userName ?? undefined}>{s.userEmail}</span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.conversationType === "coworker" ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-muted-foreground text-xs">coworker</span>
                          {(s.coworkerUsername || s.coworkerName) && s.coworkerId ? (
                            <a
                              href={`${getEnvBaseUrl(s.environment)}/agents/edit/${s.coworkerId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:opacity-70"
                            >
                              {s.coworkerUsername ? `@${s.coworkerUsername}` : s.coworkerName}
                              {s.coworkerTriggerType && (
                                <span className="text-muted-foreground text-xs">
                                  ({s.coworkerTriggerType})
                                </span>
                              )}
                              <ExternalLink className="text-muted-foreground h-3 w-3 shrink-0" />
                            </a>
                          ) : null}
                        </span>
                      ) : s.conversationType === "chat" ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-muted-foreground text-xs">chat</span>
                          {s.conversationId ? (
                            <a
                              href={`${getEnvBaseUrl(s.environment)}/chat/${s.conversationId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:opacity-70"
                            >
                              {s.conversationTitle ?? "Untitled"}
                              <ExternalLink className="text-muted-foreground h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span>{s.conversationTitle ?? ""}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <KillButton
                        sandboxId={s.sandboxId}
                        provider={s.provider}
                        isKilling={killingId === s.sandboxId}
                        onKill={handleKill}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
