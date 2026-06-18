// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Days = "1" | "7" | "30";

export type ModelRow = {
  model: string;
  generationCount: number;
  p50EndToEndMs: number;
  p95EndToEndMs: number;
  p50TtfvoMs: number;
  avgTokens: number;
};

export type TimingData = {
  endToEndDurationMs?: number;
  sandboxStartupMode?: string;
  generationDurationMs?: number;
  phaseDurationsMs?: Record<string, number>;
  phaseTimestamps?: Array<{ phase: string; at: string; elapsedMs: number }>;
};

export type SlowestRow = {
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

export type Deltas = {
  p50E2EDelta: number | null;
  p95E2EDelta: number | null;
  p50TtfvoDelta: number | null;
  sandboxReuseDelta: number | null;
};

export function formatDurationDisplay(ms: number | null | undefined): string {
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

export function computeDeltas(
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

export function detectAnomalies(values: number[], windowSize = 5, threshold = 2): boolean[] {
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

export type HealthStatus = { level: "healthy" | "degraded" | "critical"; reasons: string[] };

export function computeHealthStatus(data: {
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

export function formatChartDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatRelativeTime(value?: Date | string | null) {
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
