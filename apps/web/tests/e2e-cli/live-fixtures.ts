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

let activeCliLiveCleanupState: CliLiveCleanupState | null = null;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveDone({ code: -1, stdout, stderr, timedOut });
    });
  });
}

export function assertExitOk(result: CommandResult, label: string): void {
  if (result.code === 0) {
    return;
  }
  const timeoutHint = result.timedOut ? " (timed out)" : "";
  throw new Error(
    `${label} exited with code ${String(result.code)}${timeoutHint}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
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
