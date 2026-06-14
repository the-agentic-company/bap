// ---------------------------------------------------------------------------
// Chart constants
// ---------------------------------------------------------------------------

import { formatDurationDisplay } from "./analytics";

export const CHART_MARGIN = { top: 4, right: 4, left: 0, bottom: 0 };
export const CHART_MARGIN_WATERFALL = { top: 4, right: 4, left: 140, bottom: 0 };
export const TICK_STYLE = { fontSize: 11 };
export const CURSOR_STYLE = { fill: "var(--color-muted)", opacity: 0.4 };
export const LEGEND_STYLE = { fontSize: 12, paddingTop: 12 };
export const BAR_RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0];
export const BAR_RADIUS_TOP: [number, number, number, number] = [2, 2, 0, 0];
export const EMPTY_LATENCY: Array<{
  p50EndToEndMs: number;
  p95EndToEndMs: number;
  p50TtfvoMs: number;
  messageCount: number;
  date: string;
}> = [];

export function formatDurationTick(v: number) {
  return formatDurationDisplay(v);
}

export function formatVolumeTick(v: number) {
  return `${v}`;
}

export function formatPctLabel(v: unknown) {
  return `${v}%`;
}

export const LABEL_STYLE = { fontSize: 11, fill: "var(--color-muted-foreground)" };
export const SPARK_MARGIN = { top: 2, right: 0, left: 0, bottom: 2 };

export const PHASE_COLORS: Record<string, string> = {
  "Sandbox Connect": "#64748b",
  "OpenCode Ready": "#3b82f6",
  "Session Ready": "#06b6d4",
  "Pre-prompt Setup": "#8b5cf6",
  "Wait for First Event": "#f59e0b",
  "Prompt to First Token": "#f97316",
  "Model Stream": "#22c55e",
  "Post-processing": "#a1a1aa",
};

export const LINE_COLORS = {
  p50EndToEnd: "#3b82f6",
  p95EndToEnd: "#ef4444",
  p50Ttfvo: "#22c55e",
};

export const PHASE_TREND_DEFS = [
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
export const STACKED_PHASE_KEYS = [
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
export const FLAME_PHASES: Array<{
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
