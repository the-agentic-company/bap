#!/usr/bin/env bun

import { Daytona } from "@daytonaio/sdk";
import { config as loadEnv } from "dotenv";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "../../../.env");
const DEFAULT_API_URL = "http://localhost:3300/api";
const DEFAULT_TARGET = "eu";
const WORKDIR = "/";
const EXEC_TIMEOUT_SECONDS = 60;
const CLEANUP_WAIT_TIMEOUT_MS = 30_000;
const CLEANUP_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SANDBOX_COUNT = 100;
const MIN_RUNTIME_SANDBOX_COUNT = 2;
const LIST_PAGE_SIZE = 200;
const DEFAULT_SMOKE_MODE = "basic";
const DEFAULT_RUNTIME_MODEL = "openai/gpt-5.4-mini";
const DEFAULT_RUNTIME_BATCHES = 4;
const DEFAULT_RUNTIME_CONCURRENCY = 4;
const DEFAULT_RUNTIME_HOLD_MS = 5_000;
const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 30_000;
const DEFAULT_CMDCLAW_DAYTONA_SNAPSHOT = "bap-agent-dev";

loadEnv({ path: ENV_PATH });

type DaytonaProcessResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
  artifacts?: {
    stdout?: string;
  };
};

type DaytonaSandboxHandle = {
  id: string;
  name: string;
  delete: () => Promise<void>;
  getPreviewLink?: (port: number) => Promise<{ url: string; token?: string }>;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<DaytonaProcessResult>;
  };
  fs: {
    downloadFile: (remotePath: string, timeout?: number) => Promise<Buffer | string | Uint8Array>;
  };
};

type DaytonaSandboxStateSnapshot = {
  id: string;
  name: string;
  state?: string | null;
};

type SmokeMode = "basic" | "runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function getRequestedSandboxCount(): number {
  const raw = process.env.DAYTONA_SELFHOST_SMOKE_SANDBOX_COUNT;
  if (!raw) {
    return DEFAULT_SANDBOX_COUNT;
  }

  const count = Number.parseInt(raw, 10);
  assert(
    Number.isInteger(count) && count >= MIN_RUNTIME_SANDBOX_COUNT,
    `DAYTONA_SELFHOST_SMOKE_SANDBOX_COUNT must be an integer >= ${MIN_RUNTIME_SANDBOX_COUNT}. Received: ${raw}`,
  );
  return count;
}

function getSmokeMode(): SmokeMode {
  const mode = (process.env.DAYTONA_SELFHOST_SMOKE_MODE ?? DEFAULT_SMOKE_MODE).trim().toLowerCase();
  assert(
    mode === "basic" || mode === "runtime",
    `DAYTONA_SELFHOST_SMOKE_MODE must be "basic" or "runtime". Received: ${mode}`,
  );
  return mode;
}

function getRuntimeBatches(): number {
  const raw = process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_BATCHES;
  if (!raw) {
    return DEFAULT_RUNTIME_BATCHES;
  }

  const count = Number.parseInt(raw, 10);
  assert(
    Number.isInteger(count) && count >= 1,
    `DAYTONA_SELFHOST_SMOKE_RUNTIME_BATCHES must be an integer >= 1. Received: ${raw}`,
  );
  return count;
}

function getRuntimeConcurrency(): number {
  const raw = process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_CONCURRENCY;
  if (!raw) {
    return DEFAULT_RUNTIME_CONCURRENCY;
  }

  const count = Number.parseInt(raw, 10);
  assert(
    Number.isInteger(count) && count >= 1,
    `DAYTONA_SELFHOST_SMOKE_RUNTIME_CONCURRENCY must be an integer >= 1. Received: ${raw}`,
  );
  return count;
}

function getRuntimeHoldMs(): number {
  const raw = process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_HOLD_MS;
  if (!raw) {
    return DEFAULT_RUNTIME_HOLD_MS;
  }

  const count = Number.parseInt(raw, 10);
  assert(
    Number.isInteger(count) && count >= 0,
    `DAYTONA_SELFHOST_SMOKE_RUNTIME_HOLD_MS must be an integer >= 0. Received: ${raw}`,
  );
  return count;
}

function getRuntimeReadyTimeoutMs(): number {
  const raw = process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_READY_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_RUNTIME_READY_TIMEOUT_MS;
  }

  const count = Number.parseInt(raw, 10);
  assert(
    Number.isInteger(count) && count >= 1_000,
    `DAYTONA_SELFHOST_SMOKE_RUNTIME_READY_TIMEOUT_MS must be an integer >= 1000. Received: ${raw}`,
  );
  return count;
}

function getRuntimeModel(): string {
  const model = (process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_MODEL ?? DEFAULT_RUNTIME_MODEL).trim();
  assert(model.length > 0, "DAYTONA_SELFHOST_SMOKE_RUNTIME_MODEL must not be empty.");
  return model;
}

function getRuntimeSnapshot(): string {
  const snapshot = (
    process.env.DAYTONA_SELFHOST_SMOKE_RUNTIME_SNAPSHOT ??
    process.env.E2B_DAYTONA_SANDBOX_NAME ??
    DEFAULT_CMDCLAW_DAYTONA_SNAPSHOT
  ).trim();
  assert(snapshot.length > 0, "DAYTONA_SELFHOST_SMOKE_RUNTIME_SNAPSHOT must not be empty.");
  return snapshot;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendDaytonaAuth(url: string, token?: string): string {
  if (!token) {
    return url;
  }

  const parsed = new URL(url);
  if (!parsed.searchParams.has("DAYTONA_SANDBOX_AUTH_KEY")) {
    parsed.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  }
  return parsed.toString();
}

function getRuntimeServerPort(model: string): number {
  return model.startsWith("anthropic/") ? 2468 : 4096;
}

function getRuntimeReadinessUrl(baseUrl: string, model: string, token?: string): string {
  const parsed = new URL(baseUrl);
  const path = model.startsWith("anthropic/") ? "/v1/health" : "/health";
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}${path}`;
  return appendDaytonaAuth(parsed.toString(), token);
}

async function waitForRuntimeServer(
  baseUrl: string,
  model: string,
  token?: string,
  maxWaitMs = DEFAULT_RUNTIME_READY_TIMEOUT_MS,
): Promise<void> {
  const readinessUrl = getRuntimeReadinessUrl(baseUrl, model, token);
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const response = await fetch(readinessUrl, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Runtime is still starting.
    }

    await sleep(500);
  }

  throw new Error(
    `Runtime readiness check failed (url=${readinessUrl}, waitedMs=${maxWaitMs})`,
  );
}

function summarizeErrorMessages(messages: string[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([message, count]) => `${count}x ${message}`)
    .join(" | ");
}

function getDaytonaConfig(): {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl: string;
  target: string;
} {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      `Missing Daytona auth in ${ENV_PATH}. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.`,
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    apiUrl: process.env.DAYTONA_API_URL ?? DEFAULT_API_URL,
    target: process.env.DAYTONA_TARGET ?? DEFAULT_TARGET,
  };
}

async function executeChecked(
  sandbox: DaytonaSandboxHandle,
  command: string,
): Promise<{ stdout: string; stderr: string }> {
  const result = await sandbox.process.executeCommand(command, WORKDIR, undefined, EXEC_TIMEOUT_SECONDS);
  const stdout = result.stdout ?? result.result ?? result.artifacts?.stdout ?? "";
  const stderr = result.stderr ?? "";

  if ((result.exitCode ?? 0) !== 0) {
    throw new Error(
      `Sandbox ${sandbox.name} command failed with exit code ${result.exitCode ?? 0}: ${stderr || stdout || command}`,
    );
  }

  return { stdout, stderr };
}

async function deleteSandbox(sandbox: DaytonaSandboxHandle): Promise<void> {
  await sandbox.delete();
}

async function listByRunLabel(
  daytona: Daytona,
  runId: string,
): Promise<DaytonaSandboxStateSnapshot[]> {
  const sandboxes: DaytonaSandboxStateSnapshot[] = [];
  for await (const sandbox of daytona.list({
    labels: { "cmdclaw-run-id": runId },
    limit: LIST_PAGE_SIZE,
  })) {
    sandboxes.push(sandbox);
  }
  return sandboxes;
}

function formatSandboxStates(sandboxes: DaytonaSandboxStateSnapshot[]): string {
  return sandboxes.map((sandbox) => `${sandbox.name}:${sandbox.state ?? "unknown"}`).join(", ");
}

async function logAndAssertSandboxStates(
  daytona: Daytona,
  runId: string,
  stage: string,
  sandboxIds?: string[],
) {
  const sandboxes = await listByRunLabel(daytona, runId);
  const scopedSandboxes =
    sandboxIds && sandboxIds.length > 0
      ? sandboxes.filter((sandbox) => sandboxIds.includes(sandbox.id))
      : sandboxes;

  if (scopedSandboxes.length === 0) {
    console.log(`[daytona-selfhost] No sandboxes found while checking states after ${stage}.`);
    return;
  }

  console.log(
    `[daytona-selfhost] Sandbox states after ${stage}: ${formatSandboxStates(scopedSandboxes)}`,
  );

  const failedSandboxes = scopedSandboxes.filter(
    (sandbox) => (sandbox.state ?? "").toLowerCase() === "error",
  );
  assert(
    failedSandboxes.length === 0,
    `Sandbox entered error state after ${stage}: ${formatSandboxStates(failedSandboxes)}`,
  );
}

async function waitForUserCleanupConfirmation(
  runId: string,
  sandboxes: DaytonaSandboxStateSnapshot[],
) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[daytona-selfhost] No TTY detected; cleaning up sandboxes automatically.");
    return;
  }

  console.log("[daytona-selfhost] Sandboxes are paused for inspection.");
  console.log(`[daytona-selfhost] Run id: ${runId}`);
  for (const sandbox of sandboxes) {
    console.log(`- ${sandbox.name}: ${sandbox.id} (${sandbox.state ?? "unknown"})`);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const answer = await new Promise<string>((resolve) => {
        rl.question('[daytona-selfhost] Type "y" to delete the sandboxes and exit: ', resolve);
      });
      const normalized = answer.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") {
        return;
      }
    }
  } finally {
    rl.close();
  }
}

async function cleanupRunSandboxes(
  daytona: Daytona,
  sandboxes: DaytonaSandboxHandle[],
  runId: string,
): Promise<void> {
  if (sandboxes.length > 0) {
    console.log("[daytona-selfhost] Cleaning up created sandboxes...");
    const cleanupResults = await Promise.allSettled(sandboxes.map(deleteSandbox));
    const failed = cleanupResults.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      console.warn(`[daytona-selfhost] Cleanup failed for ${failed.length} created sandbox(es).`);
    }
  }

  const leftovers = await listByRunLabel(daytona, runId);
  if (leftovers.length === 0) {
    return;
  }

  console.log(
    `[daytona-selfhost] Retrying cleanup for ${leftovers.length} sandbox(es) discovered by run label...`,
  );
  const retryResults = await Promise.allSettled(
    leftovers.map(async (sandbox) => {
      const full = (await daytona.get(sandbox.id)) as DaytonaSandboxHandle;
      await full.delete();
    }),
  );
  const failed = retryResults.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[daytona-selfhost] Retry cleanup failed for ${failed.length} sandbox(es).`);
  }
}

async function waitForCleanup(daytona: Daytona, runId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CLEANUP_WAIT_TIMEOUT_MS) {
    const leftovers = await listByRunLabel(daytona, runId);
    if (leftovers.length === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, CLEANUP_POLL_INTERVAL_MS));
  }

  const leftovers = await listByRunLabel(daytona, runId);
  assert(
    leftovers.length === 0,
    `Found ${leftovers.length} sandbox(es) still present after cleanup for run ${runId}: ${leftovers
      .map((sandbox) => `${sandbox.name}:${sandbox.state ?? "unknown"}`)
      .join(", ")}`,
  );
}

async function runBasicSmoke(args: {
  daytona: Daytona;
  runId: string;
  labels: Record<string, string>;
  sandboxes: DaytonaSandboxHandle[];
  summary: string[];
}) {
  const { daytona, runId, labels, sandboxes, summary } = args;
  const sandboxCount = getRequestedSandboxCount();

  console.log(
    `[daytona-selfhost] Creating ${sandboxCount} sandboxes using the deployment default snapshot...`,
  );
  const creationResults = await Promise.allSettled(
    Array.from({ length: sandboxCount }, (_, index) =>
      daytona.create({
        name: `cmdclaw-daytona-smoke-${String(index + 1).padStart(3, "0")}-${runId}`,
        labels,
      }),
    ),
  );

  const creationFailures: string[] = [];
  for (const result of creationResults) {
    if (result.status === "fulfilled") {
      sandboxes.push(result.value as DaytonaSandboxHandle);
      continue;
    }
    creationFailures.push(
      result.reason instanceof Error ? result.reason.message : String(result.reason),
    );
  }

  console.log(
    `[daytona-selfhost] Creation summary: ${sandboxes.length}/${sandboxCount} sandboxes created successfully.`,
  );
  if (creationFailures.length > 0) {
    console.warn(
      `[daytona-selfhost] Creation failures (${creationFailures.length}): ${summarizeErrorMessages(creationFailures)}`,
    );
  }

  await logAndAssertSandboxStates(
    daytona,
    runId,
    "creation attempt",
    sandboxes.map((sandbox) => sandbox.id),
  );

  if (creationFailures.length > 0) {
    throw new Error(
      `Failed to create ${creationFailures.length}/${sandboxCount} sandboxes: ${summarizeErrorMessages(creationFailures)}`,
    );
  }

  console.log("[daytona-selfhost] Created sandboxes:");
  for (const sandbox of sandboxes) {
    console.log(`- ${sandbox.name}: ${sandbox.id}`);
  }
  await logAndAssertSandboxStates(
    daytona,
    runId,
    "creation",
    sandboxes.map((sandbox) => sandbox.id),
  );

  const scriptCommand =
    "sh -lc 'echo \"#!/bin/sh\" > /tmp/daytona-selfhost-smoke.sh && " +
    "echo \"echo sandbox-script:\\$HOSTNAME\" >> /tmp/daytona-selfhost-smoke.sh && " +
    "chmod +x /tmp/daytona-selfhost-smoke.sh && " +
    "/tmp/daytona-selfhost-smoke.sh'";
  const networkCommand = "sh -lc 'curl -fsSI https://example.com | head -n 1'";

  const fileContent = `daytona-selfhost-smoke:${runId}`;
  const fileCommand = `sh -lc 'printf "%s" "${fileContent}" > /tmp/daytona-selfhost-smoke.txt && cat /tmp/daytona-selfhost-smoke.txt'`;

  const primarySandbox = sandboxes[0];
  const secondarySandbox = sandboxes[1];
  assert(
    primarySandbox && secondarySandbox,
    `Expected at least ${MIN_RUNTIME_SANDBOX_COUNT} sandboxes for runtime checks, created ${sandboxes.length}.`,
  );

  const [scriptResult, networkResult, fileResult] = await Promise.all([
    executeChecked(primarySandbox, scriptCommand),
    executeChecked(primarySandbox, networkCommand),
    executeChecked(secondarySandbox, fileCommand),
  ]);

  const normalizedScriptOutput = normalizeOutput(scriptResult.stdout);
  assert(
    normalizedScriptOutput.includes("sandbox-script:"),
    `Unexpected script output from ${primarySandbox.name}: ${normalizedScriptOutput || "<empty>"}`,
  );
  summary.push(`${primarySandbox.name}: script execution OK`);

  const normalizedNetworkOutput = normalizeOutput(networkResult.stdout);
  assert(
    normalizedNetworkOutput.includes("HTTP/"),
    `Unexpected network output from ${primarySandbox.name}: ${normalizedNetworkOutput || "<empty>"}`,
  );
  summary.push(`${primarySandbox.name}: outbound internet access OK`);

  const normalizedFileOutput = normalizeOutput(fileResult.stdout);
  assert(
    normalizedFileOutput.includes(fileContent),
    `Unexpected file command output from ${secondarySandbox.name}: ${normalizedFileOutput || "<empty>"}`,
  );

  const downloaded = await secondarySandbox.fs.downloadFile("/tmp/daytona-selfhost-smoke.txt");
  const downloadedContent =
    typeof downloaded === "string" ? downloaded : Buffer.from(downloaded).toString("utf8");

  assert(
    downloadedContent === fileContent,
    `Unexpected downloaded file content from ${secondarySandbox.name}: ${downloadedContent || "<empty>"}`,
  );
  summary.push(`${secondarySandbox.name}: file write/read OK`);
  await logAndAssertSandboxStates(
    daytona,
    runId,
    "runtime checks",
    sandboxes.map((sandbox) => sandbox.id),
  );
}

async function runRuntimeSmoke(args: {
  daytona: Daytona;
  runId: string;
  labels: Record<string, string>;
  sandboxes: DaytonaSandboxHandle[];
  summary: string[];
}) {
  const { daytona, runId, labels, sandboxes, summary } = args;
  const model = getRuntimeModel();
  const batches = getRuntimeBatches();
  const concurrency = getRuntimeConcurrency();
  const holdMs = getRuntimeHoldMs();
  const readyTimeoutMs = getRuntimeReadyTimeoutMs();
  const serverPort = getRuntimeServerPort(model);
  const snapshot = getRuntimeSnapshot();

  console.log(
    `[daytona-selfhost] Runtime mode: model=${model} snapshot=${snapshot} batches=${batches} concurrency=${concurrency} holdMs=${holdMs} readyTimeoutMs=${readyTimeoutMs}`,
  );

  for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
    const batchNumber = batchIndex + 1;
    console.log(
      `[daytona-selfhost] Starting runtime batch ${batchNumber}/${batches} with ${concurrency} sandbox(es)...`,
    );

    const batchResults = await Promise.allSettled(
      Array.from({ length: concurrency }, async (_, slotIndex) => {
        const sandboxName = `cmdclaw-daytona-runtime-${String(batchNumber).padStart(2, "0")}-${String(slotIndex + 1).padStart(2, "0")}-${runId}`;
        let sandbox: DaytonaSandboxHandle;
        try {
          sandbox = (await daytona.create({
            name: sandboxName,
            snapshot,
            labels,
          })) as DaytonaSandboxHandle;
        } catch (error) {
          throw new Error(
            `create failed for ${sandboxName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        sandboxes.push(sandbox);

        if (!sandbox.getPreviewLink) {
          throw new Error(`Sandbox ${sandbox.name} does not expose getPreviewLink().`);
        }

        let preview: { url: string; token?: string };
        try {
          preview = await sandbox.getPreviewLink(serverPort);
        } catch (error) {
          throw new Error(
            `preview failed for ${sandbox.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        try {
          await waitForRuntimeServer(preview.url, model, preview.token, readyTimeoutMs);
        } catch (error) {
          throw new Error(
            `readiness failed for ${sandbox.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        if (holdMs > 0) {
          await sleep(holdMs);
        }

        return {
          id: sandbox.id,
          name: sandbox.name,
          url: preview.url,
        };
      }),
    );

    const succeeded = batchResults
      .filter(
        (result): result is PromiseFulfilledResult<{ id: string; name: string; url: string }> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    const failures = batchResults
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

    console.log(
      `[daytona-selfhost] Runtime batch ${batchNumber} summary: ${succeeded.length}/${concurrency} ready.`,
    );
    if (succeeded.length > 0) {
      for (const sandbox of succeeded) {
        console.log(`- ready ${sandbox.name}: ${sandbox.id}`);
      }
    }
    if (failures.length > 0) {
      console.warn(
        `[daytona-selfhost] Runtime batch ${batchNumber} failures (${failures.length}): ${summarizeErrorMessages(failures)}`,
      );
      throw new Error(
        `Runtime batch ${batchNumber}/${batches} failed: ${summarizeErrorMessages(failures)}`,
      );
    }

    summary.push(`runtime batch ${batchNumber}/${batches}: ${succeeded.length} sandbox(es) reached health`);
    await logAndAssertSandboxStates(
      daytona,
      runId,
      `runtime batch ${batchNumber}`,
      succeeded.map((sandbox) => sandbox.id),
    );
  }
}

async function main() {
  console.log(`[daytona-selfhost] Loading env from ${ENV_PATH}`);
  const mode = getSmokeMode();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const labels = {
    "cmdclaw-experiment": "daytona-selfhost-smoke",
    "cmdclaw-smoke-mode": mode,
    "cmdclaw-run-id": runId,
  };

  const daytona = new Daytona(getDaytonaConfig());
  const sandboxes: DaytonaSandboxHandle[] = [];
  const summary: string[] = [];

  try {
    if (mode === "runtime") {
      await runRuntimeSmoke({ daytona, runId, labels, sandboxes, summary });
    } else {
      await runBasicSmoke({ daytona, runId, labels, sandboxes, summary });
    }

    console.log("[daytona-selfhost] PASS");
    for (const line of summary) {
      console.log(`- ${line}`);
    }
  } finally {
    const sandboxesForCleanup = await listByRunLabel(daytona, runId);
    if (sandboxesForCleanup.length > 0) {
      await waitForUserCleanupConfirmation(runId, sandboxesForCleanup);
    }

    await cleanupRunSandboxes(daytona, sandboxes, runId);
    await waitForCleanup(daytona, runId);
  }
}

main().catch((error) => {
  console.error("[daytona-selfhost] FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
