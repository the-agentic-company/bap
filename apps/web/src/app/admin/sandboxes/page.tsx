"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import {
  useAdminKillSandbox,
  useAdminListSandboxes,
  useAdminSandboxUsageHistory,
} from "@/orpc/hooks";

type Provider = "e2b" | "daytona";

function formatRelativeTime(value: Date | string | null) {
  if (!value) {
    return "--";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
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

function formatUptime(startedAt: Date | string | null) {
  if (!startedAt) {
    return "--";
  }
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(start.getTime())) {
    return "--";
  }
  const diffMs = Date.now() - start.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

function truncateId(id: string) {
  return id.length > 12 ? `${id.slice(0, 12)}...` : id;
}

function formatCredits(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (n >= 10) {
    return n.toFixed(0);
  }
  return n.toFixed(1);
}

function getEnvBaseUrl(env: string | null): string {
  switch (env) {
    case "prod":
      return "https://cmdclaw.ai";
    case "staging":
      return "https://staging.cmdclaw.ai";
    default:
      return "";
  }
}

const ENV_COLORS: Record<string, string> = {
  dev: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  staging: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  prod: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const PROVIDER_META: Record<
  Provider,
  { label: string; dotClass: string; pillClass: string; stroke: string; fill: string }
> = {
  e2b: {
    label: "E2B",
    dotClass: "bg-violet-500",
    pillClass:
      "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/20",
    stroke: "var(--color-violet-500, #8b5cf6)",
    fill: "var(--color-violet-500, #8b5cf6)",
  },
  daytona: {
    label: "Daytona",
    dotClass: "bg-amber-500",
    pillClass:
      "bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20",
    stroke: "var(--color-amber-500, #f59e0b)",
    fill: "var(--color-amber-500, #f59e0b)",
  },
};

function EnvironmentBadge({ env }: { env: string | null }) {
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

function ProviderPill({ provider }: { provider: Provider }) {
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

function KillButton({
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

type SandboxRow = {
  provider: Provider;
  sandboxId: string;
  templateId: string | null;
  state: "running" | "paused" | "stopped" | "error" | "unknown";
  startedAt: Date | string | null;
  endAt: Date | string | null;
  cpuCount: number | null;
  memoryMB: number | null;
  metadata: Record<string, string>;
  environment: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  conversationType: string | null;
  model: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  coworkerName: string | null;
  coworkerUsername: string | null;
  coworkerTriggerType: string | null;
  coworkerId: string | null;
};

type SortKey =
  | "provider"
  | "sandboxId"
  | "environment"
  | "state"
  | "startedAt"
  | "userEmail"
  | "details";
type SortDir = "asc" | "desc";

function getDetailsText(row: SandboxRow): string {
  if (row.conversationType === "coworker") {
    return row.coworkerUsername ?? row.coworkerName ?? "coworker";
  }
  if (row.conversationType === "chat") {
    return row.conversationTitle ?? "chat";
  }
  return row.conversationType ?? "";
}

function getSortValue(row: SandboxRow, key: SortKey): string | number {
  switch (key) {
    case "provider":
      return row.provider;
    case "sandboxId":
      return row.sandboxId;
    case "environment":
      return row.environment ?? "";
    case "state":
      return row.state;
    case "startedAt":
      return row.startedAt ? new Date(row.startedAt).getTime() : 0;
    case "userEmail":
      return row.userEmail ?? "";
    case "details":
      return getDetailsText(row);
  }
}

function SortableHeader({
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

type ConfirmState = {
  title: string;
  description: string;
  action: () => Promise<void>;
} | null;

// ---------------------------------------------------------------------------
// Usage chart
// ---------------------------------------------------------------------------

type RangeKey = "24h" | "7d" | "30d";
const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; bucket: "hour" | "day" }> = [
  { key: "24h", label: "24h", bucket: "hour" },
  { key: "7d", label: "7d", bucket: "hour" },
  { key: "30d", label: "30d", bucket: "day" },
];

const CHART_MARGIN = { top: 4, right: 12, left: 4, bottom: 0 };
const CHART_TICK_STYLE = { fontSize: 10 };
const CHART_TOOLTIP_CONTENT_STYLE = {
  fontSize: 11,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--background)",
};
const CHART_TOOLTIP_LABEL_STYLE = { fontWeight: 600 };

function chartTooltipFormatter(value: unknown, name: unknown): [string, string] {
  const num = typeof value === "number" ? value : Number(value) || 0;
  if (name === "count") {
    return [`${num}`, "concurrent"];
  }
  return [formatCredits(num), String(name)];
}

type BucketPoint = {
  t: number;
  label: string;
  e2b: number;
  daytona: number;
  count: number;
};

function buildChartSeries(
  buckets: Array<{
    bucketStart: string | Date;
    provider: Provider;
    sandboxCount: number;
    creditsBurned: number;
  }>,
  bucket: "hour" | "day",
): BucketPoint[] {
  const byTime = new Map<number, BucketPoint>();
  for (const b of buckets) {
    const date = b.bucketStart instanceof Date ? b.bucketStart : new Date(b.bucketStart);
    const t = date.getTime();
    const existing = byTime.get(t) ?? {
      t,
      label:
        bucket === "hour"
          ? date.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric" })
          : date.toLocaleDateString([], { month: "numeric", day: "numeric" }),
      e2b: 0,
      daytona: 0,
      count: 0,
    };
    existing[b.provider] = b.creditsBurned;
    existing.count += b.sandboxCount;
    byTime.set(t, existing);
  }
  return Array.from(byTime.values()).toSorted((a, b) => a.t - b.t);
}

type LeakRow = {
  sandboxId: string;
  provider: Provider;
  firstSeen: string | Date;
  lastSeen: string | Date;
  runtimeSeconds: number;
  credits: number;
  ticks: number;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

function RangeToggleButton({
  rangeKey,
  label,
  active,
  onSelect,
}: {
  rangeKey: RangeKey;
  label: string;
  active: boolean;
  onSelect: (key: RangeKey) => void;
}) {
  const handleClick = useCallback(() => onSelect(rangeKey), [rangeKey, onSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "rounded px-2 py-1 font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function UsageChart() {
  const [range, setRange] = useState<RangeKey>("7d");
  const rangeDef = RANGE_OPTIONS.find((r) => r.key === range) ?? RANGE_OPTIONS[1];
  const { data, isLoading } = useAdminSandboxUsageHistory({
    range,
    bucket: rangeDef.bucket,
  });

  const series = useMemo(
    () => (data?.buckets ? buildChartSeries(data.buckets, rangeDef.bucket) : []),
    [data, rangeDef.bucket],
  );

  const totalBurned = useMemo(
    () => series.reduce((sum, p) => sum + p.e2b + p.daytona, 0),
    [series],
  );
  const peakConcurrent = useMemo(
    () => (series.length > 0 ? Math.max(...series.map((p) => p.count)) : 0),
    [series],
  );

  const leaks = (data?.leaks ?? []) as LeakRow[];

  return (
    <section className="bg-card mb-6 rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="flex items-baseline gap-3">
            <h3 className="text-sm font-semibold tracking-tight">Credit burn through time</h3>
            <span className="text-muted-foreground text-[11px] tracking-wider uppercase">
              5 min snapshot · {rangeDef.bucket}ly buckets
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Flat lines that don't drop = sandboxes that never close. Look for rising baselines.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
              Burned · {range}
            </div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              {formatCredits(totalBurned)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground text-[10px] tracking-wider uppercase">Peak ∥</div>
            <div className="font-mono text-sm font-semibold tabular-nums">{peakConcurrent}</div>
          </div>
          <div className="bg-muted/60 flex items-center rounded-md p-0.5 text-xs">
            {RANGE_OPTIONS.map((opt) => (
              <RangeToggleButton
                key={opt.key}
                rangeKey={opt.key}
                label={opt.label}
                active={range === opt.key}
                onSelect={setRange}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="h-[220px] px-2 pt-4 pb-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : series.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No snapshots yet — the worker collects one every 5 minutes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="fillE2b" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PROVIDER_META.e2b.fill} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={PROVIDER_META.e2b.fill} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillDaytona" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PROVIDER_META.daytona.fill} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={PROVIDER_META.daytona.fill} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" vertical={false} opacity={0.4} />
              <XAxis
                dataKey="label"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                yAxisId="credits"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={32}
                tickFormatter={formatCredits}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={24}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                formatter={chartTooltipFormatter}
              />
              <Area
                yAxisId="credits"
                type="monotone"
                dataKey="e2b"
                stackId="credits"
                name="E2B"
                stroke={PROVIDER_META.e2b.stroke}
                strokeWidth={1.5}
                fill="url(#fillE2b)"
                isAnimationActive={false}
              />
              <Area
                yAxisId="credits"
                type="monotone"
                dataKey="daytona"
                stackId="credits"
                name="Daytona"
                stroke={PROVIDER_META.daytona.stroke}
                strokeWidth={1.5}
                fill="url(#fillDaytona)"
                isAnimationActive={false}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="count"
                name="count"
                stroke="var(--foreground)"
                strokeDasharray="3 3"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {leaks.length > 0 && (
        <details className="border-t" open={false}>
          <summary className="text-muted-foreground hover:bg-muted/40 cursor-pointer px-4 py-2 text-xs font-medium">
            Longest-lived sandboxes in range ({leaks.length})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-t">
                  <th className="px-4 py-2 text-left font-medium">Provider</th>
                  <th className="px-4 py-2 text-left font-medium">Sandbox</th>
                  <th className="px-4 py-2 text-right font-medium">Runtime</th>
                  <th className="px-4 py-2 text-right font-medium">Credits</th>
                  <th className="px-4 py-2 text-right font-medium">First seen</th>
                  <th className="px-4 py-2 text-right font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {leaks.map((leak) => (
                  <tr key={`${leak.provider}-${leak.sandboxId}`} className="border-t">
                    <td className="px-4 py-2">
                      <ProviderPill provider={leak.provider} />
                    </td>
                    <td className="px-4 py-2 font-mono" title={leak.sandboxId}>
                      {truncateId(leak.sandboxId)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDuration(leak.runtimeSeconds)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCredits(leak.credits)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-right">
                      {formatRelativeTime(leak.firstSeen)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-right">
                      {formatRelativeTime(leak.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PROVIDER_FILTERS: Array<{ key: "all" | Provider; label: string }> = [
  { key: "all", label: "All" },
  { key: "e2b", label: "E2B" },
  { key: "daytona", label: "Daytona" },
];

function ProviderFilterButton({
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

export default function AdminSandboxesPage() {
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
                              href={`${getEnvBaseUrl(s.environment)}/agents/${s.coworkerId}`}
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
