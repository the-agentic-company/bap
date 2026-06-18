// ---------------------------------------------------------------------------
// Flame chart (Perfetto-style per-generation waterfall)
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { formatDurationDisplay, type TimingData } from "./analytics";
import { FLAME_PHASES } from "./constants";

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

export function FlameChart({ timing }: { timing: TimingData }) {
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
