import { beforeAll, describe, expect, test } from "vitest";
import {
  ensureCliAuth,
  liveEnabled,
  resolveLiveModel,
  runChatMessage,
  waitForGenerationTerminalState,
} from "./live-fixtures";

const stallRunCount = Number(process.env.E2E_RUNTIME_PROGRESS_STALL_RUNS ?? "3");
const stallWatchdog = process.env.E2E_RUNTIME_PROGRESS_STALL_TIMEOUT ?? "10s";
const commandSleepSeconds = Number(process.env.E2E_RUNTIME_PROGRESS_STALL_SLEEP_SECONDS ?? "30");
const stallTimeoutMs = Number(process.env.E2E_RUNTIME_PROGRESS_STALL_TEST_TIMEOUT_MS ?? "240000");
const stallWatchdogMs = parseDurationMs(stallWatchdog);

let liveModel = "";

function extractGenerationId(output: string): string {
  const match = output.match(/\[generation\]\s+([^\s]+)/);
  if (!match?.[1]) {
    throw new Error(`Missing generation id in output:\n${output}`);
  }
  return match[1];
}

function parseDurationMs(value: string): number {
  const match = value.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!match?.[1]) {
    throw new Error(`Unsupported duration: ${value}`);
  }
  const amount = Number(match[1]);
  switch (match[2] ?? "ms") {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    default:
      throw new Error(`Unsupported duration: ${value}`);
  }
}

function runtimeDiagnosticSnapshot(record: {
  debugInfo: Record<string, unknown> | null;
}): Record<string, unknown> {
  const snapshot = record.debugInfo?.runtimeDiagnosticSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`Missing runtime diagnostic snapshot: ${JSON.stringify(record.debugInfo)}`);
  }
  return snapshot as Record<string, unknown>;
}

describe.runIf(liveEnabled)("@live CLI runtime progress stall", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "reproduces runtime_progress_stalled after real runtime progress",
    { timeout: Math.max(stallTimeoutMs * stallRunCount, 300_000) },
    async () => {
      const failures: string[] = [];
      let reproducedCount = 0;

      const runAttempt = async (attempt: number): Promise<void> => {
        if (attempt > stallRunCount) {
          return;
        }

        const marker = `runtime-progress-stall-${Date.now().toString(36)}-${attempt}`;
        const result = await runChatMessage({
          message: [
            `Diagnostic marker: ${marker}.`,
            `Use the bash tool to run exactly: sleep ${commandSleepSeconds}`,
            "Wait for the command to finish before replying.",
            "Do not write any assistant text before running the command.",
          ].join(" "),
          model: liveModel,
          autoApprove: true,
          chaosRuntimeNoProgress: stallWatchdog,
          timeoutMs: stallTimeoutMs,
        });

        try {
          expect(result.stdout).toContain("[tool_use]");
          expect(result.stdout).toContain("[error]");
          expect(result.stdout).toContain("The runtime stopped making progress. Please retry.");

          const generationId = extractGenerationId(result.stdout);
          const record = await waitForGenerationTerminalState({
            generationId,
            expectedStatus: "error",
            completionReason: "runtime_progress_stalled",
            timeoutMs: 30_000,
          });
          const snapshot = runtimeDiagnosticSnapshot(record);

          expect(record.errorMessage).toBe("The runtime stopped making progress. Please retry.");
          expect(snapshot.reason).toBe("runtime_progress_stalled");
          expect(snapshot.timeoutMs).toBe(stallWatchdogMs);
          expect(snapshot.stalledMs).toEqual(expect.any(Number));
          expect(snapshot.lastRuntimeProgressAt).toBe(record.lastRuntimeProgressAt);
          expect(snapshot.lastRuntimeProgressKind).toMatch(
            /^(tool_use|tool_result|text_delta|reasoning_delta)$/,
          );
          expect(snapshot.eventStats).toEqual(
            expect.objectContaining({
              progressEventCount: expect.any(Number),
              toolCallCount: expect.any(Number),
            }),
          );

          const eventStats = snapshot.eventStats as {
            progressEventCount?: number;
            toolCallCount?: number;
          };
          expect(eventStats.progressEventCount).toBeGreaterThan(0);
          expect(eventStats.toolCallCount).toBeGreaterThan(0);
          reproducedCount += 1;
        } catch (error) {
          failures.push(
            `attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        await runAttempt(attempt + 1);
      };

      await runAttempt(1);

      const unreproducedFailures = reproducedCount === 0 ? failures : [];
      expect(unreproducedFailures).toEqual([]);
      expect(reproducedCount).toBeGreaterThan(0);
    },
  );
});
