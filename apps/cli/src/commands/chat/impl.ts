import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import { resolveDefaultChatModel } from "@cmdclaw/core/lib/chat-model-defaults";
import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import { listOpencodeFreeModels } from "@cmdclaw/core/server/ai/opencode-models";
import {
  createRpcClient,
  defaultProfileStore,
  runChatSession,
  DEFAULT_SERVER_URL,
  type CmdclawApiClient,
  type DoneArtifactsData,
  type StatusChangeMetadata,
} from "@cmdclaw/client";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import readline from "node:readline";
import type { LocalContext } from "../../context";
import { ensureAuthenticatedClient } from "../../lib/auth";
import {
  collectScriptedQuestionAnswers,
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "../../lib/question-approval";
import {
  formatModelSelection,
  parseInteractiveModelCommand,
  resolveCliModelSelection,
} from "../../lib/chat-model-source";
import { resolveCliToolMetadata } from "../../lib/tool-metadata";
import { resolveServerUrl } from "../../lib/client";
import { parseChaosDurationMs } from "./chaos";
import { exportPerfettoTraceForCompletedRun } from "./perfetto-trace";
import { buildGenerationTimingLines, createGenerationTimingTracker } from "./stream-timing";

type ChatFlags = {
  server?: string;
  conversation?: string;
  message?: string;
  mesage?: string;
  model?: string;
  authSource?: ProviderAuthSource;
  sandbox?: "e2b" | "daytona" | "docker";
  listModels?: boolean;
  autoApprove?: boolean;
  open?: boolean;
  chaosRunDeadline?: string;
  chaosApproval: "ask" | "defer";
  chaosApprovalParkAfter?: string;
  chaosRuntimeNoProgress?: string;
  chaosForceRuntimeNoProgress?: boolean;
  attach?: string;
  attachGeneration?: string;
  validate: boolean;
  questionAnswer?: readonly string[];
  file?: readonly string[];
  perfettoTrace?: boolean;
  timing?: boolean;
  token?: string;
};

type ChatState = {
  authSource?: ProviderAuthSource | null;
  connectedProviderIds?: string[];
  conversationId?: string;
  perfettoTrace: boolean;
  sharedConnectedProviderIds?: string[];
  timing: boolean;
  file: readonly string[];
  message?: string;
  model?: string;
  questionAnswer: readonly string[];
  sandbox?: "e2b" | "daytona" | "docker";
  server?: string;
  autoApprove?: boolean;
  open: boolean;
  chaosApproval: "ask" | "defer";
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  validate: boolean;
  continueAfterMessage?: boolean;
};

type InternalChatFlags = ChatFlags & {
  continueAfterMessage?: boolean;
};

type ChatGenerationTarget =
  | {
      kind: "start";
      content: string;
      conversationId?: string;
      attachments?: { name: string; mimeType: string; dataUrl: string }[];
      debugRunDeadlineMsOverride?: number;
      resumePausedGenerationId?: string;
    }
  | {
      kind: "attach";
      generationId: string;
      suppressReplayRuntimeMetadataUntilDecision?: boolean;
    };

const AUTH_INTEGRATION_TYPES = [
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
] as const;

type AuthIntegrationType = (typeof AUTH_INTEGRATION_TYPES)[number];

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function writeTimingSummary(stdout: NodeJS.WriteStream, artifacts?: DoneArtifactsData): void {
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

type PrintedRuntimeMetadata = {
  runtime?: string;
  sandbox?: string;
};

type PrintedGenerationMarkers = {
  generationId?: string;
  conversationId?: string;
};

type ActiveConversationGeneration = {
  generationId: string | null;
  startedAt: string | null;
  errorMessage: string | null;
  status: string | null;
  pauseReason: string | null;
  debugRunDeadlineMs: number | null;
};

function isAuthIntegrationType(integration: string): integration is AuthIntegrationType {
  return (AUTH_INTEGRATION_TYPES as readonly string[]).includes(integration);
}

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => resolve(answer));
  });
}

function openUrlInBrowser(url: string): boolean {
  try {
    const commandByPlatform: Record<string, { cmd: string; args: string[] }> = {
      darwin: { cmd: "open", args: [url] },
      linux: { cmd: "xdg-open", args: [url] },
      win32: { cmd: "cmd", args: ["/c", "start", "", url] },
    };
    const command = commandByPlatform[process.platform];
    if (!command) {
      return false;
    }
    const child = Bun.spawn([command.cmd, ...command.args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function fileToAttachment(filePath: string): {
  name: string;
  mimeType: string;
  dataUrl: string;
} {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const data = readFileSync(resolved);
  const base64 = data.toString("base64");
  return {
    name: basename(resolved),
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
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

function printApprovalParked(
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

function printRunDeadlineParked(
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

function printApprovalDecisionMarker(
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

async function waitForApprovalParkedMarker(
  stdout: NodeJS.WriteStream,
  client: CmdclawApiClient,
  generationId: string,
  timeoutMs: number,
): Promise<void> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const stream = await client.generation.subscribeGeneration(
      { generationId },
      { signal: abortController.signal },
    );
    for await (const event of stream) {
      if (event.type !== "status_change" || event.status !== "approval_parked") {
        continue;
      }
      printApprovalParked(stdout, event.status, event.metadata);
      abortController.abort();
      break;
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function printGenerationMarkers(
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

function isAttachableGenerationStatus(status: string | null): boolean {
  return status === "generating" || status === "awaiting_approval" || status === "awaiting_auth";
}

export function shouldAutoResumePausedRunDeadline(
  active: Pick<ActiveConversationGeneration, "status" | "pauseReason">,
): boolean {
  return active.status === "paused" && active.pauseReason === "run_deadline";
}

function createApprovalPrompt(rl: readline.Interface | null): {
  rl: readline.Interface;
  close: () => void;
} | null {
  if (rl && process.stdin.isTTY && process.stdout.isTTY) {
    return {
      rl,
      close: () => {},
    };
  }

  if (!process.stdout.isTTY) {
    return null;
  }

  try {
    const input = createReadStream("/dev/tty");
    const output = process.stdout;
    const ttyRl = readline.createInterface({ input, output });
    return {
      rl: ttyRl,
      close: () => {
        ttyRl.close();
        input.close();
        input.destroy();
      },
    };
  } catch {
    return null;
  }
}

async function collectQuestionApprovalAnswers(
  rl: readline.Interface,
  questions: QuestionApprovalItem[],
): Promise<string[][]> {
  const collected: string[][] = [];
  for (const question of questions) {
    process.stdout.write(`\n[question] ${question.header}\n`);
    process.stdout.write(`${question.question}\n`);
    question.options.forEach((option, optionIndex) => {
      const suffix = option.description ? ` - ${option.description}` : "";
      process.stdout.write(`  ${optionIndex + 1}. ${option.label}${suffix}\n`);
    });
    if (question.custom) {
      process.stdout.write("  t. Type your own answer\n");
    }
    const rawSelection = await ask(
      rl,
      question.options.length > 0 ? "Select an option (default 1): " : "Answer: ",
    );
    if (question.custom && rawSelection.trim().toLowerCase() === "t") {
      const typedAnswer = await ask(rl, "Type your answer: ");
      collected.push(resolveQuestionSelection(question, typedAnswer));
    } else {
      collected.push(resolveQuestionSelection(question, rawSelection));
    }
  }
  return collected;
}

async function printAuthenticatedUserDeferred(client: CmdclawApiClient): Promise<string> {
  try {
    const me = await client.user.me();
    return `[auth] ${me.email} (${me.id})\n`;
  } catch (error) {
    return `[auth] failed to resolve current user: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}

async function hydrateProviderAvailability(client: CmdclawApiClient, state: ChatState) {
  const [authStatus, freeModels] = await Promise.all([
    client.providerAuth.status(),
    client.providerAuth.freeModels(),
  ]);

  state.connectedProviderIds = Object.keys(authStatus.connected ?? {});
  state.sharedConnectedProviderIds = Object.keys(authStatus.shared ?? {});

  if (state.model?.trim()) {
    const resolvedSelection = resolveCliModelSelection({
      model: state.model.trim(),
      authSource: state.authSource,
      connectedProviderIds: state.connectedProviderIds,
      sharedConnectedProviderIds: state.sharedConnectedProviderIds,
    });
    state.model = resolvedSelection.model;
    state.authSource = resolvedSelection.authSource;
  } else {
    const defaultModel = resolveDefaultChatModel({
      isOpenAIConnected:
        (state.connectedProviderIds ?? []).includes("openai") ||
        (state.sharedConnectedProviderIds ?? []).includes("openai"),
      availableOpencodeFreeModelIDs: (freeModels.models ?? []).map((model) => model.id),
    });
    const resolvedSelection = resolveCliModelSelection({
      model: defaultModel,
      connectedProviderIds: state.connectedProviderIds,
      sharedConnectedProviderIds: state.sharedConnectedProviderIds,
    });
    state.model = resolvedSelection.model;
    state.authSource = resolvedSelection.authSource;
  }

  return freeModels.models ?? [];
}

async function validatePersistedAssistantMessage(
  client: CmdclawApiClient,
  conversationId: string,
  messageId: string,
  expected: { content: string; parts: Array<{ type: string }> },
): Promise<void> {
  const conversation = await client.conversation.get({ id: conversationId });
  const savedMessage = conversation.messages.find((message) => message.id === messageId);

  if (!savedMessage) {
    throw new Error(
      `Validation failed: assistant message ${messageId} was not saved in conversation ${conversationId}`,
    );
  }

  const persistedParts = Array.isArray(savedMessage.contentParts) ? savedMessage.contentParts : [];
  if (expected.parts.length > 0 && persistedParts.length === 0) {
    throw new Error(
      "Validation failed: stream produced activity/text but saved message has no contentParts",
    );
  }

  const normalizedStream = normalizeText(expected.content);
  if (normalizedStream.length === 0) {
    return;
  }

  const normalizedPersisted = normalizeText(savedMessage.content ?? "");
  if (!normalizedPersisted.includes(normalizedStream)) {
    throw new Error(
      "Validation failed: streamed assistant text does not match saved message content",
    );
  }
}

async function runOneGeneration(
  stdout: NodeJS.WriteStream,
  client: CmdclawApiClient,
  rl: readline.Interface | null,
  state: ChatState,
  target: ChatGenerationTarget,
): Promise<string | null> {
  const resolvedServerUrl = resolveServerUrl(state.server);
  const normalizedServerUrl = resolvedServerUrl.replace(/\/$/, "");
  const generationTiming = createGenerationTimingTracker();
  const printedRuntimeMetadata: PrintedRuntimeMetadata = {};
  const printedGenerationMarkers: PrintedGenerationMarkers = {};
  let attachRuntimeMetadataUnlocked =
    target.kind !== "attach" || !target.suppressReplayRuntimeMetadataUntilDecision;

  const result = await runChatSession({
    client,
    ...(target.kind === "start"
      ? {
          input: {
            conversationId: target.conversationId,
            content: target.content,
            model: state.model,
            authSource: state.authSource,
            sandboxProvider: state.sandbox,
            autoApprove: state.autoApprove,
            resumePausedGenerationId: target.resumePausedGenerationId,
            debugRunDeadlineMs: target.debugRunDeadlineMsOverride ?? state.debugRunDeadlineMs,
            debugApprovalHotWaitMs: state.debugApprovalHotWaitMs,
            debugRuntimeNoProgressTimeoutMs:
              state.debugRuntimeNoProgressTimeoutMs,
            debugForceRuntimeNoProgressAfterPrompt:
              state.debugForceRuntimeNoProgressAfterPrompt,
            fileAttachments: target.attachments?.length ? target.attachments : undefined,
          },
        }
      : { generationId: target.generationId }),
    onStarted: (generationId, conversationId) => {
      printGenerationMarkers(stdout, printedGenerationMarkers, { generationId, conversationId });
    },
    ...(target.kind === "attach"
      ? {
          onStatusChange: (status: string, metadata?: StatusChangeMetadata) => {
            printGenerationMarkers(stdout, printedGenerationMarkers, {
              generationId: target.generationId,
            });
            if (attachRuntimeMetadataUnlocked) {
              printRuntimeMetadata(stdout, printedRuntimeMetadata, metadata);
            }
            printRunDeadlineParked(stdout, status, target.generationId, metadata);
          },
        }
      : {
          onStatusChange: (status: string, metadata?: StatusChangeMetadata) => {
            printRuntimeMetadata(stdout, printedRuntimeMetadata, metadata);
            printApprovalParked(stdout, status, metadata);
            printRunDeadlineParked(stdout, status, printedGenerationMarkers.generationId, metadata);
          },
        }),
    onText: (text) => {
      if (text.length > 0) {
        generationTiming.noteVisibleOutput();
      }
      stdout.write(text);
    },
    onThinking: (thinking) => {
      if (thinking.length > 0) {
        generationTiming.noteVisibleOutput();
      }
      stdout.write(`\n[thinking] ${thinking}\n`);
    },
    onToolUse: (toolUse) => {
      generationTiming.noteVisibleOutput();
      const metadata = resolveCliToolMetadata(toolUse);
      stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
      if (metadata.integration) {
        stdout.write(`[tool_integration] ${metadata.integration}\n`);
      }
      if (typeof metadata.isWrite === "boolean") {
        stdout.write(`[tool_is_write] ${metadata.isWrite}\n`);
      }
      stdout.write(`[tool_input] ${JSON.stringify(toolUse.toolInput)}\n`);
    },
    onToolResult: (toolName, resultValue) => {
      generationTiming.noteVisibleOutput();
      stdout.write(`\n[tool_result] ${toolName}\n`);
      stdout.write(
        `[tool_result_data] ${typeof resultValue === "string" ? resultValue : JSON.stringify(resultValue)}\n`,
      );
    },
    onApprovalResult: () => {
      attachRuntimeMetadataUnlocked = true;
    },
    onAuthResult: () => {
      attachRuntimeMetadataUnlocked = true;
    },
    onPendingApproval: async (approval, apiClient) => {
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: approval.generationId,
        conversationId: approval.conversationId,
      });
      generationTiming.noteVisibleOutput();
      stdout.write(`\n[approval_needed] ${approval.toolName}\n`);
      stdout.write(
        `[approval_input] ${JSON.stringify({
          integration: approval.integration,
          operation: approval.operation,
          command: approval.command,
          toolInput: approval.toolInput,
        })}\n`,
      );

      const questionItems = parseQuestionApprovalInput(approval.toolInput);
      if (state.chaosApproval === "defer") {
        stdout.write(`[approval_deferred] ${approval.toolUseId}\n`);
        if (state.debugApprovalHotWaitMs !== undefined) {
          await waitForApprovalParkedMarker(
            stdout,
            apiClient,
            approval.generationId,
            state.debugApprovalHotWaitMs + 5_000,
          );
        }
        return "deferred";
      }

      if (questionItems) {
        if (state.questionAnswer.length > 0) {
          const questionAnswers = collectScriptedQuestionAnswers(questionItems, [
            ...state.questionAnswer,
          ]);
          await apiClient.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: "approve",
            questionAnswers,
          });
          printApprovalDecisionMarker(stdout, approval.toolUseId, "approve");
          return "handled";
        }

        const approvalPrompt = createApprovalPrompt(rl);
        if (!approvalPrompt) {
          stdout.write(
            ` -> no interactive prompt available, leaving question interrupt pending (${approval.toolUseId})\n`,
          );
          return "deferred";
        }

        try {
          const questionAnswers = await collectQuestionApprovalAnswers(
            approvalPrompt.rl,
            questionItems,
          );
          await apiClient.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: "approve",
            questionAnswers,
          });
          printApprovalDecisionMarker(stdout, approval.toolUseId, "approve");
          return "handled";
        } finally {
          approvalPrompt.close();
        }
      }

      if (state.autoApprove) {
        await apiClient.generation.submitApproval({
          generationId: approval.generationId,
          toolUseId: approval.toolUseId,
          decision: "approve",
        });
        printApprovalDecisionMarker(stdout, approval.toolUseId, "approve");
        return "handled";
      }

      const approvalPrompt = createApprovalPrompt(rl);
      if (!approvalPrompt) {
        stdout.write(
          ` -> no interactive prompt available, leaving interrupt pending (${approval.toolUseId})\n`,
        );
        return "deferred";
      }

      try {
        const decision = (await ask(approvalPrompt.rl, "Approve? (y/n) ")).trim().toLowerCase();
        const normalizedDecision = decision === "y" || decision === "yes" ? "approve" : "deny";
        await apiClient.generation.submitApproval({
          generationId: approval.generationId,
          toolUseId: approval.toolUseId,
          decision: normalizedDecision,
        });
        printApprovalDecisionMarker(stdout, approval.toolUseId, normalizedDecision);
        return "handled";
      } finally {
        approvalPrompt.close();
      }
    },
    onAuthNeeded: async (auth, apiClient) => {
      generationTiming.noteVisibleOutput();
      stdout.write(`\n[auth_needed] ${auth.integrations.join(", ")}\n`);
      const authPrompt = createApprovalPrompt(rl);

      for (const integration of auth.integrations) {
        if (!isAuthIntegrationType(integration)) {
          stdout.write(`[auth_error] Unsupported integration for CLI auth flow: ${integration}\n`);
          return "deferred";
        }

        const redirectUrl = `${normalizedServerUrl}/chat/${auth.conversationId}?auth_complete=${integration}&generation_id=${auth.generationId}`;
        const { authUrl } = await apiClient.integration.getAuthUrl({
          type: integration,
          redirectUrl,
        });
        stdout.write(`[auth_url] ${integration}: ${authUrl}\n`);
        const opened = state.open ? openUrlInBrowser(authUrl) : false;
        stdout.write(
          opened
            ? "[auth_action] Browser opened. Complete auth in the browser.\n"
            : "[auth_action] Open the URL above and complete auth.\n",
        );

        if (!authPrompt) {
          stdout.write(
            "[auth_action] Non-interactive mode: cannot submit auth result automatically.\n",
          );
          return "deferred";
        }

        const confirmation = (
          await ask(authPrompt.rl, "auth> press Enter when done (or type 'cancel'): ")
        )
          .trim()
          .toLowerCase();
        const allow = confirmation !== "cancel" && confirmation !== "n" && confirmation !== "no";
        await apiClient.generation.submitAuthResult({
          generationId: auth.generationId,
          integration,
          success: allow,
        });
      }

      authPrompt?.close();
      return "handled";
    },
  });

  switch (result.status) {
    case "completed":
      generationTiming.noteCompleted();
      stdout.write("\n");
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      if (state.validate) {
        await validatePersistedAssistantMessage(client, result.conversationId, result.messageId, {
          content: result.assistant.content,
          parts: result.assistant.parts.map((part) => ({ type: part.type })),
        });
      }
      if (state.perfettoTrace) {
        const traceResult = exportPerfettoTraceForCompletedRun({
          cwd: process.cwd(),
          conversationId: result.conversationId,
          generationId: result.generationId,
          artifacts: result.artifacts,
        });
        if (traceResult.status === "written") {
          stdout.write(`[perfetto_trace] ${traceResult.path}\n`);
        } else {
          stdout.write("[warning] Perfetto trace export skipped: phase timestamps unavailable.\n");
        }
      }
      if (state.timing) {
        writeTimingSummary(stdout, result.artifacts);
        for (const line of buildGenerationTimingLines(generationTiming.snapshot())) {
          stdout.write(`${line}\n`);
        }
      }
      return result.conversationId;
    case "needs_auth":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "needs_approval":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "cancelled":
      stdout.write("\n[cancelled]\n");
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId;
    case "paused":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      return result.conversationId ?? null;
    case "failed":
      printGenerationMarkers(stdout, printedGenerationMarkers, {
        generationId: result.generationId,
        conversationId: result.conversationId,
      });
      stdout.write(`\n[error] ${result.error.message}\n`);
      if (
        result.error.diagnosticMessage &&
        result.error.diagnosticMessage !== result.error.message
      ) {
        stdout.write(`[diagnostic] ${result.error.diagnosticMessage}\n`);
      }
      return null;
  }
}

async function runChatLoop(
  stdout: NodeJS.WriteStream,
  client: CmdclawApiClient,
  rl: readline.Interface,
  state: ChatState,
): Promise<void> {
  let conversationId = state.conversationId;
  let pendingFiles = [...state.file];
  state.file = [];

  while (true) {
    const rawInput = await ask(rl, conversationId ? "followup> " : "chat> ");
    const input = rawInput.trim();
    if (!input) {
      stdout.write("Bye.\n");
      return;
    }

    if (input.startsWith("/file ")) {
      pendingFiles.push(input.slice(6).trim());
      stdout.write(`Attached: ${basename(input.slice(6).trim())}\n`);
      continue;
    }

    if (input === "/model") {
      stdout.write(
        `Current model: ${formatModelSelection({
          model: state.model ?? "auto",
          authSource: state.authSource,
        })}\n`,
      );
      continue;
    }

    if (input.startsWith("/model ")) {
      const parsed = parseInteractiveModelCommand(input.slice(7).trim());
      parseModelReference(parsed.model);
      const resolvedSelection = resolveCliModelSelection({
        model: parsed.model,
        authSource: parsed.authSource,
        connectedProviderIds: state.connectedProviderIds,
        sharedConnectedProviderIds: state.sharedConnectedProviderIds,
      });
      state.model = resolvedSelection.model;
      state.authSource = resolvedSelection.authSource;
      stdout.write(`Switched model to: ${formatModelSelection(resolvedSelection)}\n`);
      continue;
    }

    if (input === "/models") {
      await printAvailableModels(stdout, state);
      continue;
    }

    const attachments = pendingFiles.map((file) => fileToAttachment(file));
    pendingFiles = [];

    const nextConversationId = await runOneGeneration(stdout, client, rl, state, {
      kind: "start",
      content: input,
      conversationId,
      attachments: attachments.length ? attachments : undefined,
    });
    if (!nextConversationId) {
      return;
    }
    conversationId = nextConversationId;
  }
}

async function printAvailableModels(
  stdout: NodeJS.WriteStream,
  state: Pick<ChatState, "connectedProviderIds" | "sharedConnectedProviderIds">,
): Promise<void> {
  const freeModels = await listOpencodeFreeModels();
  const userOpenAIAvailable = (state.connectedProviderIds ?? []).includes("openai");
  const sharedGeminiAvailable = (state.sharedConnectedProviderIds ?? []).includes("google");

  stdout.write("CmdClaw Models:\n");
  stdout.write("- Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6) [source=shared]\n");
  stdout.write("- GPT-5.5 (openai/gpt-5.5) [source=shared]\n");
  stdout.write("- GPT-5.4 (openai/gpt-5.4) [source=shared]\n");
  stdout.write("- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=shared]\n");
  stdout.write(
    `- Gemini 3.1 Pro Preview (google/gemini-3.1-pro-preview) [source=shared]${sharedGeminiAvailable ? "" : " [unavailable]"}\n`,
  );
  stdout.write("\nYour AI Accounts:\n");
  if (userOpenAIAvailable) {
    stdout.write("- GPT-5.5 (openai/gpt-5.5) [source=user]\n");
    stdout.write("- GPT-5.4 (openai/gpt-5.4) [source=user]\n");
    stdout.write("- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=user]\n");
  } else {
    stdout.write("- ChatGPT not connected [source=user]\n");
  }
  if (freeModels.length > 0) {
    stdout.write(`\nFree OpenCode Models (${freeModels.length}):\n`);
    for (const model of freeModels) {
      stdout.write(`- ${model.name} (${model.id})\n`);
    }
  }
}

function attachSigintHandler(rl: readline.Interface): void {
  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });
}

export default async function (this: LocalContext, flags: ChatFlags): Promise<void> {
  const initialMessage = flags.message ?? flags.mesage;
  if (flags.message && flags.mesage) {
    throw new Error("--message and --mesage cannot both be used");
  }
  if ((flags.attach || flags.attachGeneration) && initialMessage) {
    throw new Error("--attach/--attach-generation cannot be used with --message");
  }
  if (flags.attach && flags.attachGeneration) {
    throw new Error("--attach cannot be used with --attach-generation");
  }
  const debugRunDeadlineMs = flags.chaosRunDeadline
    ? parseChaosDurationMs(flags.chaosRunDeadline)
    : undefined;
  const debugApprovalHotWaitMs = flags.chaosApprovalParkAfter
    ? parseChaosDurationMs(flags.chaosApprovalParkAfter)
    : undefined;
  const debugRuntimeNoProgressTimeoutMs = flags.chaosRuntimeNoProgress
    ? parseChaosDurationMs(flags.chaosRuntimeNoProgress)
    : undefined;

  const serverUrl = resolveServerUrl(flags.server);
  if (flags.token) {
    defaultProfileStore.save({
      serverUrl,
      token: flags.token,
    });
  }

  const { client } = await ensureAuthenticatedClient({
    serverUrl,
    token: flags.token,
  });

  const state: ChatState = {
    server: serverUrl,
    conversationId: flags.conversation,
    message: initialMessage,
    model: flags.model,
    authSource: flags.authSource,
    sandbox: flags.sandbox,
    autoApprove: flags.autoApprove,
    open: flags.open ?? false,
    chaosApproval: flags.chaosApproval,
    debugRunDeadlineMs,
    debugApprovalHotWaitMs,
    debugRuntimeNoProgressTimeoutMs,
    debugForceRuntimeNoProgressAfterPrompt:
      flags.chaosForceRuntimeNoProgress ?? false,
    validate: flags.validate,
    continueAfterMessage: (flags as InternalChatFlags).continueAfterMessage,
    file: flags.file ?? [],
    perfettoTrace: flags.perfettoTrace ?? false,
    timing: flags.timing ?? false,
    questionAnswer: flags.questionAnswer ?? [],
  };

  const authenticatedUserPromise = printAuthenticatedUserDeferred(client);
  await hydrateProviderAvailability(client, state);
  this.process.stdout.write(
    `[model] ${formatModelSelection({ model: state.model ?? "auto", authSource: state.authSource })}\n`,
  );
  this.process.stdout.write(await authenticatedUserPromise);

  if (flags.listModels) {
    await printAvailableModels(this.process.stdout, state);
    return;
  }

  if (flags.attachGeneration) {
    await runOneGeneration(this.process.stdout, client, null, state, {
      kind: "attach",
      generationId: flags.attachGeneration,
    });
    return;
  }

  if (flags.attach) {
    const active = (await client.generation.getActiveGeneration({
      conversationId: flags.attach,
    })) as ActiveConversationGeneration;
    state.conversationId = flags.attach;
    if (shouldAutoResumePausedRunDeadline(active) && active.generationId) {
      this.process.stdout.write(
        `[attach] conversation=${flags.attach} generation=${active.generationId} reason=run_deadline; sending continue\n`,
      );
      await runOneGeneration(this.process.stdout, client, null, state, {
        kind: "start",
        content: "continue",
        conversationId: flags.attach,
        resumePausedGenerationId: active.generationId,
      });
      return;
    }
    if (active.generationId && isAttachableGenerationStatus(active.status)) {
      this.process.stdout.write(
        `[attach] conversation=${flags.attach} generation=${active.generationId}\n`,
      );
      const rl = process.stdin.isTTY && process.stdout.isTTY ? createPrompt() : null;
      if (rl) {
        attachSigintHandler(rl);
      }
      try {
        await runOneGeneration(this.process.stdout, client, rl, state, {
          kind: "attach",
          generationId: active.generationId,
          suppressReplayRuntimeMetadataUntilDecision:
            active.status === "awaiting_approval" || active.status === "awaiting_auth",
        });
      } finally {
        rl?.close();
      }
      return;
    }

    this.process.stdout.write(
      active.status
        ? `[attach] conversation=${flags.attach} status=${active.status}; no active generation, opening followup prompt\n`
        : `[attach] conversation=${flags.attach}; no active generation, opening followup prompt\n`,
    );
    const rl = createPrompt();
    attachSigintHandler(rl);
    await runChatLoop(this.process.stdout, client, rl, state);
    rl.close();
    return;
  }

  if (state.message) {
    const rl =
      state.continueAfterMessage && process.stdin.isTTY && process.stdout.isTTY
        ? createPrompt()
        : null;
    if (rl) {
      attachSigintHandler(rl);
    }
    const attachments = state.file.map((file) => fileToAttachment(file));
    const conversationId = await runOneGeneration(this.process.stdout, client, rl, state, {
      kind: "start",
      content: state.message,
      conversationId: state.conversationId,
      attachments: attachments.length ? attachments : undefined,
    });
    if (conversationId && rl) {
      state.conversationId = conversationId;
      state.message = undefined;
      state.file = [];
      await runChatLoop(this.process.stdout, client, rl, state);
      rl.close();
    }
    return;
  }

  const rl = createPrompt();
  attachSigintHandler(rl);
  await runChatLoop(this.process.stdout, client, rl, state);
  rl.close();
}
