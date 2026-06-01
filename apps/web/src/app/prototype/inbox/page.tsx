"use client";

// PROTOTYPE: Five user inbox directions for /prototype/inbox, switchable via ?variant=.
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  PanelRight,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import type { InboxItem, InboxItemStatus } from "@/components/inbox/types";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";
import { useCoworkerList, useInboxItems } from "@/orpc/hooks";

type UserInboxVariant = "workload" | "detail" | "modes" | "heatmap" | "sort";

type WorkspaceRunPage = Awaited<ReturnType<typeof client.coworker.listWorkspaceRuns>>;
type WorkspaceRun = WorkspaceRunPage["runs"][number];

type CoworkerSummary = {
  id: string;
  name?: string | null;
  username?: string | null;
};

type RunHealth = "blocked" | "failed" | "running" | "done" | "quiet";

type EnrichedRun = {
  id: string;
  status: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  errorMessage?: string | null;
  conversationId?: string | null;
  coworkerId?: string | null;
  coworkerName: string;
  coworkerUsername?: string | null;
  inboxItem?: Extract<InboxItem, { kind: "coworker" }>;
  health: RunHealth;
  startedAtDate: Date | null;
};

type CoworkerRunGroup = {
  key: string;
  coworkerName: string;
  coworkerUsername?: string | null;
  runs: EnrichedRun[];
  blockedCount: number;
  runningCount: number;
  failedCount: number;
  totalRuntimeMs: number;
  latestAt: Date | null;
};

const VARIANTS: Array<{ key: UserInboxVariant; label: string }> = [
  { key: "workload", label: "Workload rows" },
  { key: "detail", label: "Detail panel" },
  { key: "modes", label: "Inbox activity" },
  { key: "heatmap", label: "Time strips" },
  { key: "sort", label: "Sort modes" },
];

const INBOX_STATUSES: InboxItemStatus[] = [
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "error",
];

const RUNNING_STATUSES = new Set(["running", "queued", "pending", "waiting"]);
const BLOCKED_STATUSES = new Set([
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);
const FAILED_STATUSES = new Set(["error", "failed", "cancelled"]);
const DONE_STATUSES = new Set(["completed", "success"]);

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeOptionalDate(value?: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatRelative(value: Date | string | null | undefined): string {
  const date = normalizeOptionalDate(value);
  if (!date) {
    return "no timestamp";
  }

  const diffMin = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  if (diffD < 7) {
    return `${diffD}d ago`;
  }

  return date.toLocaleDateString();
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function getRunDurationMs(run: EnrichedRun): number {
  const startedAt = normalizeOptionalDate(run.startedAt);
  if (!startedAt) {
    return 0;
  }

  const finishedAt = normalizeOptionalDate(run.finishedAt);
  const endTime =
    finishedAt ?? (run.health === "running" || run.health === "blocked" ? new Date() : null);
  if (!endTime) {
    return 0;
  }

  return Math.max(0, endTime.getTime() - startedAt.getTime());
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function getCoworkerGroups(runs: EnrichedRun[]): CoworkerRunGroup[] {
  const map = new Map<string, EnrichedRun[]>();
  for (const run of runs) {
    const key = run.coworkerId ?? run.coworkerName;
    const group = map.get(key) ?? [];
    group.push(run);
    map.set(key, group);
  }

  return Array.from(map.entries()).map(([key, groupRuns]) => {
    const firstRun = groupRuns[0]!;
    return {
      key,
      coworkerName: firstRun.coworkerName,
      coworkerUsername: firstRun.coworkerUsername,
      runs: groupRuns,
      blockedCount: groupRuns.filter((run) => run.health === "blocked").length,
      runningCount: groupRuns.filter((run) => run.health === "running").length,
      failedCount: groupRuns.filter((run) => run.health === "failed").length,
      totalRuntimeMs: groupRuns.reduce((sum, run) => sum + getRunDurationMs(run), 0),
      latestAt: groupRuns[0]?.startedAtDate ?? null,
    };
  });
}

function normalizeInboxItem(item: InboxItem): InboxItem {
  if (item.kind === "coworker") {
    return {
      kind: "coworker",
      id: item.id,
      runId: item.runId,
      coworkerId: item.coworkerId,
      coworkerName: item.coworkerName,
      builderAvailable: item.builderAvailable,
      title: item.title,
      status: item.status,
      updatedAt: normalizeDate(item.updatedAt),
      createdAt: normalizeDate(item.createdAt),
      generationId: item.generationId,
      conversationId: item.conversationId,
      errorMessage: item.errorMessage,
      pauseReason: item.pauseReason,
      pendingApproval: item.pendingApproval,
      pendingAuth: item.pendingAuth,
    };
  }

  return {
    kind: "chat",
    id: item.id,
    conversationId: item.conversationId,
    conversationTitle: item.conversationTitle,
    title: item.title,
    status: item.status,
    updatedAt: normalizeDate(item.updatedAt),
    createdAt: normalizeDate(item.createdAt),
    generationId: item.generationId,
    errorMessage: item.errorMessage,
    pauseReason: item.pauseReason,
    pendingApproval: item.pendingApproval,
    pendingAuth: item.pendingAuth,
  };
}

function getRunHealth(
  run: WorkspaceRun,
  inboxItem?: Extract<InboxItem, { kind: "coworker" }>,
): RunHealth {
  if (inboxItem && BLOCKED_STATUSES.has(inboxItem.status)) {
    return "blocked";
  }
  if (FAILED_STATUSES.has(run.status)) {
    return "failed";
  }
  if (RUNNING_STATUSES.has(run.status)) {
    return "running";
  }
  if (DONE_STATUSES.has(run.status)) {
    return "done";
  }
  return "quiet";
}

function runReason(run: EnrichedRun): string {
  return (
    run.inboxItem?.pauseReason ||
    run.inboxItem?.errorMessage ||
    run.errorMessage ||
    run.inboxItem?.title ||
    statusLabel(run.status)
  );
}

function useWorkspaceCoworkerRuns() {
  return useInfiniteQuery({
    queryKey: ["prototype", "user", "workspace-coworker-runs"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.coworker.listWorkspaceRuns({
        limit: 100,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.runs.some((run) => RUNNING_STATUSES.has(run.status) || run.status === "paused"),
      )
        ? 5_000
        : false,
  });
}

function useUserRunsData() {
  const inboxQuery = useInboxItems({
    limit: 20,
    type: "all",
    statuses: INBOX_STATUSES,
  });
  const runsQuery = useWorkspaceCoworkerRuns();
  const coworkersQuery = useCoworkerList();

  const inboxItems = useMemo(
    () => ((inboxQuery.data?.items ?? []) as InboxItem[]).map(normalizeInboxItem),
    [inboxQuery.data?.items],
  );
  const coworkerInboxByRunId = useMemo(() => {
    const map = new Map<string, Extract<InboxItem, { kind: "coworker" }>>();
    for (const item of inboxItems) {
      if (item.kind === "coworker") {
        map.set(item.runId, item);
      }
    }
    return map;
  }, [inboxItems]);
  const coworkerById = useMemo(() => {
    const map = new Map<string, CoworkerSummary>();
    for (const coworker of (coworkersQuery.data ?? []) as CoworkerSummary[]) {
      map.set(coworker.id, coworker);
    }
    return map;
  }, [coworkersQuery.data]);
  const runs = useMemo(
    () => runsQuery.data?.pages.flatMap((page) => page.runs) ?? [],
    [runsQuery.data],
  );
  const enrichedRuns = useMemo<EnrichedRun[]>(
    () =>
      runs.map((run) => {
        const coworker = run.coworkerId ? coworkerById.get(run.coworkerId) : undefined;
        const inboxItem = coworkerInboxByRunId.get(run.id);
        const coworkerName = getCoworkerDisplayName(coworker?.name ?? run.coworkerName);
        return {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errorMessage: run.errorMessage,
          conversationId: run.conversationId,
          coworkerId: run.coworkerId,
          coworkerName,
          coworkerUsername: coworker?.username,
          inboxItem,
          health: getRunHealth(run, inboxItem),
          startedAtDate: normalizeOptionalDate(run.startedAt),
        };
      }),
    [coworkerById, coworkerInboxByRunId, runs],
  );

  return {
    runs: enrichedRuns,
    inboxItems,
    isLoading: inboxQuery.isLoading || runsQuery.isLoading || coworkersQuery.isLoading,
    isFetchingRuns: runsQuery.isFetching,
    hasMoreRuns: runsQuery.hasNextPage,
    loadMoreRuns: runsQuery.fetchNextPage,
    isLoadingMoreRuns: runsQuery.isFetchingNextPage,
  };
}

function HealthPill({ run }: { run: EnrichedRun }) {
  const Icon =
    run.health === "blocked"
      ? ShieldQuestion
      : run.health === "failed"
        ? XCircle
        : run.health === "running"
          ? Loader2
          : run.health === "done"
            ? CheckCircle2
            : Clock3;
  const label =
    run.health === "blocked" && run.inboxItem
      ? statusLabel(run.inboxItem.status)
      : statusLabel(run.status);

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium capitalize",
        run.health === "blocked" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        run.health === "failed" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        run.health === "running" &&
          "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        run.health === "done" &&
          "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300",
        run.health === "quiet" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className={cn("size-3", run.health === "running" && "animate-spin")} />
      {label}
    </span>
  );
}

function GroupStatePill({ group }: { group: CoworkerRunGroup }) {
  const status =
    group.blockedCount > 0
      ? `${group.blockedCount} blocked`
      : group.failedCount > 0
        ? `${group.failedCount} failed`
        : group.runningCount > 0
          ? `${group.runningCount} running`
          : "clear";

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
        group.blockedCount > 0 &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        group.blockedCount === 0 &&
          group.failedCount > 0 &&
          "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        group.blockedCount === 0 &&
          group.failedCount === 0 &&
          group.runningCount > 0 &&
          "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        group.blockedCount === 0 &&
          group.failedCount === 0 &&
          group.runningCount === 0 &&
          "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function RunRow({ run, selected = false }: { run: EnrichedRun; selected?: boolean }) {
  return (
    <Link
      href={`/coworkers/runs/${run.id}`}
      prefetch={false}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5",
        "transition-colors hover:border-foreground/20 hover:bg-muted/40",
        run.health === "blocked" && "border-amber-500/30 bg-amber-500/[0.04]",
        run.health === "failed" && "border-red-500/25 bg-red-500/[0.04]",
        selected && "border-foreground/30 bg-muted/50",
      )}
    >
      <CoworkerAvatar
        username={run.coworkerUsername ?? run.coworkerName}
        size={34}
        className="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="truncate text-sm font-medium">{run.coworkerName}</p>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {formatRelative(run.startedAtDate)}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">{runReason(run)}</p>
      </div>
      <HealthPill run={run} />
    </Link>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function GroupIdentity({ group, size = 36 }: { group: CoworkerRunGroup; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CoworkerAvatar
        username={group.coworkerUsername ?? group.coworkerName}
        size={size}
        className="rounded-full"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{group.coworkerName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {group.runs.length} runs · latest {formatRelative(group.latestAt)}
        </p>
      </div>
    </div>
  );
}

function PrototypeStatePanel({
  variant,
  inboxCount,
  runCount,
  blockedCount,
}: {
  variant: UserInboxVariant;
  inboxCount: number;
  runCount: number;
  blockedCount: number;
}) {
  return (
    <div className="bg-muted/40 text-muted-foreground rounded-lg border p-3 font-mono text-[11px] leading-5">
      <div>prototype.variant: {variant}</div>
      <div>inbox.items: {inboxCount}</div>
      <div>coworker.runs: {runCount}</div>
      <div>blocked.runs: {blockedCount}</div>
    </div>
  );
}

function EmptyRuns() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">No coworker runs yet</p>
      <p className="text-muted-foreground mt-1 text-xs">Runs will appear here as the inbox.</p>
    </div>
  );
}

function PageIntro({
  title,
  body,
  variant,
  inboxItems,
  runs,
}: {
  title: string;
  body: string;
  variant: UserInboxVariant;
  inboxItems: InboxItem[];
  runs: EnrichedRun[];
}) {
  const blockedCount = runs.filter(
    (run) => run.health === "blocked" || run.health === "failed",
  ).length;

  return (
    <div className="grid gap-4 border-b pb-5 md:grid-cols-[1fr_240px]">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Prototype inbox
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">{body}</p>
      </div>
      <PrototypeStatePanel
        variant={variant}
        inboxCount={inboxItems.length}
        runCount={runs.length}
        blockedCount={blockedCount}
      />
    </div>
  );
}

function WorkloadMeter({ runtimeMs, maxRuntimeMs }: { runtimeMs: number; maxRuntimeMs: number }) {
  const percent = maxRuntimeMs > 0 ? Math.max(6, Math.round((runtimeMs / maxRuntimeMs) * 100)) : 0;
  const widthStyle = useMemo<CSSProperties>(() => ({ width: `${percent}%` }), [percent]);

  return (
    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
      <div className="bg-foreground/70 h-full rounded-full" style={widthStyle} />
    </div>
  );
}

function VariantWorkload({ runs, inboxItems }: { runs: EnrichedRun[]; inboxItems: InboxItem[] }) {
  const groups = useMemo(
    () =>
      getCoworkerGroups(runs).toSorted((left, right) => {
        const leftAttention = left.blockedCount + left.failedCount;
        const rightAttention = right.blockedCount + right.failedCount;
        if (leftAttention !== rightAttention) {
          return rightAttention - leftAttention;
        }
        return right.totalRuntimeMs - left.totalRuntimeMs;
      }),
    [runs],
  );
  const maxRuntimeMs = Math.max(...groups.map((group) => group.totalRuntimeMs), 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageIntro
        title="Coworker workload"
        body="Compact rows stay organized by coworker, with a light sense of run volume and runtime."
        variant="workload"
        inboxItems={inboxItems}
        runs={runs}
      />
      {groups.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <div
            className={cn(
              "bg-muted/35 text-muted-foreground grid gap-3 px-3 py-2 text-[11px] font-medium",
              "grid-cols-[1fr_120px_150px_120px]",
            )}
          >
            <span>Coworker</span>
            <span className="hidden sm:block">Runs</span>
            <span className="hidden md:block">Runtime</span>
            <span className="text-right">State</span>
          </div>
          {groups.map((group) => {
            const attentionRun =
              group.runs.find((run) => run.health === "blocked" || run.health === "failed") ??
              group.runs[0]!;

            return (
              <div
                key={group.key}
                className={cn(
                  "grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 border-t px-3 py-2",
                  "md:grid-cols-[1fr_120px_150px_120px]",
                )}
              >
                <GroupIdentity group={group} size={36} />
                <div className="hidden sm:block">
                  <p className="text-sm font-medium tabular-nums">{group.runs.length}</p>
                  <p className="text-muted-foreground text-[11px]">{group.runningCount} running</p>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium tabular-nums">
                      {formatDuration(group.totalRuntimeMs)}
                    </span>
                  </div>
                  <WorkloadMeter runtimeMs={group.totalRuntimeMs} maxRuntimeMs={maxRuntimeMs} />
                </div>
                <div className="flex items-center justify-end">
                  <HealthPill run={attentionRun} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyRuns />
      )}
    </main>
  );
}

function VariantDetail({ runs, inboxItems }: { runs: EnrichedRun[]; inboxItems: InboxItem[] }) {
  const searchParams = useSearchParams();
  const groups = useMemo(() => getCoworkerGroups(runs), [runs]);
  const selectedGroup =
    groups.find((group) => group.key === searchParams.get("coworker")) ?? groups[0];
  const selectedRun =
    selectedGroup?.runs.find((run) => run.health === "blocked" || run.health === "failed") ??
    selectedGroup?.runs[0];

  return (
    <main className="grid min-h-full grid-cols-1 lg:grid-cols-[380px_1fr]">
      <section className="border-b p-4 md:p-6 lg:border-r lg:border-b-0">
        <div className="mb-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Prototype inbox
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Coworker detail</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            The list stays compact. Runtime details move to the selected coworker.
          </p>
        </div>
        <div className="space-y-2">
          {groups.length > 0 ? (
            groups.map((group) => (
              <Link
                key={group.key}
                href={`/prototype/inbox?variant=detail&coworker=${encodeURIComponent(group.key)}`}
                className={cn(
                  "flex min-w-0 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted",
                  selectedGroup?.key === group.key && "bg-muted ring-1 ring-border",
                )}
              >
                <CoworkerAvatar
                  username={group.coworkerUsername ?? group.coworkerName}
                  size={32}
                  className="rounded-full"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.coworkerName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {group.runs.length} runs · {formatDuration(group.totalRuntimeMs)}
                  </p>
                </div>
                {group.blockedCount + group.failedCount > 0 ? (
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {group.blockedCount + group.failedCount}
                  </span>
                ) : null}
              </Link>
            ))
          ) : (
            <EmptyRuns />
          )}
        </div>
      </section>
      <section className="p-4 md:p-8">
        {selectedGroup && selectedRun ? (
          <div className="mx-auto max-w-2xl space-y-5">
            <PageIntro
              title={selectedGroup.coworkerName}
              body="Runtime totals, blocked work, and the runs behind the numbers."
              variant="detail"
              inboxItems={inboxItems}
              runs={runs}
            />
            <div className="bg-card rounded-lg border">
              <div className="flex items-start justify-between gap-4 border-b p-5">
                <GroupIdentity group={selectedGroup} size={44} />
                <GroupStatePill group={selectedGroup} />
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-3">
                <MetricTile label="Blocked" value={selectedGroup.blockedCount} />
                <MetricTile label="Running" value={selectedGroup.runningCount} />
                <MetricTile label="Runtime" value={formatDuration(selectedGroup.totalRuntimeMs)} />
              </div>
              <div className="space-y-2 border-t p-5">
                {selectedGroup.runs.slice(0, 6).map((run) => (
                  <RunRow key={run.id} run={run} selected={run.id === selectedRun.id} />
                ))}
              </div>
              <div className="border-t p-5">
                <Link
                  href={`/coworkers/runs/${selectedRun.id}`}
                  prefetch={false}
                  className={cn(
                    "hover:bg-muted inline-flex items-center gap-2 rounded-md border",
                    "px-3 py-2 text-xs font-medium",
                  )}
                >
                  <PanelRight className="size-3.5" />
                  Open selected run
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <EmptyRuns />
        )}
      </section>
    </main>
  );
}

function MiniRunList({ runs }: { runs: EnrichedRun[] }) {
  return (
    <div className="space-y-2">
      {runs.length > 0 ? (
        runs.slice(0, 5).map((run) => <RunRow key={run.id} run={run} />)
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs">No runs</p>
      )}
    </div>
  );
}

function VariantModes({ runs, inboxItems }: { runs: EnrichedRun[]; inboxItems: InboxItem[] }) {
  const blockedRuns = useMemo(
    () => runs.filter((run) => run.health === "blocked" || run.health === "failed"),
    [runs],
  );
  const runningRuns = useMemo(() => runs.filter((run) => run.health === "running"), [runs]);
  const recentDoneRuns = useMemo(
    () => runs.filter((run) => run.health === "done" || run.health === "quiet"),
    [runs],
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageIntro
        title="Inbox and activity"
        body="Attention, active work, and recent completion in separate review zones."
        variant="modes"
        inboxItems={inboxItems}
        runs={runs}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <section className="bg-card rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Attention</h2>
              <p className="text-muted-foreground text-xs">Blocked or failed runs</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{blockedRuns.length}</span>
          </div>
          <div className="p-3">
            <MiniRunList runs={blockedRuns} />
          </div>
        </section>
        <div className="grid gap-4">
          <section className="bg-card rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Running</h2>
                <p className="text-muted-foreground text-xs">Currently active</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{runningRuns.length}</span>
            </div>
            <div className="p-3">
              <MiniRunList runs={runningRuns} />
            </div>
          </section>
          <section className="bg-card rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Finished</h2>
                <p className="text-muted-foreground text-xs">Recently completed or quiet</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{recentDoneRuns.length}</span>
            </div>
            <div className="p-3">
              <MiniRunList runs={recentDoneRuns} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function RuntimeStrip({ run }: { run: EnrichedRun }) {
  const durationMs = getRunDurationMs(run);
  const width = Math.max(8, Math.min(100, Math.round(durationMs / 600_000) * 8));
  const widthStyle = useMemo<CSSProperties>(() => ({ width }), [width]);

  return (
    <span
      className={cn(
        "inline-block h-2 rounded-full",
        run.health === "blocked" && "bg-amber-500",
        run.health === "failed" && "bg-red-500",
        run.health === "running" && "bg-blue-500",
        run.health === "done" && "bg-green-500",
        run.health === "quiet" && "bg-muted-foreground/30",
      )}
      style={widthStyle}
    />
  );
}

function VariantHeatmap({ runs, inboxItems }: { runs: EnrichedRun[]; inboxItems: InboxItem[] }) {
  const groups = useMemo(() => getCoworkerGroups(runs), [runs]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageIntro
        title="Runtime strips"
        body="Coworker rows with compact run-duration marks."
        variant="heatmap"
        inboxItems={inboxItems}
        runs={runs}
      />
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" />
          Blocked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-500" />
          Running
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-green-500" />
          Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-muted-foreground/30 size-2 rounded-full" />
          Quiet
        </span>
      </div>
      <div className="divide-y rounded-lg border">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.key} className="grid gap-3 px-3 py-3 md:grid-cols-[220px_1fr_90px]">
              <GroupIdentity group={group} size={32} />
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                {group.runs.slice(0, 18).map((run) => (
                  <Link key={run.id} href={`/coworkers/runs/${run.id}`} prefetch={false}>
                    <RuntimeStrip run={run} />
                  </Link>
                ))}
              </div>
              <p className="text-muted-foreground text-xs md:text-right">
                {formatRelative(group.latestAt)}
              </p>
            </div>
          ))
        ) : (
          <EmptyRuns />
        )}
      </div>
    </main>
  );
}

function VariantSort({ runs, inboxItems }: { runs: EnrichedRun[]; inboxItems: InboxItem[] }) {
  const groups = useMemo(() => getCoworkerGroups(runs), [runs]);
  const byAttention = useMemo(
    () =>
      groups.toSorted(
        (left, right) =>
          right.blockedCount + right.failedCount - (left.blockedCount + left.failedCount),
      ),
    [groups],
  );
  const byRuntime = useMemo(
    () => groups.toSorted((left, right) => right.totalRuntimeMs - left.totalRuntimeMs),
    [groups],
  );
  const byLatest = useMemo(
    () =>
      groups.toSorted(
        (left, right) => (right.latestAt?.getTime() ?? 0) - (left.latestAt?.getTime() ?? 0),
      ),
    [groups],
  );

  const renderGroup = (group: CoworkerRunGroup) => (
    <div key={group.key} className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2">
      <CoworkerAvatar
        username={group.coworkerUsername ?? group.coworkerName}
        size={30}
        className="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{group.coworkerName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {group.runs.length} runs · {formatDuration(group.totalRuntimeMs)}
        </p>
      </div>
      {group.blockedCount + group.failedCount > 0 ? (
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {group.blockedCount + group.failedCount}
        </span>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageIntro
        title="Sort modes"
        body="The same compact coworker row, ordered by the user's current question."
        variant="sort"
        inboxItems={inboxItems}
        runs={runs}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="bg-card rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <p className="text-muted-foreground text-xs">Blocked and failed first</p>
          </div>
          <div className="space-y-2 p-3">{byAttention.slice(0, 6).map(renderGroup)}</div>
        </section>
        <section className="bg-card rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Most runtime</h2>
            <p className="text-muted-foreground text-xs">Highest cumulative work</p>
          </div>
          <div className="space-y-2 p-3">{byRuntime.slice(0, 6).map(renderGroup)}</div>
        </section>
        <section className="bg-card rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Latest activity</h2>
            <p className="text-muted-foreground text-xs">Most recently touched</p>
          </div>
          <div className="space-y-2 p-3">{byLatest.slice(0, 6).map(renderGroup)}</div>
        </section>
      </div>
    </main>
  );
}

function PrototypeSwitcher({ current }: { current: UserInboxVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentIndex = VARIANTS.findIndex((variant) => variant.key === current);
  const currentLabel = VARIANTS[currentIndex]?.label ?? VARIANTS[0].label;
  const selectVariant = useCallback(
    (offset: number) => {
      const nextIndex = (currentIndex + offset + VARIANTS.length) % VARIANTS.length;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("variant", VARIANTS[nextIndex].key);
      nextParams.delete("runId");
      nextParams.delete("coworker");
      router.replace(`${pathname}?${nextParams.toString()}`);
    },
    [currentIndex, pathname, router, searchParams],
  );
  const selectPrevious = useCallback(() => selectVariant(-1), [selectVariant]);
  const selectNext = useCallback(() => selectVariant(1), [selectVariant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        selectPrevious();
      }
      if (event.key === "ArrowRight") {
        selectNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectNext, selectPrevious]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div
      className={cn(
        "bg-foreground text-background fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2",
        "items-center gap-2 rounded-full border px-2 py-2 shadow-lg",
      )}
    >
      <button
        type="button"
        onClick={selectPrevious}
        className="hover:bg-background/15 flex size-8 items-center justify-center rounded-full"
        aria-label="Previous prototype variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="min-w-[170px] text-center text-xs font-medium">
        {current.toUpperCase()} - {currentLabel}
      </div>
      <button
        type="button"
        onClick={selectNext}
        className="hover:bg-background/15 flex size-8 items-center justify-center rounded-full"
        aria-label="Next prototype variant"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export default function UserInboxPage() {
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant");
  const variant = VARIANTS.some((entry) => entry.key === rawVariant)
    ? (rawVariant as UserInboxVariant)
    : "detail";
  const {
    runs,
    inboxItems,
    isLoading,
    isFetchingRuns,
    hasMoreRuns,
    loadMoreRuns,
    isLoadingMoreRuns,
  } = useUserRunsData();
  const handleLoadMoreRuns = useCallback(() => {
    void loadMoreRuns();
  }, [loadMoreRuns]);

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-full pb-24">
      {variant === "workload" ? <VariantWorkload runs={runs} inboxItems={inboxItems} /> : null}
      {variant === "detail" ? <VariantDetail runs={runs} inboxItems={inboxItems} /> : null}
      {variant === "modes" ? <VariantModes runs={runs} inboxItems={inboxItems} /> : null}
      {variant === "heatmap" ? <VariantHeatmap runs={runs} inboxItems={inboxItems} /> : null}
      {variant === "sort" ? <VariantSort runs={runs} inboxItems={inboxItems} /> : null}
      <div className="mx-auto flex w-full max-w-4xl justify-center px-4 pb-6">
        {hasMoreRuns ? (
          <button
            type="button"
            onClick={handleLoadMoreRuns}
            disabled={isLoadingMoreRuns}
            className={cn(
              "text-muted-foreground hover:text-foreground inline-flex items-center gap-2",
              "rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-60",
            )}
          >
            {isLoadingMoreRuns ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            Load older coworker runs
          </button>
        ) : isFetchingRuns ? (
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Refreshing runs
          </span>
        ) : null}
      </div>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
