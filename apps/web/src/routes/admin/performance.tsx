import type { ColumnDef } from "@tanstack/react-table";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { usePerformanceDashboard } from "@/orpc/hooks";

export const Route = createFileRoute("/admin/performance")({
  head: () => ({ meta: [{ title: "Performance - CmdClaw" }] }),
  component: PerformanceDashboardPage,
});

// ---------------------------------------------------------------------------
// Chart constants
// ---------------------------------------------------------------------------

const CHART_MARGIN = { top: 4, right: 4, left: 0, bottom: 0 };
const CHART_MARGIN_WATERFALL = { top: 4, right: 4, left: 140, bottom: 0 };
const TICK_STYLE = { fontSize: 11 };
const CURSOR_STYLE = { fill: "var(--color-muted)", opacity: 0.4 };
const LEGEND_STYLE = { fontSize: 12, paddingTop: 12 };
const BAR_RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0];
const BAR_RADIUS_TOP: [number, number, number, number] = [2, 2, 0, 0];
const EMPTY_LATENCY: Array<{
  p50EndToEndMs: number;
  p95EndToEndMs: number;
  p50TtfvoMs: number;
  messageCount: number;
  date: string;
}> = [];
function formatDurationTick(v: number) {
  return formatDurationDisplay(v);
}

function formatVolumeTick(v: number) {
  return `${v}`;
}

function formatPctLabel(v: unknown) {
  return `${v}%`;
}

const LABEL_STYLE = { fontSize: 11, fill: "var(--color-muted-foreground)" };
const SPARK_MARGIN = { top: 2, right: 0, left: 0, bottom: 2 };

function formatDurationDisplay(ms: number | null | undefined): string {
  if (ms == null || ms === 0) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  const m = Math.floor(s / 60);
  const remainder = Math.round(s % 60);
  return `${m}m ${remainder}s`;
}

const PHASE_COLORS: Record<string, string> = {
  "Sandbox Connect": "#64748b",
  "OpenCode Ready": "#3b82f6",
  "Session Ready": "#06b6d4",
  "Pre-prompt Setup": "#8b5cf6",
  "Wait for First Event": "#f59e0b",
  "Prompt to First Token": "#f97316",
  "Model Stream": "#22c55e",
  "Post-processing": "#a1a1aa",
};

const LINE_COLORS = {
  p50EndToEnd: "#3b82f6",
  p95EndToEnd: "#ef4444",
  p50Ttfvo: "#22c55e",
};

const PHASE_TREND_DEFS = [
  { key: "SandboxConnect", label: "Sandbox Connect", color: "#64748b" },
  { key: "OpencodeReady", label: "OpenCode Ready", color: "#3b82f6" },
  { key: "SessionReady", label: "Session Ready", color: "#06b6d4" },
  { key: "PrePromptSetup", label: "Pre-prompt Setup", color: "#8b5cf6" },
  { key: "WaitForFirstEvent", label: "Wait for First Event", color: "#f59e0b" },
  { key: "PromptToFirstToken", label: "Prompt to First Token", color: "#f97316" },
  { key: "ModelStream", label: "Model Stream", color: "#22c55e" },
  { key: "PostProcessing", label: "Post-processing", color: "#a1a1aa" },
] as const;

// Phase keys for stacked bar chart (match dailyPhases field naming)
const STACKED_PHASE_KEYS = [
  { dataKey: "sandboxConnect", label: "Sandbox Connect", color: "#64748b" },
  { dataKey: "opencodeReady", label: "OpenCode Ready", color: "#3b82f6" },
  { dataKey: "sessionReady", label: "Session Ready", color: "#06b6d4" },
  { dataKey: "prePromptSetup", label: "Pre-prompt Setup", color: "#8b5cf6" },
  { dataKey: "waitForFirstEvent", label: "Wait for First Event", color: "#f59e0b" },
  { dataKey: "promptToFirstToken", label: "Prompt to First Token", color: "#f97316" },
  { dataKey: "modelStream", label: "Model Stream", color: "#22c55e" },
  { dataKey: "postProcessing", label: "Post-processing", color: "#a1a1aa" },
] as const;

// Flame chart phase nesting structure
const FLAME_PHASES: Array<{
  name: string;
  label: string;
  color: string;
  depth: number;
  durationKey: string;
}> = [
  {
    name: "generation_to_first_token",
    label: "generation_to_first_token",
    color: "#854d0e",
    depth: 0,
    durationKey: "generationToFirstTokenMs",
  },
  {
    name: "generation_to_first_visible_output",
    label: "generation_to_first_visible_output",
    color: "#65a30d",
    depth: 0,
    durationKey: "generationToFirstVisibleOutputMs",
  },
  {
    name: "agent_init",
    label: "agent_init",
    color: "#c084fc",
    depth: 1,
    durationKey: "agentInitMs",
  },
  {
    name: "prompt_to_first_visible_output",
    label: "prompt_to_first_visible_output",
    color: "#22c55e",
    depth: 1,
    durationKey: "promptToFirstVisibleOutputMs",
  },
  {
    name: "sandbox_connect_or_create",
    label: "sandbox_connect_or_create",
    color: "#64748b",
    depth: 2,
    durationKey: "sandboxConnectOrCreateMs",
  },
  {
    name: "opencode_ready",
    label: "opencode_ready",
    color: "#3b82f6",
    depth: 2,
    durationKey: "opencodeReadyMs",
  },
  {
    name: "session_ready",
    label: "session_ready",
    color: "#06b6d4",
    depth: 2,
    durationKey: "sessionReadyMs",
  },
  {
    name: "pre_prompt_setup",
    label: "pre_prompt_setup",
    color: "#8b5cf6",
    depth: 2,
    durationKey: "prePromptSetupMs",
  },
  {
    name: "wait_for_first_event",
    label: "wait_for_first_event",
    color: "#f59e0b",
    depth: 2,
    durationKey: "waitForFirstEventMs",
  },
  {
    name: "model_stream",
    label: "model_stream",
    color: "#22c55e",
    depth: 2,
    durationKey: "modelStreamMs",
  },
  {
    name: "post_processing",
    label: "post_processing",
    color: "#a1a1aa",
    depth: 2,
    durationKey: "postProcessingMs",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Days = "1" | "7" | "30";

type ModelRow = {
  model: string;
  generationCount: number;
  p50EndToEndMs: number;
  p95EndToEndMs: number;
  p50TtfvoMs: number;
  avgTokens: number;
};

type TimingData = {
  endToEndDurationMs?: number;
  sandboxStartupMode?: string;
  generationDurationMs?: number;
  phaseDurationsMs?: Record<string, number>;
  phaseTimestamps?: Array<{ phase: string; at: string; elapsedMs: number }>;
};

type SlowestRow = {
  generationId: string;
  conversationId: string;
  conversationTitle: string | null;
  userId: string | null;
  userEmail: string | null;
  model: string | null;
  endToEndMs: number;
  sandboxMs: number | null;
  modelStreamMs: number | null;
  ttfvoMs: number | null;
  sandboxMode: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  timing: TimingData;
};

// ---------------------------------------------------------------------------
// Utility functions (analytics)
// ---------------------------------------------------------------------------

type Deltas = {
  p50E2EDelta: number | null;
  p95E2EDelta: number | null;
  p50TtfvoDelta: number | null;
  sandboxReuseDelta: number | null;
};

function pctChange(prev: number, curr: number) {
  return prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
}

function avg(arr: number[]) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function rateAvg(arr: Array<{ reused: number; total: number }>) {
  const totReused = arr.reduce((s, d) => s + d.reused, 0);
  const totAll = arr.reduce((s, d) => s + d.total, 0);
  return totAll > 0 ? (totReused / totAll) * 100 : 0;
}

function computeDeltas(
  latencyOverTime: Array<{ p50EndToEndMs: number; p95EndToEndMs: number; p50TtfvoMs: number }>,
  sandboxOverTime: Array<{ reused: number; total: number }>,
): Deltas {
  const mid = Math.floor(latencyOverTime.length / 2);
  if (mid < 1) {
    return { p50E2EDelta: null, p95E2EDelta: null, p50TtfvoDelta: null, sandboxReuseDelta: null };
  }

  const firstHalf = latencyOverTime.slice(0, mid);
  const secondHalf = latencyOverTime.slice(mid);

  const p50E2EPrev = avg(firstHalf.map((d) => d.p50EndToEndMs));
  const p50E2ECurr = avg(secondHalf.map((d) => d.p50EndToEndMs));
  const p95E2EPrev = avg(firstHalf.map((d) => d.p95EndToEndMs));
  const p95E2ECurr = avg(secondHalf.map((d) => d.p95EndToEndMs));
  const p50TtfvoPrev = avg(firstHalf.map((d) => d.p50TtfvoMs));
  const p50TtfvoCurr = avg(secondHalf.map((d) => d.p50TtfvoMs));

  let sandboxReuseDelta: number | null = null;
  const sbMid = Math.floor(sandboxOverTime.length / 2);
  if (sbMid >= 1) {
    const sbFirst = sandboxOverTime.slice(0, sbMid);
    const sbSecond = sandboxOverTime.slice(sbMid);
    sandboxReuseDelta = pctChange(rateAvg(sbFirst), rateAvg(sbSecond));
  }

  return {
    p50E2EDelta: pctChange(p50E2EPrev, p50E2ECurr),
    p95E2EDelta: pctChange(p95E2EPrev, p95E2ECurr),
    p50TtfvoDelta: pctChange(p50TtfvoPrev, p50TtfvoCurr),
    sandboxReuseDelta,
  };
}

function detectAnomalies(values: number[], windowSize = 5, threshold = 2): boolean[] {
  const result = Array.from<boolean>({ length: values.length }).fill(false);
  if (values.length < windowSize + 1) {
    return result;
  }
  for (let i = windowSize; i < values.length; i++) {
    const window = values.slice(i - windowSize, i);
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    const std = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length);
    if (std > 0 && Math.abs(values[i] - mean) > threshold * std) {
      result[i] = true;
    }
  }
  return result;
}

type HealthStatus = { level: "healthy" | "degraded" | "critical"; reasons: string[] };

function computeHealthStatus(data: {
  summary: { p95EndToEndMs: number; sandboxReuseRate: number; totalMessages: number };
  latencyOverTime: Array<{ p95EndToEndMs: number }>;
}): HealthStatus {
  const reasons: string[] = [];
  let level: HealthStatus["level"] = "healthy";

  if (data.summary.totalMessages === 0) {
    return { level: "healthy", reasons: ["No data in selected period"] };
  }

  if (data.summary.p95EndToEndMs > 120_000) {
    reasons.push(`P95 E2E is ${formatDurationDisplay(data.summary.p95EndToEndMs)} (>2min)`);
    level = "critical";
  } else if (data.summary.p95EndToEndMs > 60_000) {
    reasons.push(`P95 E2E is ${formatDurationDisplay(data.summary.p95EndToEndMs)} (>1min)`);
    level = "degraded";
  }

  if (data.summary.sandboxReuseRate < 20) {
    reasons.push(`Sandbox reuse is ${data.summary.sandboxReuseRate}% (<20%)`);
    level = "critical";
  } else if (data.summary.sandboxReuseRate < 40) {
    reasons.push(`Sandbox reuse is ${data.summary.sandboxReuseRate}% (<40%)`);
    if (level !== "critical") {
      level = "degraded";
    }
  }

  // Check for recent P95 regression
  const lot = data.latencyOverTime;
  if (lot.length >= 5) {
    const recent = lot.slice(-2);
    const preceding = lot.slice(-5, -2);
    const avgRecent = recent.reduce((s, d) => s + d.p95EndToEndMs, 0) / recent.length;
    const avgPreceding = preceding.reduce((s, d) => s + d.p95EndToEndMs, 0) / preceding.length;
    if (avgPreceding > 0 && avgRecent / avgPreceding > 1.5) {
      const pct = Math.round(((avgRecent - avgPreceding) / avgPreceding) * 100);
      reasons.push(`P95 spiked ${pct}% in last 2 data points`);
      if (level !== "critical") {
        level = "degraded";
      }
    }
  }

  return { level, reasons };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChartDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "never";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
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

// ---------------------------------------------------------------------------
// Impersonate + redirect
// ---------------------------------------------------------------------------

function ImpersonateLink({
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

function HealthBanner({ status }: { status: HealthStatus }) {
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
// Tooltips
// ---------------------------------------------------------------------------

function LatencyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>
      {payload.map((entry) => (
        <LatencyTooltipEntry
          key={entry.name}
          name={entry.name}
          value={entry.value}
          color={entry.color}
        />
      ))}
    </div>
  );
}

function LatencyTooltipEntry({
  name,
  value,
  color,
}: {
  name: string;
  value: number;
  color: string;
}) {
  const dotStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={dotStyle} />
      <span>{name}</span>
      <span className="text-foreground ml-auto font-medium">{formatDurationDisplay(value)}</span>
    </div>
  );
}

function PhaseTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { phase: string; avgMs: number; pct: number; color: string } }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const { phase, avgMs, pct } = payload[0].payload;
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{phase}</p>
      <p className="text-muted-foreground">
        Avg: {formatDurationDisplay(avgMs)} ({pct}%)
      </p>
    </div>
  );
}

function StackedPhaseTooltipEntry({
  name,
  value,
  color,
  total,
}: {
  name: string;
  value: number;
  color: string;
  total: number;
}) {
  const dotStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={dotStyle} />
      <span>{name}</span>
      <span className="text-foreground ml-auto font-medium">
        {formatDurationDisplay(value)} ({pct}%)
      </span>
    </div>
  );
}

function StackedPhaseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Array<{ name: string; value: number; color: string; payload: any }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const total = payload.reduce((s, e) => s + (e.value || 0), 0);
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>
      {payload
        .filter((e) => e.value > 0)
        .toReversed()
        .map((entry) => (
          <StackedPhaseTooltipEntry
            key={entry.name}
            name={entry.name}
            value={entry.value}
            color={entry.color}
            total={total}
          />
        ))}
      <div className="text-muted-foreground mt-1 border-t pt-1">
        Total: {formatDurationDisplay(total)}
      </div>
    </div>
  );
}

function SandboxTooltipEntry({
  name,
  value,
  color,
}: {
  name: string;
  value: number;
  color: string;
}) {
  const dotStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={dotStyle} />
      <span className="capitalize">{name}</span>
      <span className="text-foreground ml-auto font-medium">{value}</span>
    </div>
  );
}

function SandboxTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>
      {payload.map((entry) => (
        <SandboxTooltipEntry
          key={entry.name}
          name={entry.name}
          value={entry.value}
          color={entry.color}
        />
      ))}
    </div>
  );
}

const latencyTooltipElement = <LatencyTooltip />;
const phaseTooltipElement = <PhaseTooltip />;
const stackedPhaseTooltipElement = <StackedPhaseTooltip />;
const sandboxTooltipElement = <SandboxTooltip />;

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const modelColumns: ColumnDef<ModelRow, unknown>[] = [
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
  },
  {
    accessorKey: "generationCount",
    header: "Count",
    meta: { align: "right" as const },
  },
  {
    accessorKey: "p50EndToEndMs",
    header: "P50 E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "p95EndToEndMs",
    header: "P95 E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "p50TtfvoMs",
    header: "P50 TTFVO",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDurationDisplay(getValue<number>()),
  },
  {
    accessorKey: "avgTokens",
    header: "Avg Tokens",
    meta: { align: "right" as const },
    cell: ({ getValue }) => getValue<number>().toLocaleString(),
  },
];

const slowestColumns: ColumnDef<SlowestRow, unknown>[] = [
  {
    id: "expander",
    header: "",
    size: 32,
    enableSorting: false,
    cell: ({ row }) =>
      row.getIsExpanded() ? (
        <ChevronDown className="text-muted-foreground size-4" />
      ) : (
        <ChevronRight className="text-muted-foreground size-4" />
      ),
  },
  {
    accessorKey: "createdAt",
    header: "Time",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(getValue<Date | null>())}
      </span>
    ),
  },
  {
    accessorKey: "conversationTitle",
    header: "Conversation",
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string | null>() ?? "Untitled"}</span>
    ),
  },
  {
    accessorKey: "userEmail",
    header: "User",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {getValue<string | null>() ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {getValue<string | null>() ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "endToEndMs",
    header: "E2E",
    meta: { align: "right" as const },
    cell: ({ getValue }) => (
      <span className="font-medium tabular-nums">{formatDurationDisplay(getValue<number>())}</span>
    ),
  },
  {
    accessorKey: "sandboxMode",
    header: "Sandbox",
    cell: ({ getValue }) => {
      const mode = getValue<string | null>();
      if (!mode) {
        return "—";
      }
      return (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            mode === "reused"
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {mode}
        </span>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Flame chart (Perfetto-style per-generation waterfall)
// ---------------------------------------------------------------------------

type FlameSpan = {
  name: string;
  label: string;
  color: string;
  depth: number;
  startMs: number;
  durationMs: number;
};

function buildFlameSpans(timing: TimingData): FlameSpan[] {
  const phaseTimestamps = timing.phaseTimestamps;
  const phaseDurations = timing.phaseDurationsMs;

  if (phaseTimestamps?.length) {
    const phaseTimes = new Map<string, number>();
    for (const entry of phaseTimestamps) {
      const parsed = Date.parse(entry.at);
      if (Number.isFinite(parsed) && !phaseTimes.has(entry.phase)) {
        phaseTimes.set(entry.phase, parsed);
      }
    }

    const generationStarted = phaseTimes.get("generation_started");
    const allTimes = [...phaseTimes.values()];
    const originMs = generationStarted ?? (allTimes.length > 0 ? Math.min(...allTimes) : null);
    if (originMs === null) {
      return [];
    }

    const PHASE_SPECS: Array<{
      name: string;
      startPhases: string[];
      endPhases: string[];
      durationKey?: string;
    }> = [
      {
        name: "generation_to_first_token",
        startPhases: ["generation_started"],
        endPhases: ["first_token_emitted"],
        durationKey: "generationToFirstTokenMs",
      },
      {
        name: "generation_to_first_visible_output",
        startPhases: ["generation_started"],
        endPhases: ["first_visible_output_emitted", "first_token_emitted"],
        durationKey: "generationToFirstVisibleOutputMs",
      },
      {
        name: "agent_init",
        startPhases: ["agent_init_started"],
        endPhases: ["agent_init_ready"],
        durationKey: "agentInitMs",
      },
      {
        name: "prompt_to_first_visible_output",
        startPhases: ["prompt_sent"],
        endPhases: ["first_visible_output_emitted", "first_token_emitted"],
        durationKey: "promptToFirstVisibleOutputMs",
      },
      {
        name: "sandbox_connect_or_create",
        startPhases: ["sandbox_init_checking_cache", "sandbox_init_started"],
        endPhases: ["sandbox_init_reused", "sandbox_init_created"],
        durationKey: "sandboxConnectOrCreateMs",
      },
      {
        name: "opencode_ready",
        startPhases: ["agent_init_opencode_starting", "agent_init_started"],
        endPhases: ["agent_init_opencode_ready"],
        durationKey: "opencodeReadyMs",
      },
      {
        name: "session_ready",
        startPhases: ["agent_init_session_creating", "agent_init_started"],
        endPhases: ["agent_init_session_init_completed", "agent_init_session_reused"],
        durationKey: "sessionReadyMs",
      },
      {
        name: "pre_prompt_setup",
        startPhases: ["pre_prompt_setup_started"],
        endPhases: ["prompt_sent"],
        durationKey: "prePromptSetupMs",
      },
      {
        name: "wait_for_first_event",
        startPhases: ["prompt_sent"],
        endPhases: ["first_event_received"],
        durationKey: "waitForFirstEventMs",
      },
      {
        name: "model_stream",
        startPhases: ["first_event_received"],
        endPhases: ["session_idle", "prompt_completed"],
        durationKey: "modelStreamMs",
      },
      {
        name: "post_processing",
        startPhases: ["post_processing_started"],
        endPhases: ["post_processing_completed"],
        durationKey: "postProcessingMs",
      },
    ];

    const spans: FlameSpan[] = [];
    for (const spec of PHASE_SPECS) {
      const flameDef = FLAME_PHASES.find((f) => f.name === spec.name);
      if (!flameDef) {
        continue;
      }

      let startMs: number | undefined;
      let endMs: number | undefined;
      for (const p of spec.startPhases) {
        const t = phaseTimes.get(p);
        if (t !== undefined) {
          startMs = t;
          break;
        }
      }
      for (const p of spec.endPhases) {
        const t = phaseTimes.get(p);
        if (t !== undefined) {
          endMs = t;
          break;
        }
      }

      if (startMs !== undefined && endMs !== undefined && endMs >= startMs) {
        spans.push({
          name: spec.name,
          label: flameDef.label,
          color: flameDef.color,
          depth: flameDef.depth,
          startMs: startMs - originMs,
          durationMs: endMs - startMs,
        });
      } else if (spec.durationKey && phaseDurations?.[spec.durationKey] !== undefined) {
        const dur = phaseDurations[spec.durationKey];
        if (startMs !== undefined) {
          spans.push({
            name: spec.name,
            label: flameDef.label,
            color: flameDef.color,
            depth: flameDef.depth,
            startMs: startMs - originMs,
            durationMs: dur,
          });
        }
      }
    }
    return spans.toSorted((a, b) => a.startMs - b.startMs || a.depth - b.depth);
  }

  if (!phaseDurations) {
    return [];
  }
  const spans: FlameSpan[] = [];
  for (const def of FLAME_PHASES) {
    const dur = phaseDurations[def.durationKey];
    if (dur && dur > 0) {
      spans.push({ ...def, startMs: 0, durationMs: dur });
    }
  }
  return spans;
}

const ROW_HEIGHT = 24;
const ROW_GAP = 2;

function FlameChart({ timing }: { timing: TimingData }) {
  const spans = useMemo(() => buildFlameSpans(timing), [timing]);
  const maxDepth = spans.length > 0 ? Math.max(...spans.map((s) => s.depth)) : 0;
  const totalDuration =
    spans.length > 0 ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) : 0;
  const chartHeight = (maxDepth + 1) * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
  const containerStyle = useMemo(() => ({ height: chartHeight }), [chartHeight]);

  if (spans.length === 0) {
    return <p className="text-muted-foreground text-xs">No phase data available</p>;
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto" style={containerStyle}>
        {spans.map((span) => {
          const left = totalDuration > 0 ? (span.startMs / totalDuration) * 100 : 0;
          const width = totalDuration > 0 ? (span.durationMs / totalDuration) * 100 : 0;
          const top = span.depth * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;

          return <FlameBar key={span.name} span={span} left={left} width={width} top={top} />;
        })}
      </div>
      <div className="text-muted-foreground flex justify-between text-[10px] tabular-nums">
        <span>0s</span>
        <span>{formatDurationDisplay(totalDuration / 4)}</span>
        <span>{formatDurationDisplay(totalDuration / 2)}</span>
        <span>{formatDurationDisplay((totalDuration * 3) / 4)}</span>
        <span>{formatDurationDisplay(totalDuration)}</span>
      </div>
    </div>
  );
}

function FlameBar({
  span,
  left,
  width,
  top,
}: {
  span: FlameSpan;
  left: number;
  width: number;
  top: number;
}) {
  const style = useMemo(
    () => ({
      left: `${left}%`,
      width: `${Math.max(width, 0.3)}%`,
      top,
      height: ROW_HEIGHT,
      backgroundColor: span.color,
    }),
    [left, width, top, span.color],
  );

  return (
    <div
      className="absolute overflow-hidden rounded-sm text-[10px] font-medium text-white"
      style={style}
      title={`${span.label}: ${formatDurationDisplay(span.durationMs)}`}
    >
      <span className="block truncate px-1 leading-6">{span.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small Multiple Phase Chart
// ---------------------------------------------------------------------------

const SMALL_CHART_MARGIN = { top: 2, right: 0, left: 0, bottom: 0 };

function PhaseSmallMultiple({
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

function SlowestSubRow({ row }: { row: SlowestRow }) {
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
        <Link
          to="/admin"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
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

// ---------------------------------------------------------------------------
// Day button
// ---------------------------------------------------------------------------

function DayButton({
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

function SandboxFilterButton({
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

function StatCard({
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
