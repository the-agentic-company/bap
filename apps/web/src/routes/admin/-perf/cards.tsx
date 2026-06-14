// ---------------------------------------------------------------------------
// Perf dashboard UI components (cards, banners, buttons, sub-rows)
// ---------------------------------------------------------------------------

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AreaChart, Area, LineChart, Line, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { formatDurationDisplay, type Days, type HealthStatus, type SlowestRow } from "./analytics";
import { SPARK_MARGIN } from "./constants";
import { FlameChart } from "./flame";

// ---------------------------------------------------------------------------
// Impersonate + redirect
// ---------------------------------------------------------------------------

export function ImpersonateLink({
  userId,
  conversationId,
}: {
  userId: string | null;
  conversationId: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!userId) {
        return;
      }
      setLoading(true);
      try {
        const result = await authClient.admin.impersonateUser({ userId });
        if (!result.error) {
          window.location.assign(`/chat/${conversationId}`);
          return;
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [userId, conversationId],
  );

  if (!userId) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      className="h-7 gap-1.5 text-xs"
    >
      {loading ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
      Open as user
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Health Banner
// ---------------------------------------------------------------------------

export function HealthBanner({ status }: { status: HealthStatus }) {
  if (status.level === "healthy" && status.reasons.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2">
        <CheckCircle2 className="size-4 text-green-500" />
        <span className="text-sm font-medium text-green-700 dark:text-green-400">
          All systems nominal
        </span>
      </div>
    );
  }

  const isCritical = status.level === "critical";

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-2",
        isCritical ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <AlertTriangle
        className={cn("mt-0.5 size-4 shrink-0", isCritical ? "text-red-500" : "text-amber-500")}
      />
      <div className="space-y-0.5">
        <span
          className={cn(
            "text-sm font-medium",
            isCritical ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400",
          )}
        >
          {isCritical ? "Performance Critical" : "Performance Degraded"}
        </span>
        <ul className="text-muted-foreground text-xs">
          {status.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small Multiple Phase Chart
// ---------------------------------------------------------------------------

const SMALL_CHART_MARGIN = { top: 2, right: 0, left: 0, bottom: 0 };

export function PhaseSmallMultiple({
  label,
  color,
  p50Values,
  p95Values,
  currentP50,
  hasAnomaly,
}: {
  label: string;
  color: string;
  p50Values: number[];
  p95Values: number[];
  currentP50: number;
  hasAnomaly: boolean;
}) {
  const chartData = useMemo(
    () => p50Values.map((v, i) => ({ p50: v, p95: p95Values[i] ?? v })),
    [p50Values, p95Values],
  );
  const labelStyle = useMemo(() => ({ color }), [color]);

  return (
    <div className={cn("rounded-lg border p-3", hasAnomaly && "border-red-500/40 bg-red-500/5")}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium" style={labelStyle}>
          {label}
        </span>
        {hasAnomaly && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
            SPIKE
          </span>
        )}
      </div>
      <p className="mb-1 text-sm font-semibold tabular-nums">{formatDurationDisplay(currentP50)}</p>
      {chartData.length > 1 && (
        <ResponsiveContainer width="100%" height={48}>
          <AreaChart data={chartData} margin={SMALL_CHART_MARGIN}>
            <Area
              type="monotone"
              dataKey="p95"
              stroke={color}
              fill={color}
              fillOpacity={0.06}
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="p50"
              stroke={color}
              fill={color}
              fillOpacity={0.12}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded slowest generation sub-row
// ---------------------------------------------------------------------------

export function SlowestSubRow({ row }: { row: SlowestRow }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">Execution Timeline</p>
        <FlameChart timing={row.timing} />
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs md:grid-cols-4">
        <div>
          <span className="text-muted-foreground">End-to-End</span>
          <p className="font-medium tabular-nums">{formatDurationDisplay(row.endToEndMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Sandbox Connect</span>
          <p className="tabular-nums">{formatDurationDisplay(row.sandboxMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Model Stream</span>
          <p className="tabular-nums">{formatDurationDisplay(row.modelStreamMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Time to First Visible Output</span>
          <p className="tabular-nums">{formatDurationDisplay(row.ttfvoMs)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Generation ID</span>
          <p className="font-mono">{row.generationId.slice(0, 12)}...</p>
        </div>
        <div>
          <span className="text-muted-foreground">Input Tokens</span>
          <p className="tabular-nums">{row.inputTokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Output Tokens</span>
          <p className="tabular-nums">{row.outputTokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Sandbox Mode</span>
          <p>{row.sandboxMode ?? "—"}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <ImpersonateLink userId={row.userId} conversationId={row.conversationId} />
        {row.userEmail && (
          <span className="text-muted-foreground text-xs">Will impersonate {row.userEmail}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day button
// ---------------------------------------------------------------------------

export function DayButton({
  current,
  value,
  label,
  onSelect,
}: {
  current: Days;
  value: Days;
  label: string;
  onSelect: (d: Days) => void;
}) {
  const handleClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button
      variant={current === value ? "default" : "outline"}
      size="sm"
      onClick={handleClick}
      className="h-7 px-3 text-xs"
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Sandbox filter button
// ---------------------------------------------------------------------------

export function SandboxFilterButton({
  filter,
  active,
  onSelect,
}: {
  filter: "all" | "reused" | "created";
  active: boolean;
  onSelect: (f: "all" | "reused" | "created") => void;
}) {
  const handleClick = useCallback(() => onSelect(filter), [onSelect, filter]);
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={handleClick}
      className="h-6 px-2 text-[11px]"
    >
      {filter === "all" ? "All" : filter}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Stat card with sparkline + delta
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  subtitle,
  alert,
  highlight,
  delta,
  invertDelta,
  sparkData,
  sparkColor,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  alert?: boolean;
  highlight?: boolean;
  delta?: number | null;
  invertDelta?: boolean;
  sparkData?: number[];
  sparkColor?: string;
}) {
  const sparkChartData = useMemo(() => sparkData?.map((v) => ({ v })) ?? [], [sparkData]);

  // For latency metrics: positive delta = regression = red
  // For sandbox reuse (invertDelta): positive delta = improvement = green
  const deltaIsGood = delta != null && (invertDelta ? delta > 0 : delta < 0);
  const deltaIsBad = delta != null && (invertDelta ? delta < 0 : delta > 0);

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        alert && "border-red-500/30 bg-red-500/5",
        highlight && !alert && "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            alert && "text-red-500",
            highlight && !alert && "text-blue-500",
          )}
        >
          {value}
        </p>
        {delta != null && delta !== 0 && (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              deltaIsGood && "text-green-600 dark:text-green-400",
              deltaIsBad && "text-red-600 dark:text-red-400",
              !deltaIsGood && !deltaIsBad && "text-muted-foreground",
            )}
          >
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        {subtitle && <p className="text-muted-foreground text-xs">{subtitle}</p>}
      </div>
      {sparkChartData.length > 1 && sparkColor && (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={24}>
            <LineChart data={sparkChartData} margin={SPARK_MARGIN}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={sparkColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
