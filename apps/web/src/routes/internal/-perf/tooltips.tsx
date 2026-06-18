// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { formatDurationDisplay } from "./analytics";

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

export const latencyTooltipElement = <LatencyTooltip />;
export const phaseTooltipElement = <PhaseTooltip />;
export const stackedPhaseTooltipElement = <StackedPhaseTooltip />;
export const sandboxTooltipElement = <SandboxTooltip />;
