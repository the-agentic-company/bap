import type { DoneArtifactsData, StatusChangeMetadata } from "@bap/client";

export type PrintedRuntimeMetadata = {
  runtime?: string;
  sandbox?: string;
};

export type PrintedGenerationMarkers = {
  generationId?: string;
  conversationId?: string;
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function writeTimingSummary(
  stdout: NodeJS.WriteStream,
  artifacts?: DoneArtifactsData,
): void {
  const timing = artifacts?.timing;
  if (!timing) {
    return;
  }

  stdout.write("[timing] Summary\n");
  if (timing.generationDurationMs !== undefined) {
    stdout.write(`  end_to_end_total: ${formatDurationMs(timing.generationDurationMs)}\n`);
  }
  if (timing.sandboxStartupDurationMs !== undefined) {
    stdout.write(
      `  sandbox_connect_or_create${
        timing.sandboxStartupMode ? ` (${timing.sandboxStartupMode})` : ""
      }: ${formatDurationMs(timing.sandboxStartupDurationMs)}\n`,
    );
  }

  const phaseDurations = timing.phaseDurationsMs;
  if (!phaseDurations) {
    return;
  }

  const rows: Array<[string, number | undefined]> = [
    ["sandbox_connect_or_create", phaseDurations.sandboxConnectOrCreateMs],
    ["opencode_ready", phaseDurations.opencodeReadyMs],
    ["session_ready", phaseDurations.sessionReadyMs],
    ["agent_init", phaseDurations.agentInitMs],
    ["pre_prompt_setup", phaseDurations.prePromptSetupMs],
    ["wait_for_first_event", phaseDurations.waitForFirstEventMs],
    ["prompt_to_first_token", phaseDurations.promptToFirstTokenMs],
    ["generation_to_first_token", phaseDurations.generationToFirstTokenMs],
    ["prompt_to_first_visible_output", phaseDurations.promptToFirstVisibleOutputMs],
    ["generation_to_first_visible_output", phaseDurations.generationToFirstVisibleOutputMs],
  ];

  for (const [label, value] of rows) {
    if (value === undefined) {
      continue;
    }
    stdout.write(`  ${label}: ${formatDurationMs(value)}\n`);
  }
}

function formatKeyValueMarker(
  label: string,
  values: Record<string, string | undefined>,
): string | null {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (entries.length === 0) {
    return null;
  }
  return `[${label}] ${entries.map(([key, value]) => `${key}=${value}`).join(" ")}`;
}

export function printRuntimeMetadata(
  stdout: NodeJS.WriteStream,
  printed: PrintedRuntimeMetadata,
  metadata?: StatusChangeMetadata,
): void {
  if (!shouldPrintRuntimeMetadata(metadata)) {
    return;
  }
  const runtime = formatKeyValueMarker("runtime", {
    id: metadata?.runtimeId,
    harness: metadata?.runtimeHarness,
    protocol: metadata?.runtimeProtocolVersion,
  });
  if (runtime && printed.runtime !== runtime) {
    stdout.write(`${runtime}\n`);
    printed.runtime = runtime;
  }

  const sandbox = formatKeyValueMarker("sandbox", {
    provider: metadata?.sandboxProvider,
    id: metadata?.sandboxId,
    session: metadata?.sessionId,
  });
  if (sandbox && printed.sandbox !== sandbox) {
    stdout.write(`${sandbox}\n`);
    printed.sandbox = sandbox;
  }
}

export function hasCompleteRuntimeMetadata(metadata?: StatusChangeMetadata): boolean {
  return Boolean(
    metadata?.runtimeHarness ||
    metadata?.runtimeProtocolVersion ||
    metadata?.sandboxProvider ||
    metadata?.sessionId,
  );
}

export function shouldPrintRuntimeMetadata(metadata?: StatusChangeMetadata): boolean {
  return hasCompleteRuntimeMetadata(metadata);
}

export function printApprovalParked(
  stdout: NodeJS.WriteStream,
  status: string,
  metadata?: StatusChangeMetadata,
): void {
  if (status !== "approval_parked") {
    return;
  }
  const parked = formatKeyValueMarker("approval_parked", {
    interrupt: metadata?.parkedInterruptId,
    sandbox: metadata?.releasedSandboxId ?? metadata?.sandboxId,
  });
  stdout.write(`${parked ?? "[approval_parked]"}\n`);
}

export function printRunDeadlineParked(
  stdout: NodeJS.WriteStream,
  status: string,
  generationId?: string,
  metadata?: StatusChangeMetadata,
): void {
  if (status !== "run_deadline_parked") {
    return;
  }
  const details = [
    generationId ? `generation=${generationId}` : null,
    `sandbox=${metadata?.releasedSandboxId ?? metadata?.sandboxId}`,
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  stdout.write(
    details.length > 0 ? `[run_deadline_parked] ${details.join(" ")}\n` : "[run_deadline_parked]\n",
  );
}

export function printApprovalDecisionMarker(
  stdout: NodeJS.WriteStream,
  toolUseId: string,
  decision: "approve" | "deny",
): void {
  stdout.write(
    decision === "approve"
      ? `[approval_accepted] ${toolUseId}\n`
      : `[approval_rejected] ${toolUseId}\n`,
  );
}

export function printGenerationMarkers(
  stdout: NodeJS.WriteStream,
  printed: PrintedGenerationMarkers,
  ids: { generationId?: string; conversationId?: string },
): void {
  if (ids.generationId && printed.generationId !== ids.generationId) {
    stdout.write(`[generation] ${ids.generationId}\n`);
    printed.generationId = ids.generationId;
  }
  if (ids.conversationId && printed.conversationId !== ids.conversationId) {
    stdout.write(`[conversation] ${ids.conversationId}\n`);
    printed.conversationId = ids.conversationId;
  }
}
