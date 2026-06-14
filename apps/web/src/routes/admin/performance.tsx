import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { DataTable } from "@/components/ui/data-table";
import { usePerformanceDashboard } from "@/orpc/hooks/admin";
import {
  computeDeltas,
  computeHealthStatus,
  detectAnomalies,
  formatChartDate,
  formatDurationDisplay,
  type Days,
  type Deltas,
  type SlowestRow,
} from "./-perf/analytics";
import {
  DayButton,
  HealthBanner,
  PhaseSmallMultiple,
  SandboxFilterButton,
  SlowestSubRow,
  StatCard,
} from "./-perf/cards";
import { modelColumns, slowestColumns } from "./-perf/columns";
import {
  BAR_RADIUS_RIGHT,
  BAR_RADIUS_TOP,
  CHART_MARGIN,
  CHART_MARGIN_WATERFALL,
  CURSOR_STYLE,
  EMPTY_LATENCY,
  LABEL_STYLE,
  LEGEND_STYLE,
  LINE_COLORS,
  PHASE_COLORS,
  PHASE_TREND_DEFS,
  STACKED_PHASE_KEYS,
  TICK_STYLE,
  formatDurationTick,
  formatPctLabel,
  formatVolumeTick,
} from "./-perf/constants";
import {
  latencyTooltipElement,
  phaseTooltipElement,
  sandboxTooltipElement,
  stackedPhaseTooltipElement,
} from "./-perf/tooltips";

export const Route = createFileRoute("/admin/performance")({
  head: () => ({ meta: [{ title: "Performance - Bap" }] }),
  component: PerformanceDashboardPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function PerformanceDashboardPage() {
  const [days, setDays] = useState<Days>("7");
  const [sandboxFilter, setSandboxFilter] = useState<"all" | "reused" | "created">("all");
  const { data, isLoading } = usePerformanceDashboard(days);

  const renderSlowestSubRow = useCallback(
    (row: { original: SlowestRow }) => <SlowestSubRow row={row.original} />,
    [],
  );

  // Health status
  const healthStatus = useMemo(() => {
    if (!data) {
      return { level: "healthy" as const, reasons: [] };
    }
    return computeHealthStatus(data);
  }, [data]);

  // Deltas
  const deltas = useMemo<Deltas>(() => {
    if (!data) {
      return { p50E2EDelta: null, p95E2EDelta: null, p50TtfvoDelta: null, sandboxReuseDelta: null };
    }
    return computeDeltas(data.latencyOverTime, data.sandboxOverTime);
  }, [data]);

  // Anomalies on P95 E2E
  const p95Anomalies = useMemo(() => {
    if (!data) {
      return [];
    }
    return detectAnomalies(data.latencyOverTime.map((d) => d.p95EndToEndMs));
  }, [data]);

  // Build phase waterfall data with percentages
  const phaseData = useMemo(() => {
    if (!data) {
      return [];
    }
    const pb = data.phaseBreakdown;
    const items = [
      {
        phase: "Sandbox Connect",
        avgMs: pb.avgSandboxConnectMs,
        color: PHASE_COLORS["Sandbox Connect"],
      },
      {
        phase: "OpenCode Ready",
        avgMs: pb.avgOpencodeReadyMs,
        color: PHASE_COLORS["OpenCode Ready"],
      },
      { phase: "Session Ready", avgMs: pb.avgSessionReadyMs, color: PHASE_COLORS["Session Ready"] },
      {
        phase: "Pre-prompt Setup",
        avgMs: pb.avgPrePromptSetupMs,
        color: PHASE_COLORS["Pre-prompt Setup"],
      },
      {
        phase: "Wait for First Event",
        avgMs: pb.avgWaitForFirstEventMs,
        color: PHASE_COLORS["Wait for First Event"],
      },
      {
        phase: "Prompt to First Token",
        avgMs: pb.avgPromptToFirstTokenMs,
        color: PHASE_COLORS["Prompt to First Token"],
      },
      { phase: "Model Stream", avgMs: pb.avgModelStreamMs, color: PHASE_COLORS["Model Stream"] },
      {
        phase: "Post-processing",
        avgMs: pb.avgPostProcessingMs,
        color: PHASE_COLORS["Post-processing"],
      },
    ].filter((d) => d.avgMs > 0);
    const total = items.reduce((s, d) => s + d.avgMs, 0);
    for (const d of items) {
      Object.assign(d, { pct: total > 0 ? Math.round((d.avgMs / total) * 100) : 0 });
    }
    return items as Array<{ phase: string; avgMs: number; color: string; pct: number }>;
  }, [data]);

  // Build stacked phase bar data
  const stackedPhaseData = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.dailyPhases.map((d) => ({
      date: d.date,
      sandboxConnect: d.p50SandboxConnectMs,
      opencodeReady: d.p50OpencodeReadyMs,
      sessionReady: d.p50SessionReadyMs,
      prePromptSetup: d.p50PrePromptSetupMs,
      waitForFirstEvent: d.p50WaitForFirstEventMs,
      promptToFirstToken: d.p50PromptToFirstTokenMs,
      modelStream: d.p50ModelStreamMs,
      postProcessing: d.p50PostProcessingMs,
    }));
  }, [data]);

  // Small multiples data
  const smallMultiplesData = useMemo(() => {
    if (!data || data.dailyPhases.length < 2) {
      return [];
    }
    return PHASE_TREND_DEFS.map((def) => {
      const p50Key = `p50${def.key}Ms` as keyof (typeof data.dailyPhases)[number];
      const p95Key = `p95${def.key}Ms` as keyof (typeof data.dailyPhases)[number];
      const p50Values = data.dailyPhases.map((d) => (d[p50Key] as number) ?? 0);
      const p95Values = data.dailyPhases.map((d) => (d[p95Key] as number) ?? 0);
      const anomalies = detectAnomalies(p50Values);
      const lastTwo = anomalies.slice(-2);
      const hasAnomaly = lastTwo.some(Boolean);
      const currentP50 = p50Values.at(-1) ?? 0;
      return {
        label: def.label,
        color: def.color,
        p50Values,
        p95Values,
        currentP50,
        hasAnomaly,
      };
    });
  }, [data]);

  // Sandbox chart data
  const sandboxChartData = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.sandboxOverTime.map((d) =>
      Object.assign({}, d, {
        reuseRate: d.total > 0 ? Math.round((d.reused / d.total) * 100) : 0,
      }),
    );
  }, [data]);

  // Sandbox impact
  const sandboxImpactMap = useMemo(() => {
    if (!data) {
      return { reused: null, created: null };
    }
    const map: Record<string, (typeof data.sandboxImpact)[number]> = {};
    for (const row of data.sandboxImpact) {
      map[row.mode] = row;
    }
    return { reused: map.reused ?? null, created: map.created ?? null };
  }, [data]);

  const sandboxSavings = useMemo(() => {
    const r = sandboxImpactMap.reused;
    const c = sandboxImpactMap.created;
    if (!r || !c || c.p50EndToEndMs <= 0) {
      return null;
    }
    const savedMs = c.p50EndToEndMs - r.p50EndToEndMs;
    const savedPct = Math.round((savedMs / c.p50EndToEndMs) * 100);
    if (savedMs <= 0) {
      return null;
    }
    return { savedMs, savedPct };
  }, [sandboxImpactMap]);

  // Filtered slowest generations
  const filteredSlowest = useMemo(() => {
    if (!data) {
      return [];
    }
    if (sandboxFilter === "all") {
      return data.slowestGenerations;
    }
    return data.slowestGenerations.filter((g) => g.sandboxMode === sandboxFilter);
  }, [data, sandboxFilter]);

  // Slowest pattern detection
  const slowestPatterns = useMemo(() => {
    if (!data || data.slowestGenerations.length < 5) {
      return [];
    }
    const patterns: string[] = [];
    const total = data.slowestGenerations.length;
    const createdCount = data.slowestGenerations.filter((g) => g.sandboxMode === "created").length;
    if (createdCount / total > 0.6) {
      patterns.push(`${createdCount}/${total} involve sandbox creation`);
    }
    const modelCounts = new Map<string, number>();
    for (const g of data.slowestGenerations) {
      if (g.model) {
        modelCounts.set(g.model, (modelCounts.get(g.model) ?? 0) + 1);
      }
    }
    for (const [model, count] of modelCounts) {
      if (count / total > 0.5) {
        patterns.push(`${count}/${total} involve ${model}`);
      }
    }
    return patterns;
  }, [data]);

  // Memoize anomaly dot renderer
  const renderAnomalyDot = useCallback(
    (props: { cx?: number; cy?: number; index?: number }) => {
      const idx = props.index ?? 0;
      if (!p95Anomalies[idx] || props.cx == null || props.cy == null) {
        return <circle key={idx} r={0} />;
      }
      return (
        <circle
          key={idx}
          cx={props.cx}
          cy={props.cy}
          r={5}
          fill="#ef4444"
          stroke="#fff"
          strokeWidth={2}
        />
      );
    },
    [p95Anomalies],
  );

  // Memoize filter callback
  const handleSandboxFilterChange = useCallback((f: "all" | "reused" | "created") => {
    setSandboxFilter(f);
  }, []);

  // Memoize spark data arrays to satisfy react-perf
  const latencyOverTime = data?.latencyOverTime ?? EMPTY_LATENCY;
  const sparkP50E2E = useMemo(() => latencyOverTime.map((d) => d.p50EndToEndMs), [latencyOverTime]);
  const sparkP95E2E = useMemo(() => latencyOverTime.map((d) => d.p95EndToEndMs), [latencyOverTime]);
  const sparkP50Ttfvo = useMemo(() => latencyOverTime.map((d) => d.p50TtfvoMs), [latencyOverTime]);
  const sparkVolume = useMemo(() => latencyOverTime.map((d) => d.messageCount), [latencyOverTime]);
  const sparkSandboxReuse = useMemo(
    () => sandboxChartData.map((d) => d.reuseRate),
    [sandboxChartData],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, modelComparison } = data;
  const daysLabel = days === "1" ? "24h" : `${days}d`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
        <div className="ml-auto flex gap-1">
          <DayButton current={days} value="1" label="24h" onSelect={setDays} />
          <DayButton current={days} value="7" label="7d" onSelect={setDays} />
          <DayButton current={days} value="30" label="30d" onSelect={setDays} />
        </div>
      </div>

      {/* Health Banner */}
      <HealthBanner status={healthStatus} />

      {/* Summary cards with sparklines + deltas */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard
          label={`P50 End-to-End (${daysLabel})`}
          value={formatDurationDisplay(summary.p50EndToEndMs)}
          delta={deltas.p50E2EDelta}
          sparkData={sparkP50E2E}
          sparkColor="#3b82f6"
        />
        <StatCard
          label={`P95 End-to-End (${daysLabel})`}
          value={formatDurationDisplay(summary.p95EndToEndMs)}
          alert={summary.p95EndToEndMs > 60000}
          delta={deltas.p95E2EDelta}
          sparkData={sparkP95E2E}
          sparkColor="#ef4444"
        />
        <StatCard
          label={`P50 First Output (${daysLabel})`}
          value={formatDurationDisplay(summary.p50TtfvoMs)}
          delta={deltas.p50TtfvoDelta}
          sparkData={sparkP50Ttfvo}
          sparkColor="#22c55e"
        />
        <StatCard
          label="Sandbox Reuse Rate"
          value={`${summary.sandboxReuseRate}%`}
          highlight={summary.sandboxReuseRate > 50}
          alert={summary.sandboxReuseRate < 20}
          delta={deltas.sandboxReuseDelta}
          invertDelta
          sparkData={sparkSandboxReuse}
          sparkColor="#3b82f6"
        />
        <StatCard
          label={`Generations (${daysLabel})`}
          value={summary.totalMessages}
          sparkData={sparkVolume}
          sparkColor="#a1a1aa"
        />
      </div>

      {/* E2E Latency + Volume chart */}
      {latencyOverTime.length > 0 && (
        <div className="rounded-xl border p-4">
          <h2 className="mb-4 text-sm font-medium">End-to-End Latency ({daysLabel})</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={latencyOverTime} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
              />
              <YAxis
                yAxisId="latency"
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                tickFormatter={formatDurationTick}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                tickFormatter={formatVolumeTick}
              />
              <Tooltip content={latencyTooltipElement} cursor={CURSOR_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar
                yAxisId="volume"
                dataKey="messageCount"
                name="Volume"
                fill="#a1a1aa"
                fillOpacity={0.15}
                radius={BAR_RADIUS_TOP}
              />
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="p50EndToEndMs"
                name="P50 E2E"
                stroke={LINE_COLORS.p50EndToEnd}
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="latency"
                type="monotone"
                dataKey="p95EndToEndMs"
                name="P95 E2E"
                stroke={LINE_COLORS.p95EndToEnd}
                strokeWidth={2}
                dot={renderAnomalyDot}
                strokeDasharray="5 5"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* TTFVO chart (separate scale) */}
      {latencyOverTime.length > 0 && (
        <div className="rounded-xl border p-4">
          <h2 className="mb-4 text-sm font-medium">Time to First Visible Output ({daysLabel})</h2>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={latencyOverTime} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
              />
              <YAxis
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                tickFormatter={formatDurationTick}
              />
              <Tooltip content={latencyTooltipElement} cursor={CURSOR_STYLE} />
              <Line
                type="monotone"
                dataKey="p50TtfvoMs"
                name="P50 TTFVO"
                stroke={LINE_COLORS.p50Ttfvo}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stacked Phase Bar Chart (replaces unreadable 16-line area chart) */}
      {stackedPhaseData.length > 1 && (
        <div className="rounded-xl border p-4">
          <h2 className="mb-4 text-sm font-medium">Phase Composition Over Time ({daysLabel})</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stackedPhaseData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
              />
              <YAxis
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                tickFormatter={formatDurationTick}
              />
              <Tooltip content={stackedPhaseTooltipElement} cursor={CURSOR_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {STACKED_PHASE_KEYS.map((phase, i) => (
                <Bar
                  key={phase.dataKey}
                  dataKey={phase.dataKey}
                  name={phase.label}
                  stackId="phases"
                  fill={phase.color}
                  radius={i === STACKED_PHASE_KEYS.length - 1 ? BAR_RADIUS_TOP : undefined}
                  barSize={days === "30" ? 12 : days === "1" ? 40 : 24}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Phase waterfall with % annotations */}
      {phaseData.length > 0 && (
        <div className="rounded-xl border p-4">
          <h2 className="mb-4 text-sm font-medium">Average time per phase ({daysLabel})</h2>
          <ResponsiveContainer width="100%" height={Math.max(200, phaseData.length * 40)}>
            <BarChart data={phaseData} layout="vertical" margin={CHART_MARGIN_WATERFALL}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                tickFormatter={formatDurationTick}
              />
              <YAxis
                type="category"
                dataKey="phase"
                tick={TICK_STYLE}
                stroke="var(--color-muted-foreground)"
                width={135}
              />
              <Tooltip content={phaseTooltipElement} cursor={CURSOR_STYLE} />
              <Bar dataKey="avgMs" radius={BAR_RADIUS_RIGHT}>
                {phaseData.map((entry) => (
                  <Cell key={entry.phase} fill={entry.color} />
                ))}
                <LabelList
                  dataKey="pct"
                  position="right"
                  formatter={formatPctLabel}
                  style={LABEL_STYLE}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Small Multiples: 8 mini phase trend charts */}
      {smallMultiplesData.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium">Phase Trends ({daysLabel})</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {smallMultiplesData.map((sm) => (
              <PhaseSmallMultiple key={sm.label} {...sm} />
            ))}
          </div>
        </div>
      )}

      {/* Sandbox performance (merged single card) */}
      <div className="rounded-xl border p-4">
        <h2 className="mb-4 text-sm font-medium">Sandbox Performance ({daysLabel})</h2>
        <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
          {/* Left: stacked area of counts */}
          {sandboxChartData.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs">Sandbox count by type</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={sandboxChartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatChartDate}
                    tick={TICK_STYLE}
                    stroke="var(--color-muted-foreground)"
                  />
                  <YAxis tick={TICK_STYLE} stroke="var(--color-muted-foreground)" />
                  <Tooltip content={sandboxTooltipElement} cursor={CURSOR_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="reused"
                    name="Reused"
                    stackId="sb"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.2}
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="Created"
                    stackId="sb"
                    stroke="#f59e0b"
                    fill="#f59e0b"
                    fillOpacity={0.2}
                    strokeWidth={1.5}
                  />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Right: impact cards + savings */}
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">Latency impact (P50)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  Reused ({sandboxImpactMap.reused?.count ?? 0})
                </p>
                <p className="text-lg font-semibold text-blue-600 tabular-nums dark:text-blue-400">
                  {formatDurationDisplay(sandboxImpactMap.reused?.p50SandboxMs)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDurationDisplay(sandboxImpactMap.reused?.p50EndToEndMs)} E2E
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  Created ({sandboxImpactMap.created?.count ?? 0})
                </p>
                <p className="text-lg font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                  {formatDurationDisplay(sandboxImpactMap.created?.p50SandboxMs)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDurationDisplay(sandboxImpactMap.created?.p50EndToEndMs)} E2E
                </p>
              </div>
            </div>
            {sandboxSavings && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
                <p className="text-xs font-medium text-green-700 dark:text-green-400">
                  Reusing saves ~{formatDurationDisplay(sandboxSavings.savedMs)} (
                  {sandboxSavings.savedPct}%) per generation
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Model comparison */}
      {modelComparison.length > 0 && (
        <div className="rounded-xl border">
          <h2 className="px-4 pt-4 text-sm font-medium">Model Comparison ({daysLabel})</h2>
          <DataTable columns={modelColumns} data={modelComparison} />
        </div>
      )}

      {/* Slowest generations with filters + patterns */}
      {data.slowestGenerations.length > 0 && (
        <div className="rounded-xl border">
          <div className="flex items-center gap-3 px-4 pt-4">
            <h2 className="text-sm font-medium">Slowest Generations ({daysLabel})</h2>
            <div className="ml-auto flex gap-1">
              {(["all", "reused", "created"] as const).map((f) => (
                <SandboxFilterButton
                  key={f}
                  filter={f}
                  active={sandboxFilter === f}
                  onSelect={handleSandboxFilterChange}
                />
              ))}
            </div>
          </div>
          {slowestPatterns.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-2">
              {slowestPatterns.map((p) => (
                <span
                  key={p}
                  className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
          <DataTable
            columns={slowestColumns}
            data={filteredSlowest}
            expandable
            renderSubRow={renderSlowestSubRow}
          />
        </div>
      )}
    </div>
  );
}
