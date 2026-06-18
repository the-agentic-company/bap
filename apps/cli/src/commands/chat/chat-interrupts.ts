import type {
  AuthNeededData,
  BapApiClient,
  GenerationPendingApprovalData,
} from "@bap/client";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import {
  collectScriptedQuestionAnswers,
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "../../lib/question-approval";
import {
  printApprovalDecisionMarker,
  printApprovalParked,
  printGenerationMarkers,
  type PrintedGenerationMarkers,
} from "./chat-output-markers";

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

function isAuthIntegrationType(integration: string): integration is AuthIntegrationType {
  return (AUTH_INTEGRATION_TYPES as readonly string[]).includes(integration);
}

export function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function ask(rl: readline.Interface, query: string): Promise<string> {
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

async function waitForApprovalParkedMarker(
  stdout: NodeJS.WriteStream,
  client: BapApiClient,
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

export type PendingApprovalArgs = {
  stdout: NodeJS.WriteStream;
  rl: readline.Interface | null;
  approval: GenerationPendingApprovalData;
  apiClient: BapApiClient;
  printedGenerationMarkers: PrintedGenerationMarkers;
  noteVisibleOutput: () => void;
  chaosApproval: "ask" | "defer";
  autoApprove?: boolean;
  questionAnswer: readonly string[];
  debugApprovalHotWaitMs?: number;
};

export async function handlePendingApproval(
  args: PendingApprovalArgs,
): Promise<"handled" | "deferred"> {
  const {
    stdout,
    rl,
    approval,
    apiClient,
    printedGenerationMarkers,
    noteVisibleOutput,
  } = args;

  printGenerationMarkers(stdout, printedGenerationMarkers, {
    generationId: approval.generationId,
    conversationId: approval.conversationId,
  });
  noteVisibleOutput();
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
  if (args.chaosApproval === "defer") {
    stdout.write(`[approval_deferred] ${approval.toolUseId}\n`);
    if (args.debugApprovalHotWaitMs !== undefined) {
      await waitForApprovalParkedMarker(
        stdout,
        apiClient,
        approval.generationId,
        args.debugApprovalHotWaitMs + 5_000,
      );
    }
    return "deferred";
  }

  if (questionItems) {
    if (args.questionAnswer.length > 0) {
      const questionAnswers = collectScriptedQuestionAnswers(questionItems, [
        ...args.questionAnswer,
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

  if (args.autoApprove) {
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
}

export type AuthNeededArgs = {
  stdout: NodeJS.WriteStream;
  rl: readline.Interface | null;
  auth: AuthNeededData;
  apiClient: BapApiClient;
  noteVisibleOutput: () => void;
  normalizedServerUrl: string;
  open: boolean;
};

export async function handleAuthNeeded(
  args: AuthNeededArgs,
): Promise<"handled" | "deferred"> {
  const { stdout, rl, auth, apiClient, noteVisibleOutput, normalizedServerUrl } = args;
  noteVisibleOutput();
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
    const opened = args.open ? openUrlInBrowser(authUrl) : false;
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
}
