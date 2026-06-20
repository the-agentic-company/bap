import { createRpcClient, defaultProfileStore } from "@bap/client";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import { resolveLiveE2EModel } from "../e2e/live-chat-model";
import {
  assertSandboxRowsUseProvider,
  liveSandboxProvider,
  type SandboxProvider,
} from "../e2e/live-sandbox";
import {
  cliFailureDiagnosticTimeoutMs,
  commandTimeoutMs,
  defaultServerUrl,
  expectedUserEmail,
  sleep,
  transientRetryCount,
  transientRetryDelayMs,
  type CommandResult,
} from "./live-config";
import {
  assertNoStartedDaytonaSandboxesRemain,
  cleanupCliLiveSandboxes,
  createCliLiveCleanupState,
  extractCliIdentifiersFromText,
  trackCliIdentifiersFromText,
  type CliLiveCleanupState,
} from "./live-sandbox-cleanup";
import { callCliLiveTestingApi } from "./testing-api";

export { callCliLiveTestingApi };

export {
  artifactTimeoutMs,
  commandTimeoutMs,
  defaultServerUrl,
  echoPrefix,
  expectedGmailAccountLabel,
  expectedUserEmail,
  fillPdfPrompt,
  gmailPollIntervalMs,
  liveEnabled,
  optionalProdFixtureTestsEnabled,
  productionLiveTarget,
  questionPrompt,
  responseTimeoutMs,
  slackPollIntervalMs,
  slackPostVerifyTimeoutMs,
  sourceChannelName,
  targetChannelName,
  transientRetryCount,
  transientRetryDelayMs,
  type CommandResult,
} from "./live-config";

export { containsPdfText, encodeUtf16Be } from "./live-pdf";

export {
  buildSlackPrompt,
  findEchoMessageAfterTs,
  getSlackAccessTokenForExpectedUser,
  parseSlackTimestamp,
  pollSlackEchoMessage,
  postSlackMessage,
  readLatestMessage,
  readLatestMessageOrNull,
  resolveChannelId,
} from "./live-slack";

export {
  getGmailAccessTokenForExpectedUser,
  getGoogleCalendarAccessTokenForExpectedUser,
  getGoogleDriveAccessTokenForExpectedUser,
  readLatestGoogleDriveFile,
  readLatestInboxMessage,
  readUpcomingGoogleCalendarEvent,
} from "./live-google";

export { getLinkedInAccountIdForExpectedUser, readLinkedInOwnProfile } from "./live-linkedin";

type TestingTokenBackup = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresAt: string | null;
  idToken: string | null;
};

type GenerationStateRecord = {
  id: string;
  status: string;
  completionReason: string | null;
  sandboxId: string | null;
  suspendedAt: string | null;
  remainingRunMs: number;
  executionPolicy: Record<string, unknown> | null;
  errorMessage: string | null;
  debugInfo: Record<string, unknown> | null;
  lastRuntimeProgressAt: string;
  startedAt: string;
  deadlineAt: string;
  completedAt: string | null;
};

type CliLiveFailureDiagnostics = {
  input: {
    conversationIds: string[];
    generationIds: string[];
  };
  conversations: Array<{
    id: string;
    type: string;
    title: string | null;
    generationStatus: string;
    currentGenerationId: string | null;
    lastSandboxProvider: string | null;
    lastRuntimeHarness: string | null;
    model: string | null;
    autoApprove: boolean;
    spawnDepth: number;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
  }>;
  generations: Array<{
    id: string;
    conversationId: string;
    runtimeId: string | null;
    messageId: string | null;
    status: string;
    pendingApproval: boolean;
    pendingAuth: boolean;
    executionPolicy: Record<string, unknown> | null;
    sandboxId: string | null;
    sandboxProvider: string | null;
    runtimeHarness: string | null;
    runtimeProtocolVersion: string | null;
    isPaused: boolean;
    deadlineAt: string;
    remainingRunMs: number;
    suspendedAt: string | null;
    resumeInterruptId: string | null;
    lastRuntimeProgressAt: string;
    recoveryAttempts: number;
    completionReason: string | null;
    errorMessage: string | null;
    debugInfoPreview: string | null;
    inputTokens: number;
    outputTokens: number;
    traceId: string | null;
    terminalCanonicalEventEmittedAt: string | null;
    startedAt: string;
    cancelRequestedAt: string | null;
    completedAt: string | null;
  }>;
  runtimes: Array<{
    id: string;
    conversationId: string;
    sandboxProvider: string | null;
    runtimeHarness: string | null;
    runtimeProtocolVersion: string | null;
    sandboxId: string | null;
    sessionId: string | null;
    status: string;
    activeGenerationId: string | null;
    activeTurnSeq: number;
    lastBoundAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  interrupts: Array<{
    id: string;
    generationId: string;
    runtimeId: string | null;
    conversationId: string;
    kind: string;
    status: string;
    provider: string;
    providerRequestId: string | null;
    providerToolUseId: string;
    turnSeq: number | null;
    requestedAt: string;
    expiresAt: string | null;
    resolvedAt: string | null;
    appliedAt: string | null;
  }>;
  workerQueue: {
    ready: boolean;
    queueName: string;
    workerCount: number;
    counts: Record<string, number>;
  };
};

let activeCliLiveCleanupState: CliLiveCleanupState | null = null;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const commandOutputTailLength = 12_000;
const diagnosticFieldTailLength = 1_200;

beforeEach(() => {
  activeCliLiveCleanupState = createCliLiveCleanupState();
});

afterEach(async () => {
  const state = activeCliLiveCleanupState;
  activeCliLiveCleanupState = null;

  if (!state) {
    return;
  }

  await cleanupCliLiveSandboxes({
    state,
    expectedProvider: liveSandboxProvider,
  });
  await assertNoStartedDaytonaSandboxesRemain({
    state,
    expectedProvider: liveSandboxProvider,
  });
});

export function buildCliCommandArgs(...args: string[]): string[] {
  return ["run", "--cwd", repoRoot, "bap", "--", ...args];
}

export function trackCliOutput(text: string): void {
  trackCliIdentifiersFromText(activeCliLiveCleanupState, text);
}

function tailText(value: string, maxLength: number): string {
  if (value.length === 0) {
    return "(empty)";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `[truncated ${value.length - maxLength} chars]\n${value.slice(-maxLength)}`;
}

function formatCommandForDisplay(command: string[] | undefined): string {
  if (!command || command.length === 0) {
    return "(unknown)";
  }
  return command
    .map((arg) => (/^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}

function compactJson(value: unknown, maxLength = diagnosticFieldTailLength): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return tailText(
    typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)),
    maxLength,
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function displayList(values: string[]): string {
  return values.length > 0 ? values.join(",") : "-";
}

function formatSection<T>(title: string, rows: T[], formatRow: (row: T) => string[]): string[] {
  const lines = [`  ${title}:`];
  if (rows.length === 0) {
    lines.push("    - none");
    return lines;
  }
  for (const row of rows) {
    lines.push(...formatRow(row));
  }
  return lines;
}

function formatConversationDiagnostic(row: CliLiveFailureDiagnostics["conversations"][number]) {
  return [
    `    - id=${row.id} status=${row.generationStatus} currentGeneration=${displayValue(row.currentGenerationId)} type=${row.type} model=${displayValue(row.model)} autoApprove=${row.autoApprove} spawnDepth=${row.spawnDepth} updatedAt=${row.updatedAt}`,
  ];
}

function formatGenerationDiagnostic(row: CliLiveFailureDiagnostics["generations"][number]) {
  const lines = [
    `    - id=${row.id} conversation=${row.conversationId} status=${row.status} completionReason=${displayValue(row.completionReason)} error=${displayValue(row.errorMessage)} runtime=${displayValue(row.runtimeId)} sandbox=${displayValue(row.sandboxProvider)}/${displayValue(row.sandboxId)} paused=${row.isPaused} pendingApproval=${row.pendingApproval} pendingAuth=${row.pendingAuth} remainingRunMs=${row.remainingRunMs} recoveryAttempts=${row.recoveryAttempts} deadlineAt=${row.deadlineAt} lastProgress=${row.lastRuntimeProgressAt} startedAt=${row.startedAt} completedAt=${displayValue(row.completedAt)} trace=${displayValue(row.traceId)}`,
  ];
  if (row.executionPolicy) {
    lines.push(`      executionPolicy=${compactJson(row.executionPolicy, 600)}`);
  }
  if (row.debugInfoPreview) {
    lines.push(`      debugInfo=${compactJson(row.debugInfoPreview)}`);
  }
  return lines;
}

function formatRuntimeDiagnostic(row: CliLiveFailureDiagnostics["runtimes"][number]) {
  return [
    `    - id=${row.id} conversation=${row.conversationId} status=${row.status} activeGeneration=${displayValue(row.activeGenerationId)} sandbox=${displayValue(row.sandboxProvider)}/${displayValue(row.sandboxId)} session=${displayValue(row.sessionId)} harness=${displayValue(row.runtimeHarness)} protocol=${displayValue(row.runtimeProtocolVersion)} activeTurnSeq=${row.activeTurnSeq} lastBoundAt=${displayValue(row.lastBoundAt)} updatedAt=${row.updatedAt}`,
  ];
}

function formatInterruptDiagnostic(row: CliLiveFailureDiagnostics["interrupts"][number]) {
  return [
    `    - id=${row.id} generation=${row.generationId} conversation=${row.conversationId} runtime=${displayValue(row.runtimeId)} kind=${row.kind} status=${row.status} provider=${row.provider} toolUse=${row.providerToolUseId} providerRequest=${displayValue(row.providerRequestId)} turnSeq=${displayValue(row.turnSeq)} requestedAt=${row.requestedAt} expiresAt=${displayValue(row.expiresAt)} resolvedAt=${displayValue(row.resolvedAt)} appliedAt=${displayValue(row.appliedAt)}`,
  ];
}

function formatCliLiveFailureDiagnostics(diagnostics: CliLiveFailureDiagnostics): string {
  return [
    "cli-live diagnostics:",
    `  input generationIds=${displayList(diagnostics.input.generationIds)} conversationIds=${displayList(diagnostics.input.conversationIds)}`,
    `  workerQueue ready=${diagnostics.workerQueue.ready} workers=${diagnostics.workerQueue.workerCount} queue=${diagnostics.workerQueue.queueName} counts=${JSON.stringify(diagnostics.workerQueue.counts)}`,
    ...formatSection("conversations", diagnostics.conversations, formatConversationDiagnostic),
    ...formatSection("generations", diagnostics.generations, formatGenerationDiagnostic),
    ...formatSection("runtimes", diagnostics.runtimes, formatRuntimeDiagnostic),
    ...formatSection("interrupts", diagnostics.interrupts, formatInterruptDiagnostic),
  ].join("\n");
}

function formatCliIdentifierSummary(ids: { generationIds: string[]; conversationIds: string[] }) {
  return `generationIds=${displayList(ids.generationIds)} conversationIds=${displayList(ids.conversationIds)}`;
}

function hasCliIdentifiers(ids: { generationIds: string[]; conversationIds: string[] }): boolean {
  return ids.generationIds.length > 0 || ids.conversationIds.length > 0;
}

async function collectCliLiveFailureDiagnostics(args: {
  stdout: string;
  stderr: string;
}): Promise<string | undefined> {
  const ids = extractCliIdentifiersFromText(`${args.stdout}\n${args.stderr}`);
  if (!hasCliIdentifiers(ids)) {
    return undefined;
  }
  const idSummary = formatCliIdentifierSummary(ids);
  if (!process.env.APP_SERVER_SECRET) {
    return `cli-live diagnostics unavailable: APP_SERVER_SECRET is not set for ${idSummary}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cliFailureDiagnosticTimeoutMs);
  try {
    const diagnostics = await callCliLiveTestingApi<CliLiveFailureDiagnostics>(
      {
        action: "diagnostics:cli-live-failure",
        generationIds: ids.generationIds,
        conversationIds: ids.conversationIds,
      },
      { signal: controller.signal },
    );
    return formatCliLiveFailureDiagnostics(diagnostics);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `cli-live diagnostics unavailable after ${cliFailureDiagnosticTimeoutMs}ms: ${message}; ${idSummary}`;
  } finally {
    clearTimeout(timer);
  }
}

async function buildCommandResult(args: {
  commandArgs: string[];
  result: Omit<CommandResult, "command" | "diagnostics">;
}): Promise<CommandResult> {
  const command = ["bun", ...args.commandArgs];
  if (args.result.code === 0 && !args.result.timedOut) {
    return {
      ...args.result,
      command,
    };
  }

  const diagnostics = await collectCliLiveFailureDiagnostics({
    stdout: args.result.stdout,
    stderr: args.result.stderr,
  });
  return {
    ...args.result,
    command,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function runBunCommand(
  args: string[],
  timeoutMs = commandTimeoutMs,
): Promise<CommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("bun", args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_SERVER_URL: defaultServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      trackCliOutput(stdout);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      trackCliOutput(stderr);
    });

    const resolveResult = (result: Omit<CommandResult, "command" | "diagnostics">) => {
      void buildCommandResult({ commandArgs: args, result }).then(resolveDone, (error) => {
        const message = error instanceof Error ? error.message : String(error);
        resolveDone({
          ...result,
          command: ["bun", ...args],
          diagnostics: `cli-live diagnostics unavailable: ${message}`,
        });
      });
    };

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveResult({ code: -1, stdout, stderr, timedOut });
    });
  });
}

export function assertExitOk(result: CommandResult, label: string): void {
  if (result.code === 0) {
    return;
  }
  const timeoutHint = result.timedOut ? " (timed out)" : "";
  throw new Error(
    [
      `${label} exited with code ${String(result.code)}${timeoutHint}`,
      `command: ${formatCommandForDisplay(result.command)}`,
      `stdout tail:\n${tailText(result.stdout, commandOutputTailLength)}`,
      `stderr tail:\n${tailText(result.stderr, commandOutputTailLength)}`,
      result.diagnostics,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );
}

export async function ensureCliAuth(): Promise<void> {
  const authResult = await runBunCommand(buildCliCommandArgs("auth", "login"), 120_000);
  assertExitOk(authResult, "bun run --cwd ../.. bap -- auth login");
}

export async function withIntegrationTokensTemporarilyRemoved<T>(args: {
  email: string;
  integrationType: string;
  run: () => Promise<T>;
}): Promise<T> {
  const { tokens: previousTokens } = await callCliLiveTestingApi<{
    tokens: TestingTokenBackup[];
  }>({
    action: "integration-tokens:remove",
    email: args.email,
    integrationType: args.integrationType,
  });

  try {
    return await args.run();
  } finally {
    await callCliLiveTestingApi({
      action: "integration-tokens:restore-if-empty",
      email: args.email,
      integrationType: args.integrationType,
      tokens: previousTokens,
    });
  }
}

export async function resolveLiveModel(): Promise<string> {
  return resolveLiveE2EModel();
}

export function getCliClient() {
  const serverUrl = process.env.APP_SERVER_URL || defaultServerUrl;
  const config = defaultProfileStore.load(serverUrl);
  if (!config?.token) {
    throw new Error(
      `Missing CLI auth token for ${serverUrl}. Run: bun run --cwd ../.. bap -- auth login --server ${serverUrl}`,
    );
  }
  return createRpcClient(serverUrl, config.token);
}

export function requireMatch(output: string, pattern: RegExp, context: string): string {
  const matched = output.match(pattern);
  if (!matched) {
    throw new Error(`Expected output to match ${pattern}: ${context}`);
  }
  return matched[1] ?? "";
}

export function extractConversationId(output: string): string {
  return requireMatch(output, /\[conversation\]\s+([^\s]+)/, output);
}

export async function assertExpectedUserExists(email = expectedUserEmail): Promise<void> {
  const { exists } = await callCliLiveTestingApi<{ exists: boolean }>({
    action: "user:exists",
    email,
  });
  if (!exists) {
    throw new Error(`Live e2e user not found: ${email}`);
  }
}

export async function waitForGenerationState(args: {
  generationId: string;
  expectedStatus: "awaiting_approval" | "awaiting_auth" | "paused";
  completionReason?: string | null;
  timeoutMs: number;
}): Promise<GenerationStateRecord> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<GenerationStateRecord> => {
    const { record } = await callCliLiveTestingApi<{ record: GenerationStateRecord | null }>({
      action: "generation:get-state",
      generationId: args.generationId,
    });
    if (
      record &&
      record.status === args.expectedStatus &&
      record.suspendedAt &&
      record.sandboxId === null &&
      (args.completionReason === undefined || record.completionReason === args.completionReason)
    ) {
      return record;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for generation ${args.generationId} to reach ${args.expectedStatus}`,
      );
    }
    await sleep(250);
    return poll();
  };

  return poll();
}

export async function waitForGenerationTerminalState(args: {
  generationId: string;
  expectedStatus: "completed" | "cancelled" | "error";
  completionReason?: string | null;
  timeoutMs: number;
}): Promise<GenerationStateRecord> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<GenerationStateRecord> => {
    const { record } = await callCliLiveTestingApi<{ record: GenerationStateRecord | null }>({
      action: "generation:get-state",
      generationId: args.generationId,
    });
    if (
      record &&
      record.status === args.expectedStatus &&
      record.completedAt &&
      (args.completionReason === undefined || record.completionReason === args.completionReason)
    ) {
      return record;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for generation ${args.generationId} to reach ${args.expectedStatus}`,
      );
    }
    await sleep(250);
    return poll();
  };

  return poll();
}

export async function waitForPendingInterrupt(args: {
  generationId: string;
  expectedKind: "plugin_write" | "auth";
  timeoutMs: number;
}): Promise<{ id: string; status: string; kind: string }> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<{ id: string; status: string; kind: string }> => {
    const { interrupt } = await callCliLiveTestingApi<{
      interrupt: { id: string; status: string; kind: string } | null;
    }>({
      action: "interrupt:latest-pending",
      generationId: args.generationId,
      expectedKind: args.expectedKind,
    });
    if (interrupt) {
      return interrupt;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for pending ${args.expectedKind} interrupt on generation ${args.generationId}`,
      );
    }
    await sleep(250);
    return poll();
  };

  return poll();
}

export async function waitForPromptGeneration(args: {
  promptToken: string;
  timeoutMs: number;
}): Promise<{ conversationId: string; generationId: string }> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<{ conversationId: string; generationId: string }> => {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the prompt-specific generation to become active.");
    }

    const { target } = await callCliLiveTestingApi<{
      target: { conversationId: string; generationId: string } | null;
    }>({
      action: "generation:find-by-prompt",
      promptToken: args.promptToken,
    });
    if (target) {
      return target;
    }

    await sleep(250);
    return poll();
  };

  return poll();
}

export async function readLatestAssistantMessage(conversationId: string): Promise<{
  content: string;
  contentParts: unknown[] | null;
} | null> {
  const { message } = await callCliLiveTestingApi<{
    message: { content: string; contentParts: unknown[] | null } | null;
  }>({
    action: "conversation:latest-assistant-message",
    conversationId,
  });
  return message;
}

export async function getGenerationRuntimeFields(generationId: string): Promise<{
  remainingRunMs: number;
  executionPolicy: Record<string, unknown> | null;
} | null> {
  const { record } = await callCliLiveTestingApi<{
    record: { remainingRunMs: number; executionPolicy: Record<string, unknown> | null } | null;
  }>({
    action: "generation:get-runtime-fields",
    generationId,
  });
  return record;
}

function hasTransientOpencodeReadinessFailure(result: CommandResult): boolean {
  return (
    result.stdout.includes("[error] OpenCode server failed readiness check") ||
    result.stdout.includes("[error] Agent preparation timed out after ")
  );
}

export async function runChatMessage(args: {
  message: string;
  model?: string;
  conversation?: string;
  autoApprove?: boolean;
  questionAnswers?: string[];
  files?: string[];
  sandboxProvider?: SandboxProvider;
  timing?: boolean;
  timeoutMs?: number;
  chaosRuntimeNoProgress?: string;
}): Promise<CommandResult> {
  const commandArgs = buildCliCommandArgs("chat", "--message", args.message, "--no-validate");

  if (args.model) {
    commandArgs.push("--model", args.model);
  }

  if (args.conversation) {
    commandArgs.push("--conversation", args.conversation);
  }

  if (args.autoApprove) {
    commandArgs.push("--auto-approve");
  }

  if (args.timing) {
    commandArgs.push("--timing");
  }

  if (args.chaosRuntimeNoProgress) {
    commandArgs.push("--chaos-runtime-no-progress", args.chaosRuntimeNoProgress);
  }

  commandArgs.push("--sandbox", args.sandboxProvider ?? liveSandboxProvider);

  for (const answer of args.questionAnswers ?? []) {
    commandArgs.push("--question-answer", answer);
  }

  for (const file of args.files ?? []) {
    commandArgs.push("--file", file);
  }

  const timeoutMs = args.timeoutMs ?? commandTimeoutMs;
  const runAttempt = async (attempt: number): Promise<CommandResult> => {
    const result = await runBunCommand(commandArgs, timeoutMs);
    if (!hasTransientOpencodeReadinessFailure(result) || attempt >= transientRetryCount) {
      return result;
    }

    await sleep(transientRetryDelayMs);
    return runAttempt(attempt + 1);
  };

  return runAttempt(0);
}

export async function closeDbPool(): Promise<void> {
  // Database access for CLI live tests is proxied through the staging testing API.
}

export { assertSandboxRowsUseProvider, liveSandboxProvider };
