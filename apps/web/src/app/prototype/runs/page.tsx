"use client";

// PROTOTYPE: Four all-coworker run views for /prototype/runs, switchable via ?variant=.
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Columns3,
  LayoutList,
  Loader2,
  Rows3,
  Search,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Input } from "@/components/ui/input";
import { client } from "@/orpc/client";
import { cn } from "@/lib/utils";

type RunPage = Awaited<ReturnType<typeof client.coworker.listWorkspaceRuns>>;
type WorkspaceRun = RunPage["runs"][number];
type RunsVariant = "latest" | "coworker" | "attention" | "lanes";
type RunTone = "active" | "blocked" | "failed" | "done" | "quiet";

type RunItem = WorkspaceRun & {
  tone: RunTone;
  startedAtDate: Date | null;
  finishedAtDate: Date | null;
  durationMs: number;
};

type CoworkerGroup = {
  key: string;
  name: string;
  runs: RunItem[];
  latestAt: Date | null;
  activeCount: number;
  blockedCount: number;
  failedCount: number;
  durationMs: number;
};

const VARIANTS: Array<{ key: RunsVariant; label: string; icon: typeof LayoutList }> = [
  { key: "latest", label: "Latest runs", icon: LayoutList },
  { key: "coworker", label: "By coworker", icon: Rows3 },
  { key: "attention", label: "Needs attention", icon: AlertTriangle },
  { key: "lanes", label: "Status lanes", icon: Columns3 },
];

const ACTIVE_STATUSES = new Set(["running", "queued", "pending"]);
const BLOCKED_STATUSES = new Set(["awaiting_approval", "awaiting_auth", "paused"]);
const FAILED_STATUSES = new Set(["error", "failed", "cancelled"]);
const DONE_STATUSES = new Set(["completed", "success"]);

function normalizeDate(value?: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatRelative(value?: Date | string | null): string {
  const date = normalizeDate(value);
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

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function getRunTone(status: string): RunTone {
  if (BLOCKED_STATUSES.has(status)) {
    return "blocked";
  }
  if (FAILED_STATUSES.has(status)) {
    return "failed";
  }
  if (ACTIVE_STATUSES.has(status)) {
    return "active";
  }
  if (DONE_STATUSES.has(status)) {
    return "done";
  }
  return "quiet";
}

function getRunDurationMs(startedAt: Date | null, finishedAt: Date | null, tone: RunTone): number {
  if (!startedAt) {
    return 0;
  }

  const endAt = finishedAt ?? (tone === "active" || tone === "blocked" ? new Date() : null);
  return endAt ? Math.max(0, endAt.getTime() - startedAt.getTime()) : 0;
}

function enrichRun(run: WorkspaceRun): RunItem {
  const tone = getRunTone(run.status);
  const startedAtDate = normalizeDate(run.startedAt);
  const finishedAtDate = normalizeDate(run.finishedAt);

  return {
    ...run,
    tone,
    startedAtDate,
    finishedAtDate,
    durationMs: getRunDurationMs(startedAtDate, finishedAtDate, tone),
  };
}

function sortRuns(runs: RunItem[]): RunItem[] {
  return runs.toSorted(
    (left, right) => (right.startedAtDate?.getTime() ?? 0) - (left.startedAtDate?.getTime() ?? 0),
  );
}

function groupByCoworker(runs: RunItem[]): CoworkerGroup[] {
  const map = new Map<string, RunItem[]>();

  for (const run of runs) {
    const key = run.coworkerId ?? run.coworkerName;
    map.set(key, [...(map.get(key) ?? []), run]);
  }

  return Array.from(map.entries())
    .map(([key, groupRuns]) => {
      const sorted = sortRuns(groupRuns);
      const firstRun = sorted[0];

      return {
        key,
        name: firstRun?.coworkerName ?? "Untitled",
        runs: sorted,
        latestAt: firstRun?.startedAtDate ?? null,
        activeCount: sorted.filter((run) => run.tone === "active").length,
        blockedCount: sorted.filter((run) => run.tone === "blocked").length,
        failedCount: sorted.filter((run) => run.tone === "failed").length,
        durationMs: sorted.reduce((sum, run) => sum + run.durationMs, 0),
      };
    })
    .toSorted((left, right) => (right.latestAt?.getTime() ?? 0) - (left.latestAt?.getTime() ?? 0));
}

function useWorkspaceRuns() {
  const query = useInfiniteQuery({
    queryKey: ["prototype", "runs", "workspace"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.coworker.listWorkspaceRuns({
        limit: 100,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: (queryState) =>
      queryState.state.data?.pages.some((page) =>
        page.runs.some(
          (run) => ACTIVE_STATUSES.has(run.status) || BLOCKED_STATUSES.has(run.status),
        ),
      )
        ? 5_000
        : false,
  });

  const runs = useMemo(
    () => sortRuns((query.data?.pages.flatMap((page) => page.runs) ?? []).map(enrichRun)),
    [query.data],
  );

  return { ...query, runs };
}

function HealthPill({ run }: { run: RunItem }) {
  const Icon =
    run.tone === "blocked"
      ? AlertTriangle
      : run.tone === "failed"
        ? XCircle
        : run.tone === "active"
          ? Loader2
          : run.tone === "done"
            ? CheckCircle2
            : Clock3;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium capitalize",
        run.tone === "blocked" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        run.tone === "failed" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        run.tone === "active" &&
          "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        run.tone === "done" &&
          "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300",
        run.tone === "quiet" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className={cn("size-3", run.tone === "active" && "animate-spin")} />
      {statusLabel(run.status)}
    </span>
  );
}

function RunRow({ run, dense = false }: { run: RunItem; dense?: boolean }) {
  return (
    <Link
      href={`/coworkers/runs/${run.id}`}
      prefetch={false}
      className={cn(
        "group grid min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
        "hover:border-foreground/20 hover:bg-muted/40",
        dense
          ? "grid-cols-[1fr_auto]"
          : "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1fr_120px_120px_auto]",
        run.tone === "blocked" && "border-amber-500/25 bg-amber-500/[0.04]",
        run.tone === "failed" && "border-red-500/25 bg-red-500/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <CoworkerAvatar username={run.coworkerName} size={34} className="rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{run.coworkerName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {run.errorMessage ?? `Run ${run.id.slice(0, 8)}`}
          </p>
        </div>
      </div>
      {!dense ? (
        <>
          <span className="text-muted-foreground hidden text-xs md:block">
            {formatRelative(run.startedAtDate)}
          </span>
          <span className="text-muted-foreground hidden text-xs tabular-nums md:block">
            {formatDuration(run.durationMs)}
          </span>
        </>
      ) : null}
      <HealthPill run={run} />
    </Link>
  );
}

function EmptyRuns() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">No coworker runs yet</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Run activity will appear here once coworkers start work.
      </p>
    </div>
  );
}

function PrototypeState({
  variant,
  runs,
  groups,
}: {
  variant: RunsVariant;
  runs: RunItem[];
  groups: CoworkerGroup[];
}) {
  const attentionCount = runs.filter(
    (run) => run.tone === "blocked" || run.tone === "failed",
  ).length;

  return (
    <div className="bg-muted/40 text-muted-foreground rounded-lg border p-3 font-mono text-[11px] leading-5">
      <div>prototype.variant: {variant}</div>
      <div>coworker.runs: {runs.length}</div>
      <div>coworker.groups: {groups.length}</div>
      <div>runs.attention: {attentionCount}</div>
    </div>
  );
}

function PageHeader({
  variant,
  title,
  body,
  runs,
  groups,
  children,
}: {
  variant: RunsVariant;
  title: string;
  body: string;
  runs: RunItem[];
  groups: CoworkerGroup[];
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 border-b pb-5 md:grid-cols-[1fr_250px]">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Prototype runs
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">{body}</p>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      <PrototypeState variant={variant} runs={runs} groups={groups} />
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );

  return (
    <div className="relative max-w-md">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={handleChange}
        placeholder="Search coworker, status, or run id"
        className="h-9 pl-9 text-sm"
      />
    </div>
  );
}

function VariantLatest({ runs, query, setQuery }: VariantProps) {
  const filteredRuns = useMemo(() => filterRuns(runs, query), [query, runs]);
  const groups = useMemo(() => groupByCoworker(runs), [runs]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader
        variant="latest"
        title="Latest coworker runs"
        body="A chronological ledger for answering what just happened across the workspace."
        runs={runs}
        groups={groups}
      >
        <SearchBox value={query} onChange={setQuery} />
      </PageHeader>
      {filteredRuns.length > 0 ? (
        <div className="space-y-2">
          {filteredRuns.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <EmptyRuns />
      )}
    </main>
  );
}

function CoworkerLoadBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(8, Math.round((value / max) * 100)) : 0;
  const style = useMemo<CSSProperties>(() => ({ width: `${width}%` }), [width]);

  return (
    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
      <div className="h-full rounded-full bg-foreground/65" style={style} />
    </div>
  );
}

function VariantCoworker({ runs }: VariantProps) {
  const groups = useMemo(() => groupByCoworker(runs), [runs]);
  const maxDuration = Math.max(...groups.map((group) => group.durationMs), 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader
        variant="coworker"
        title="Runs by coworker"
        body="Coworkers become the primary unit, with each row showing recency, load, and risk."
        runs={runs}
        groups={groups}
      />
      {groups.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-muted/35 text-muted-foreground grid grid-cols-[1fr_90px] gap-3 px-3 py-2 text-[11px] font-medium md:grid-cols-[1fr_120px_170px_160px]">
            <span>Coworker</span>
            <span className="hidden md:block">Runs</span>
            <span className="hidden md:block">Runtime</span>
            <span className="text-right">State</span>
          </div>
          {groups.map((group) => (
            <div
              key={group.key}
              className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 border-t px-3 py-3 md:grid-cols-[1fr_120px_170px_160px]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CoworkerAvatar username={group.name} size={38} className="rounded-full" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    latest {formatRelative(group.latestAt)}
                  </p>
                </div>
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-medium tabular-nums">{group.runs.length}</p>
                <p className="text-muted-foreground text-[11px]">{group.activeCount} active</p>
              </div>
              <div className="hidden space-y-1.5 md:block">
                <div className="text-xs font-medium tabular-nums">
                  {formatDuration(group.durationMs)}
                </div>
                <CoworkerLoadBar value={group.durationMs} max={maxDuration} />
              </div>
              <div className="flex justify-end gap-1.5">
                {group.blockedCount > 0 ? (
                  <CountPill tone="blocked" count={group.blockedCount} />
                ) : null}
                {group.failedCount > 0 ? (
                  <CountPill tone="failed" count={group.failedCount} />
                ) : null}
                {group.blockedCount + group.failedCount === 0 ? (
                  <span className="bg-muted text-muted-foreground inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium">
                    clear
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyRuns />
      )}
    </main>
  );
}

function CountPill({ tone, count }: { tone: "blocked" | "failed"; count: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
        tone === "blocked" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "failed" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
      )}
    >
      {count} {tone}
    </span>
  );
}

function VariantAttention({ runs }: VariantProps) {
  const groups = useMemo(() => groupByCoworker(runs), [runs]);
  const attentionRuns = useMemo(
    () => runs.filter((run) => run.tone === "blocked" || run.tone === "failed"),
    [runs],
  );
  const activeRuns = useMemo(() => runs.filter((run) => run.tone === "active"), [runs]);
  const latestDone = useMemo(() => runs.filter((run) => run.tone === "done").slice(0, 8), [runs]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader
        variant="attention"
        title="Run review queue"
        body="The page starts with exceptions, then keeps active and completed work close at hand."
        runs={runs}
        groups={groups}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border bg-card">
          <SectionHeader title="Needs review" count={attentionRuns.length} />
          <div className="space-y-2 p-3">
            {attentionRuns.length > 0 ? (
              attentionRuns.map((run) => <RunRow key={run.id} run={run} />)
            ) : (
              <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs">
                Nothing blocked or failed.
              </p>
            )}
          </div>
        </section>
        <div className="grid gap-4">
          <section className="rounded-lg border bg-card">
            <SectionHeader title="Running now" count={activeRuns.length} />
            <div className="space-y-2 p-3">
              {activeRuns.slice(0, 5).map((run) => (
                <RunRow key={run.id} run={run} dense />
              ))}
            </div>
          </section>
          <section className="rounded-lg border bg-card">
            <SectionHeader title="Recently completed" count={latestDone.length} />
            <div className="space-y-2 p-3">
              {latestDone.map((run) => (
                <RunRow key={run.id} run={run} dense />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
    </div>
  );
}

function VariantLanes({ runs }: VariantProps) {
  const groups = useMemo(() => groupByCoworker(runs), [runs]);
  const lanes: Array<{ tone: RunTone; title: string; runs: RunItem[] }> = [
    { tone: "blocked", title: "Blocked", runs: runs.filter((run) => run.tone === "blocked") },
    { tone: "active", title: "Active", runs: runs.filter((run) => run.tone === "active") },
    { tone: "failed", title: "Failed", runs: runs.filter((run) => run.tone === "failed") },
    { tone: "done", title: "Done", runs: runs.filter((run) => run.tone === "done") },
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader
        variant="lanes"
        title="Status lanes"
        body="A board view for scanning run state before opening the detailed run log."
        runs={runs}
        groups={groups}
      />
      <div className="grid gap-3 lg:grid-cols-4">
        {lanes.map((lane) => (
          <section key={lane.tone} className="min-w-0 rounded-lg border bg-card">
            <SectionHeader title={lane.title} count={lane.runs.length} />
            <div className="space-y-2 p-3">
              {lane.runs.slice(0, 10).map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
              {lane.runs.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs">
                  No runs in this lane.
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function RunCard({ run }: { run: RunItem }) {
  return (
    <Link
      href={`/coworkers/runs/${run.id}`}
      prefetch={false}
      className="block rounded-lg border bg-background p-3 transition-colors hover:border-foreground/20 hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CoworkerAvatar username={run.coworkerName} size={28} className="rounded-full" />
        <p className="truncate text-sm font-medium">{run.coworkerName}</p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">{formatRelative(run.startedAtDate)}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatDuration(run.durationMs)}
        </span>
      </div>
      {run.errorMessage ? (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">{run.errorMessage}</p>
      ) : null}
    </Link>
  );
}

function filterRuns(runs: RunItem[], query: string): RunItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return runs;
  }

  return runs.filter((run) =>
    [run.id, run.coworkerName, run.status, run.errorMessage ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

type VariantProps = {
  runs: RunItem[];
  query: string;
  setQuery: (query: string) => void;
};

function PrototypeSwitcher({ current }: { current: RunsVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentIndex = Math.max(
    0,
    VARIANTS.findIndex((variant) => variant.key === current),
  );
  const currentVariant = VARIANTS[currentIndex] ?? VARIANTS[0];
  const Icon = currentVariant.icon;

  const selectVariant = useCallback(
    (offset: number) => {
      const nextIndex = (currentIndex + offset + VARIANTS.length) % VARIANTS.length;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("variant", VARIANTS[nextIndex].key);
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
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-foreground px-2 py-2 text-background shadow-lg">
      <button
        type="button"
        onClick={selectPrevious}
        className="flex size-8 items-center justify-center rounded-full hover:bg-background/15"
        aria-label="Previous prototype variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="flex min-w-[190px] items-center justify-center gap-2 text-xs font-medium">
        <Icon className="size-3.5" />
        {current.toUpperCase()} - {currentVariant.label}
      </div>
      <button
        type="button"
        onClick={selectNext}
        className="flex size-8 items-center justify-center rounded-full hover:bg-background/15"
        aria-label="Next prototype variant"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export default function PrototypeRunsPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const rawVariant = searchParams.get("variant");
  const variant = VARIANTS.some((entry) => entry.key === rawVariant)
    ? (rawVariant as RunsVariant)
    : "latest";
  const { runs, isLoading, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useWorkspaceRuns();

  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background pb-24">
      {variant === "latest" ? (
        <VariantLatest runs={runs} query={query} setQuery={setQuery} />
      ) : null}
      {variant === "coworker" ? (
        <VariantCoworker runs={runs} query={query} setQuery={setQuery} />
      ) : null}
      {variant === "attention" ? (
        <VariantAttention runs={runs} query={query} setQuery={setQuery} />
      ) : null}
      {variant === "lanes" ? <VariantLanes runs={runs} query={query} setQuery={setQuery} /> : null}
      <div className="mx-auto flex w-full max-w-4xl justify-center px-4 pb-6">
        {hasNextPage ? (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isFetchingNextPage}
            className="text-muted-foreground inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium hover:text-foreground disabled:opacity-60"
          >
            {isFetchingNextPage ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            Load older coworker runs
          </button>
        ) : isFetching ? (
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Refreshing runs
          </span>
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
            <ArrowDownWideNarrow className="size-3.5" />
            Showing loaded coworker runs
          </span>
        )}
      </div>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
