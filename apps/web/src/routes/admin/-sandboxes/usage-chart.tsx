import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { useAdminSandboxUsageHistory } from "@/orpc/hooks/admin";
import { ProviderPill } from "./components";
import {
  PROVIDER_META,
  formatCredits,
  formatRelativeTime,
  truncateId,
  type Provider,
} from "./shared";

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

export function UsageChart() {
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
