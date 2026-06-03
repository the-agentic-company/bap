import type { ColumnDef } from "@tanstack/react-table";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useChatOverview } from "@/orpc/hooks";

export const Route = createFileRoute("/admin/chat-overview")({
  head: () => ({ meta: [{ title: "Chat System Health - CmdClaw" }] }),
  component: ChatOverviewPage,
});

// ---------------------------------------------------------------------------
// Chart constants
// ---------------------------------------------------------------------------

const BAR_RADIUS_TOP: [number, number, number, number] = [2, 2, 0, 0];
const BAR_RADIUS_NONE: [number, number, number, number] = [0, 0, 0, 0];
const CHART_MARGIN = { top: 4, right: 4, left: 0, bottom: 0 };
const TICK_STYLE = { fontSize: 11 };
const CURSOR_STYLE = { fill: "var(--color-muted)", opacity: 0.4 };
const LEGEND_STYLE = { fontSize: 12, paddingTop: 12 };

const STATUS_COLORS = {
  completed: "#22c55e",
  error: "#ef4444",
  cancelled: "#f59e0b",
  running: "#3b82f6",
  other: "#a1a1aa",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModelRow = {
  model: string;
  totalGenerations: number;
  errors: number;
  errorRate: number;
  avgTokens: number;
  avgDurationMs: number;
};

type ErrorRow = {
  generationId: string;
  conversationId: string;
  conversationTitle: string | null;
  model: string | null;
  userId: string | null;
  userEmail: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  errorAt: Date | null;
  inputTokens: number;
  outputTokens: number;
};

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

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  const m = Math.floor(s / 60);
  const remainder = Math.round(s % 60);
  return `${m}m ${remainder}s`;
}

function formatRunningTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remainderM = m % 60;
  return `${h}h ${remainderM}m`;
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
        console.error("Failed to impersonate:", result.error);
      } catch (err) {
        console.error("Failed to impersonate:", err);
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
// Column definitions
// ---------------------------------------------------------------------------

const modelColumns: ColumnDef<ModelRow, unknown>[] = [
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
  },
  {
    accessorKey: "totalGenerations",
    header: "Generations",
    meta: { align: "right" as const },
  },
  {
    accessorKey: "errors",
    header: "Errors",
    meta: { align: "right" as const },
  },
  {
    accessorKey: "errorRate",
    header: "Error Rate",
    meta: { align: "right" as const },
    cell: ({ getValue }) => {
      const rate = getValue<number>();
      return <span className={cn(rate > 10 && "font-medium text-red-500")}>{rate}%</span>;
    },
  },
  {
    accessorKey: "avgTokens",
    header: "Avg Tokens",
    meta: { align: "right" as const },
    cell: ({ getValue }) => getValue<number>().toLocaleString(),
  },
  {
    accessorKey: "avgDurationMs",
    header: "Avg Duration",
    meta: { align: "right" as const },
    cell: ({ getValue }) => formatDuration(getValue<number>()),
  },
];

const errorColumns: ColumnDef<ErrorRow, unknown>[] = [
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
    accessorKey: "errorAt",
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
      <span className="text-muted-foreground whitespace-nowrap">{getValue<string | null>()}</span>
    ),
  },
  {
    accessorKey: "errorMessage",
    header: "Error",
    enableSorting: false,
    meta: { className: "max-w-[300px] truncate text-xs text-muted-foreground" },
    cell: ({ getValue }) => getValue<string | null>(),
  },
];

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
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
        <TooltipEntry key={entry.name} name={entry.name} value={entry.value} color={entry.color} />
      ))}
    </div>
  );
}

function TooltipEntry({ name, value, color }: { name: string; value: number; color: string }) {
  const dotStyle = useMemo(() => ({ backgroundColor: color }), [color]);
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={dotStyle} />
      <span className="capitalize">{name}</span>
      <span className="text-foreground ml-auto font-medium">{value}</span>
    </div>
  );
}

const tooltipElement = <ChartTooltip />;

// ---------------------------------------------------------------------------
// Expanded error sub-row
// ---------------------------------------------------------------------------

function ErrorSubRow({ error: e }: { error: ErrorRow }) {
  return (
    <div className="space-y-3">
      {e.errorMessage && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium">Error Message</p>
          <pre className="bg-background max-h-40 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
            {e.errorMessage}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs md:grid-cols-4">
        <div>
          <span className="text-muted-foreground">Generation ID</span>
          <p className="font-mono">{e.generationId.slice(0, 12)}...</p>
        </div>
        <div>
          <span className="text-muted-foreground">Started</span>
          <p>{formatRelativeTime(e.startedAt)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Input Tokens</span>
          <p className="tabular-nums">{e.inputTokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Output Tokens</span>
          <p className="tabular-nums">{e.outputTokens.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <ImpersonateLink userId={e.userId} conversationId={e.conversationId} />
        {e.userEmail && (
          <span className="text-muted-foreground text-xs">Will impersonate {e.userEmail}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ChatOverviewPage() {
  const { data, isLoading } = useChatOverview();

  const renderErrorSubRow = useCallback(
    (row: { original: ErrorRow }) => <ErrorSubRow error={row.original} />,
    [],
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

  const {
    summary,
    dailyGenerations,
    stuckGenerations,
    repeatedFailures,
    modelBreakdown,
    recentErrors,
  } = data;

  const hasAlerts = stuckGenerations.length > 0 || repeatedFailures.length > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/admin"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Chat System Health</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Conversations (30d)" value={summary.totalConversations30d} />
        <StatCard label="Generations (30d)" value={summary.totalGenerations30d} />
        <StatCard
          label="Active Now"
          value={summary.activeGenerations}
          highlight={summary.activeGenerations > 0}
        />
        <StatCard
          label="Error Rate"
          value={`${summary.errorRate}%`}
          subtitle={`${summary.errorGenerations30d} errors`}
          alert={summary.errorRate > 10}
        />
        <StatCard label="Avg Duration" value={formatDuration(summary.avgGenerationMs)} />
      </div>

      {/* Generations over time chart */}
      {dailyGenerations.length > 0 && (
        <div className="rounded-xl border p-4">
          <h2 className="mb-4 text-sm font-medium">Generations over time (30 days)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyGenerations} margin={CHART_MARGIN}>
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
                allowDecimals={false}
              />
              <Tooltip content={tooltipElement} cursor={CURSOR_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar
                dataKey="completed"
                stackId="a"
                fill={STATUS_COLORS.completed}
                radius={BAR_RADIUS_NONE}
              />
              <Bar
                dataKey="error"
                stackId="a"
                fill={STATUS_COLORS.error}
                radius={BAR_RADIUS_NONE}
              />
              <Bar
                dataKey="cancelled"
                stackId="a"
                fill={STATUS_COLORS.cancelled}
                radius={BAR_RADIUS_NONE}
              />
              <Bar
                dataKey="running"
                stackId="a"
                fill={STATUS_COLORS.running}
                radius={BAR_RADIUS_NONE}
              />
              <Bar dataKey="other" stackId="a" fill={STATUS_COLORS.other} radius={BAR_RADIUS_TOP} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Health alerts */}
      {hasAlerts && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertTriangle className="size-4" />
            <span>Health Alerts</span>
          </div>

          {stuckGenerations.length > 0 && (
            <div className="mb-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Stuck generations (running &gt; 10 min)
              </p>
              <div className="space-y-2">
                {stuckGenerations.map((g) => (
                  <div
                    key={g.generationId}
                    className="flex items-center gap-3 rounded-lg bg-red-500/5 px-3 py-2 text-sm"
                  >
                    <Clock className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="font-medium">{g.conversationTitle ?? "Untitled"}</span>
                    <span className="text-muted-foreground text-xs">{g.model}</span>
                    {g.userEmail && (
                      <span className="text-muted-foreground text-xs">{g.userEmail}</span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                        {formatRunningTime(g.runningSeconds)}
                      </span>
                      <ImpersonateLink userId={g.userId} conversationId={g.conversationId} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {repeatedFailures.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Repeated failures (3+ errors in 24h)
              </p>
              <div className="space-y-2">
                {repeatedFailures.map((c) => (
                  <div
                    key={c.conversationId}
                    className="flex items-center gap-3 rounded-lg bg-red-500/5 px-3 py-2 text-sm"
                  >
                    <AlertTriangle className="size-3.5 shrink-0 text-red-500" />
                    <span className="font-medium">{c.conversationTitle ?? "Untitled"}</span>
                    <span className="text-muted-foreground text-xs">{c.model}</span>
                    {c.userEmail && (
                      <span className="text-muted-foreground text-xs">{c.userEmail}</span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                        {c.recentErrors}x errors
                      </span>
                      <ImpersonateLink userId={c.userId} conversationId={c.conversationId} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model usage breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="rounded-xl border">
          <h2 className="px-4 pt-4 text-sm font-medium">Model Breakdown (30d)</h2>
          <DataTable columns={modelColumns} data={modelBreakdown} />
        </div>
      )}

      {/* Recent errors */}
      {recentErrors.length > 0 && (
        <div className="rounded-xl border">
          <h2 className="px-4 pt-4 text-sm font-medium">Recent Errors</h2>
          <DataTable
            columns={errorColumns}
            data={recentErrors}
            expandable
            renderSubRow={renderErrorSubRow}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subtitle,
  alert,
  highlight,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  alert?: boolean;
  highlight?: boolean;
}) {
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
        {subtitle && <p className="text-muted-foreground text-xs">{subtitle}</p>}
      </div>
    </div>
  );
}
