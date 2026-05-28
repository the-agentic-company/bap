import {
  describePromptResultData,
  summarizeUnknownValue,
  type OpenCodeRuntimeEventLoopSnapshot,
} from "../runtime/opencode/opencode-runtime-driver";
import type { RuntimeHarnessClient, SandboxHandle } from "../sandbox/core/types";
import { uploadToS3 } from "../storage/s3-client";
import type { GenerationContext } from "./generation/types";
import type { RuntimeProgressKind } from "./lifecycle-policy";

const SNAPSHOT_CONTENT_TYPE = "application/json";
const SNAPSHOT_PREFIX = "runtime-diagnostic-snapshots";

type RuntimeDiagnosticSnapshotReason =
  | "runtime_no_progress_after_prompt"
  | "runtime_progress_stalled";

export type RuntimeDiagnosticSnapshotIndex = {
  id: string;
  storageKey?: string | null;
  capturedAt: string;
  reason: RuntimeDiagnosticSnapshotReason;
  phase: "prompt_sent";
  timeoutMs: number;
  stalledMs?: number | null;
  lastRuntimeProgressAt?: string | null;
  lastRuntimeProgressKind?: RuntimeProgressKind | null;
  uploadSucceeded: boolean;
  uploadError?: string | null;
  sessionId?: string | null;
  sandboxId?: string | null;
  runtimeHarness?: string | null;
  runtimeProtocolVersion?: string | null;
  eventStats?: {
    eventCount: number;
    progressEventCount: number;
    toolCallCount: number;
    permissionCount: number;
    questionCount: number;
  };
};

type RuntimeDiagnosticSnapshotPayload = {
  schemaVersion: "2026-05-25.runtime-diagnostic-snapshot.v1";
  id: string;
  capturedAt: string;
  reason: RuntimeDiagnosticSnapshotReason;
  phase: "prompt_sent";
  timeoutMs: number;
  stalledMs?: number | null;
  generation: {
    id: string;
    conversationId: string;
    userId: string;
    traceId: string;
    status: string;
    completionReason?: string | null;
    model: string;
  };
  runtime: {
    sessionId?: string | null;
    runtimeId?: string | null;
    sandboxId?: string | null;
    sandboxProvider?: string | null;
    runtimeHarness?: string | null;
    runtimeProtocolVersion?: string | null;
  };
  prompt: {
    elapsedMs: number;
  };
  eventStream: OpenCodeRuntimeEventLoopSnapshot;
  lastRuntimeProgress?: {
    at: string | null;
    kind: RuntimeProgressKind | null;
    stalledMs: number | null;
  };
  probes: {
    sessionGet: RuntimeProbeSummary;
    messages: RuntimeProbeSummary;
    status: RuntimeProbeSummary;
    opencodeLogTail: string | null;
    opencodeLogReadError: string | null;
  };
};

type RuntimeProbeSummary = {
  ok: boolean;
  shape: string | null;
  detail: string | null;
  error: string | null;
};

type SnapshotSandbox = Pick<SandboxHandle, "readFile">;

export function buildRuntimeDiagnosticSnapshotStorageKey(input: {
  generationId: string;
  snapshotId: string;
}): string {
  return `${SNAPSHOT_PREFIX}/${input.generationId}/${input.snapshotId}.json`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return summarizeUnknownValue(error, 500);
}

function tailLogText(text: string, maxLines = 120, maxChars = 8_000): string {
  const lines = text.split("\n");
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length > maxChars ? `...${tail.slice(-maxChars)}` : tail;
}

function summarizeDiagnosticValue(value: unknown, depth = 0): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `string(length=${value.length})`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return typeof value;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `array(${value.length})`;
    }
    return `array(${value.length})[${value
      .slice(0, 3)
      .map((entry) => summarizeDiagnosticValue(entry, depth + 1))
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const safeEntries = entries.filter(
      ([key]) =>
        !/prompt|content|output|authorization|cookie|token|secret|tool[_-]?input|tool[_-]?result|file[_-]?content|env/i.test(
          key,
        ),
    );
    const redactedKeyCount = entries.length - safeEntries.length;
    if (depth >= 2) {
      return `object(keys=${safeEntries
        .map(([key]) => key)
        .slice(0, 8)
        .join(",")};redacted=${redactedKeyCount})`;
    }
    const fields = safeEntries
      .slice(0, 8)
      .map(([key, entry]) => `${key}:${summarizeDiagnosticValue(entry, depth + 1)}`)
      .join(",");
    return `object(${fields};redacted=${redactedKeyCount})`;
  }
  return typeof value;
}

function summarizeLogTail(rawLog: string): string | null {
  const tail = tailLogText(rawLog);
  const lines = tail.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  const eventTypes = lines
    .map((line) => line.match(/\btype=([a-z0-9_.-]+)/i)?.[1] ?? null)
    .filter((value): value is string => !!value)
    .slice(-20);
  return `lines=${lines.length};chars=${tail.length};eventTypes=${eventTypes.join(",")}`;
}

async function summarizeProbe(
  run: () => Promise<{ data: unknown; error: unknown }>,
): Promise<RuntimeProbeSummary> {
  try {
    const result = await run();
    if (result.error) {
      return {
        ok: false,
        shape: null,
        detail: null,
        error: formatError(result.error),
      };
    }
    return {
      ok: true,
      shape: describePromptResultData(result.data),
      detail:
        result.data === null || result.data === undefined
          ? null
          : summarizeDiagnosticValue(result.data),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      shape: null,
      detail: null,
      error: formatError(error),
    };
  }
}

export async function captureRuntimeNoProgressDiagnosticSnapshot(input: {
  ctx: GenerationContext;
  runtimeClient: RuntimeHarnessClient;
  sandbox?: SnapshotSandbox | null;
  sandboxProvider?: string | null;
  sessionId: string;
  reason?: RuntimeDiagnosticSnapshotReason;
  timeoutMs: number;
  stalledMs?: number | null;
  lastRuntimeProgressAt?: Date | null;
  lastRuntimeProgressKind?: RuntimeProgressKind | null;
  promptSentAtMs: number;
  eventLoopSnapshot: OpenCodeRuntimeEventLoopSnapshot;
}): Promise<RuntimeDiagnosticSnapshotIndex> {
  const capturedAt = new Date().toISOString();
  const snapshotId = crypto.randomUUID();
  const storageKey = buildRuntimeDiagnosticSnapshotStorageKey({
    generationId: input.ctx.id,
    snapshotId,
  });

  const [sessionGet, messages, status] = await Promise.all([
    summarizeProbe(() =>
      input.runtimeClient.getSession({ sessionID: input.sessionId }),
    ),
    summarizeProbe(() =>
      input.runtimeClient.messages({ sessionID: input.sessionId, limit: 20 }),
    ),
    input.runtimeClient.status
      ? summarizeProbe(() => input.runtimeClient.status!())
      : Promise.resolve({
          ok: false,
          shape: null,
          detail: null,
          error: "Runtime client does not expose status().",
        }),
  ]);

  let opencodeLogTail: string | null = null;
  let opencodeLogReadError: string | null = null;
  if (input.sandbox) {
    try {
      const rawLog = await input.sandbox.readFile("/tmp/opencode.log");
      opencodeLogTail = rawLog.trim() ? summarizeLogTail(rawLog) : null;
    } catch (error) {
      opencodeLogReadError = formatError(error);
    }
  }

  const payload: RuntimeDiagnosticSnapshotPayload = {
    schemaVersion: "2026-05-25.runtime-diagnostic-snapshot.v1",
    id: snapshotId,
    capturedAt,
    reason: input.reason ?? "runtime_no_progress_after_prompt",
    phase: "prompt_sent",
    timeoutMs: input.timeoutMs,
    stalledMs: input.stalledMs ?? null,
    generation: {
      id: input.ctx.id,
      conversationId: input.ctx.conversationId,
      userId: input.ctx.userId,
      traceId: input.ctx.traceId,
      status: input.ctx.status,
      completionReason: input.ctx.completionReason ?? null,
      model: input.ctx.model,
    },
    runtime: {
      sessionId: input.sessionId,
      runtimeId: input.ctx.runtimeId ?? null,
      sandboxId: input.ctx.sandboxId ?? null,
      sandboxProvider: input.sandboxProvider ?? input.ctx.sandboxProviderOverride ?? null,
      runtimeHarness: input.ctx.runtimeHarness ?? null,
      runtimeProtocolVersion: input.ctx.runtimeProtocolVersion ?? null,
    },
    prompt: {
      elapsedMs: Math.max(0, Date.now() - input.promptSentAtMs),
    },
    eventStream: input.eventLoopSnapshot,
    lastRuntimeProgress: {
      at: input.lastRuntimeProgressAt?.toISOString() ?? null,
      kind: input.lastRuntimeProgressKind ?? null,
      stalledMs: input.stalledMs ?? null,
    },
    probes: {
      sessionGet,
      messages,
      status,
      opencodeLogTail,
      opencodeLogReadError,
    },
  };

  try {
    await uploadToS3(
      storageKey,
      Buffer.from(JSON.stringify(payload, null, 2)),
      SNAPSHOT_CONTENT_TYPE,
    );
    return {
      id: snapshotId,
      storageKey,
      capturedAt,
      reason: input.reason ?? "runtime_no_progress_after_prompt",
      phase: "prompt_sent",
      timeoutMs: input.timeoutMs,
      stalledMs: input.stalledMs ?? null,
      lastRuntimeProgressAt: input.lastRuntimeProgressAt?.toISOString() ?? null,
      lastRuntimeProgressKind: input.lastRuntimeProgressKind ?? null,
      uploadSucceeded: true,
      sessionId: input.sessionId,
      sandboxId: input.ctx.sandboxId ?? null,
      runtimeHarness: input.ctx.runtimeHarness ?? null,
      runtimeProtocolVersion: input.ctx.runtimeProtocolVersion ?? null,
      eventStats: { ...input.eventLoopSnapshot.stats },
    };
  } catch (error) {
    return {
      id: snapshotId,
      storageKey,
      capturedAt,
      reason: input.reason ?? "runtime_no_progress_after_prompt",
      phase: "prompt_sent",
      timeoutMs: input.timeoutMs,
      stalledMs: input.stalledMs ?? null,
      lastRuntimeProgressAt: input.lastRuntimeProgressAt?.toISOString() ?? null,
      lastRuntimeProgressKind: input.lastRuntimeProgressKind ?? null,
      uploadSucceeded: false,
      uploadError: formatError(error),
      sessionId: input.sessionId,
      sandboxId: input.ctx.sandboxId ?? null,
      runtimeHarness: input.ctx.runtimeHarness ?? null,
      runtimeProtocolVersion: input.ctx.runtimeProtocolVersion ?? null,
      eventStats: { ...input.eventLoopSnapshot.stats },
    };
  }
}
