import type { RouterClient } from "@orpc/server";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { buildCoworkerEditApplyEnvelope } from "@bap/core/lib/coworker-runtime-cli";
import { coworkerBuilderEditSchema } from "@bap/core/server/services/coworker-builder-service";
import { closePool } from "@bap/db/client";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import readline from "node:readline";
import { ZodError } from "zod";
import type { AppRouter } from "@/server/orpc";
import { runGenerationStream } from "@/lib/generation-stream";
import { DEFAULT_SERVER_URL, ask, createRpcClient, loadConfig } from "./lib/cli-shared";
import {
  buildSchedule,
  type CoworkerIntegrationType,
  isCoworkerIntegrationType,
  type ParsedArgs,
  parseArgs,
  printHelp,
} from "./lib/coworker-args";
import { debugCoworkerRun, printDebugCoworkerSnapshot } from "./lib/coworker-debug";
import {
  formatConversationTranscript,
  formatDate,
  formatToolResult,
  inferMimeType,
  parsePayload,
  printCoworkerDetails,
  printCoworkerSummary,
  sleep,
  statusBadge,
  TERMINAL_STATUSES,
} from "./lib/coworker-format";
import {
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "./lib/question-approval";
import { resolveCliToolMetadata } from "./lib/tool-metadata";

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

async function listCoworkers(client: RouterClient<AppRouter>, args?: ParsedArgs): Promise<void> {
  const coworkers = await client.coworker.list();

  if (args?.json) {
    console.log(JSON.stringify(coworkers, null, 2));
    return;
  }

  if (coworkers.length === 0) {
    console.log("No coworkers found.");
    return;
  }

  console.log(`Coworkers (${coworkers.length}):\n`);
  for (const wf of coworkers) {
    printCoworkerSummary(wf);
  }
}

function isCoworkerUsernameReference(value: string): boolean {
  return value.trim().startsWith("@");
}

async function resolveCoworkerReference(
  client: RouterClient<AppRouter>,
  reference: string,
): Promise<string> {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error("Coworker reference cannot be empty.");
  }

  if (!isCoworkerUsernameReference(trimmed)) {
    return trimmed;
  }

  const username = trimmed.slice(1).trim().toLowerCase();
  if (!username) {
    throw new Error("Coworker username cannot be empty.");
  }

  const coworkers = await client.coworker.list();
  const matched = coworkers.find((coworker) => coworker.username === username);
  if (!matched) {
    throw new Error(`Coworker @${username} not found.`);
  }

  return matched.id;
}

async function showCoworker(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error(
      "Usage: bun run coworker show <coworker-id|@username> [--format text|markdown|json]",
    );
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  const coworker = await client.coworker.get({ id: coworkerId });
  printCoworkerDetails(coworker, args.format);
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path
              .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
              .join(".")
              .replace(/\.\[/g, "[")
          : "changes";

      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

async function readJsonArgument(filePath: string | undefined): Promise<unknown> {
  if (filePath?.trim()) {
    const resolvedPath = filePath.trim();
    try {
      return JSON.parse(await readFile(resolvedPath, "utf8"));
    } catch {
      throw new Error(`Invalid JSON in --changes-file: ${resolvedPath}`);
    }
  }

  throw new Error("edit requires --changes-file");
}

async function parseEditInput(changesFile: string | undefined) {
  const parsedUnknown = await readJsonArgument(changesFile);
  const parsed = coworkerBuilderEditSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  return parsed.data;
}

async function editCoworker(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error(
      "Usage: bun run coworker edit <coworker-id|@username> --base-updated-at <iso> --changes-file <path> [--json]",
    );
  }
  if (!args.baseUpdatedAt?.trim()) {
    throw new Error("edit requires --base-updated-at");
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  const result = await client.coworker.edit({
    coworkerId,
    baseUpdatedAt: args.baseUpdatedAt.trim(),
    changes: await parseEditInput(args.changesFile),
  });

  const envelope = buildCoworkerEditApplyEnvelope({
    coworkerId,
    result,
  });

  if (args.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  console.log(envelope.message);
  if (envelope.status === "applied" || envelope.status === "conflict") {
    console.log("");
    printCoworkerDetails({
      ...(await client.coworker.get({ id: coworkerId })),
    });
    return;
  }

  if (envelope.details.length > 0) {
    console.log(envelope.details.join("\n"));
  }
}

async function uploadCoworkerDocumentCommand(
  client: RouterClient<AppRouter>,
  args: ParsedArgs,
): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error(
      "Usage: bun run coworker upload-document <coworker-id|@username> --file <path> [--description <text>] [--json]",
    );
  }
  if (!args.filePath?.trim()) {
    throw new Error("upload-document requires --file");
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  const filePath = args.filePath.trim();
  const content = await readFile(filePath);
  const result = await client.coworker.uploadDocument({
    coworkerId,
    filename: basename(filePath),
    mimeType: inferMimeType(filePath),
    content: content.toString("base64"),
    description: args.description,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Uploaded ${result.filename} to coworker ${coworkerId}`);
  console.log(`  document id: ${result.id}`);
  console.log(`  mime type: ${result.mimeType}`);
  console.log(`  size: ${result.sizeBytes} bytes`);
}

async function createCoworker(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  if (!args.name || !args.triggerType || !args.prompt) {
    throw new Error("create requires --name, --trigger, and --prompt");
  }

  const rawIntegrations = args.integrations ?? [];
  const allowedIntegrations = rawIntegrations.filter(isCoworkerIntegrationType);
  const invalidIntegrations = rawIntegrations.filter((item) => !isCoworkerIntegrationType(item));

  if (invalidIntegrations.length > 0) {
    console.log(`Ignoring unknown integrations: ${invalidIntegrations.join(", ")}`);
  }

  const created = await client.coworker.create({
    name: args.name,
    triggerType: args.triggerType,
    prompt: args.prompt,
    autoApprove: args.autoApprove,
    allowedIntegrations,
    allowedCustomIntegrations: args.customIntegrations ?? [],
    schedule: buildSchedule(args),
  });

  console.log("Created coworker:");
  printCoworkerSummary({
    id: created.id,
    name: created.name,
    description: created.description,
    username: created.username,
    status: created.status,
    triggerType: args.triggerType,
    schedule: buildSchedule(args),
    lastRunStatus: null,
    lastRunAt: null,
  });
}

async function resolveRemoteIntegrationSource(
  client: RouterClient<AppRouter>,
  args: ParsedArgs,
): Promise<{ targetEnv: "staging" | "prod"; remoteUserId: string } | undefined> {
  const hasRemoteSourceInput = Boolean(
    args.remoteIntegrationEnv || args.remoteIntegrationUserId || args.remoteIntegrationUserEmail,
  );
  if (!hasRemoteSourceInput) {
    return undefined;
  }

  if (!args.remoteIntegrationEnv) {
    throw new Error("--remote-integration-env is required when using remote integrations");
  }
  if (args.remoteIntegrationUserId && args.remoteIntegrationUserEmail) {
    throw new Error(
      "Use only one of --remote-integration-user-id or --remote-integration-user-email",
    );
  }
  if (args.remoteIntegrationUserId) {
    return {
      targetEnv: args.remoteIntegrationEnv,
      remoteUserId: args.remoteIntegrationUserId,
    };
  }
  if (!args.remoteIntegrationUserEmail) {
    throw new Error(
      "Remote integrations require --remote-integration-user-id or --remote-integration-user-email",
    );
  }

  const result = await client.coworker.searchRemoteIntegrationUsers({
    targetEnv: args.remoteIntegrationEnv,
    query: args.remoteIntegrationUserEmail,
    limit: 10,
  });
  const normalizedEmail = args.remoteIntegrationUserEmail.trim().toLowerCase();
  const exactMatch = result.users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
  if (!exactMatch) {
    const candidates = result.users.map((entry) => `${entry.email} (${entry.id})`).join(", ");
    throw new Error(
      `Remote integration user ${args.remoteIntegrationUserEmail} was not found in ${args.remoteIntegrationEnv}.${candidates ? ` Candidates: ${candidates}` : ""}`,
    );
  }

  return {
    targetEnv: args.remoteIntegrationEnv,
    remoteUserId: exactMatch.id,
  };
}

async function runCoworker(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error(
      "Usage: bun run coworker run <coworker-id|@username> [--payload <json>] [--watch] [--debug]",
    );
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  const coworker = args.debug ? await client.coworker.get({ id: coworkerId }) : null;
  if (coworker) {
    printDebugCoworkerSnapshot(coworker);
  }

  const payload = parsePayload(args.payload);
  const trustedUserInput = args.userInput?.trim();
  const remoteIntegrationSource = await resolveRemoteIntegrationSource(client, args);
  if (remoteIntegrationSource) {
    console.log(
      `Using remote integrations from ${remoteIntegrationSource.targetEnv} user ${remoteIntegrationSource.remoteUserId}`,
    );
  }
  const result = await client.coworker.trigger({
    id: coworkerId,
    payload,
    trustedUserInput:
      trustedUserInput && trustedUserInput.length > 0 ? trustedUserInput : undefined,
    remoteIntegrationSource,
  });

  console.log(`Triggered coworker ${result.coworkerId}`);
  console.log(`  run id: ${result.runId}`);
  console.log(`  generation id: ${result.generationId ?? "-"}`);
  console.log(`  conversation id: ${result.conversationId}`);

  if (!result.generationId) {
    console.log("  status: Needs your input");
    console.log("  answer in the linked coworker conversation to start the run.");
    if (args.debug || args.watch) {
      console.log("  skipping watch/debug because no generation has started yet.");
    }
    return;
  }

  if (args.debug) {
    console.log("\n[debug] Monitoring fresh run using current saved coworker definition.\n");
    await debugCoworkerRun(
      client,
      {
        coworkerId: result.coworkerId,
        runId: result.runId,
        generationId: result.generationId,
        conversationId: result.conversationId,
      },
      args.watchIntervalSeconds,
    );
    return;
  }

  if (args.watch) {
    console.log("\nWatching logs... (Ctrl+C to stop)\n");
    await printRunLogs(client, result.runId, true, args.watchIntervalSeconds);
  }
}

async function listRuns(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error("Usage: bun run coworker runs <coworker-id|@username> [--limit <n>]");
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  const runs = await client.coworker.listRuns({
    coworkerId,
    limit: args.limit ?? 20,
  });

  if (runs.length === 0) {
    console.log(`No runs found for coworker ${coworkerId}.`);
    return;
  }

  console.log(`Runs for ${coworkerId} (${runs.length}):\n`);
  for (const run of runs) {
    console.log(`${statusBadge(run.status)} ${run.id}`);
    console.log(`  started: ${formatDate(run.startedAt)}`);
    if (run.finishedAt) {
      console.log(`  finished: ${formatDate(run.finishedAt)}`);
    }
    if (run.errorMessage) {
      console.log(`  error: ${run.errorMessage}`);
    }
    console.log("");
  }
}

async function printRunLogs(
  client: RouterClient<AppRouter>,
  runId: string,
  watch: boolean,
  watchIntervalSeconds: number,
): Promise<void> {
  const seenEventIds = new Set<string>();
  let lastTranscript = "";
  let previousStatus = "";

  while (true) {
    // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
    const run = await client.coworker.getRun({ id: runId });

    if (run.status !== previousStatus) {
      console.log(`Run ${run.id} ${statusBadge(run.status)}`);
      console.log(`  coworker: ${run.coworkerId}`);
      console.log(`  started: ${formatDate(run.startedAt)}`);
      if (run.finishedAt) {
        console.log(`  finished: ${formatDate(run.finishedAt)}`);
      }
      if (run.errorMessage) {
        console.log(`  error: ${run.errorMessage}`);
      }
      previousStatus = run.status;
      console.log("");
    }

    const unseenEvents = run.events.filter((event) => !seenEventIds.has(event.id));
    if (unseenEvents.length > 0) {
      console.log(`Events (${unseenEvents.length} new):`);
      for (const event of unseenEvents) {
        seenEventIds.add(event.id);
        console.log(`- ${formatDate(event.createdAt)} [${event.type}]`);
        console.log(`  ${JSON.stringify(event.payload, null, 2).replace(/\n/g, "\n  ")}`);
      }
      console.log("");
    }

    if (run.conversationId) {
      try {
        // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
        const conversation = await client.conversation.get({ id: run.conversationId });
        const transcript = formatConversationTranscript(conversation.messages);

        if (transcript && transcript !== lastTranscript) {
          const transcriptLabel = lastTranscript ? "Updated transcript:" : "Transcript:";
          console.log(transcriptLabel);
          console.log(transcript);
          console.log("");
          lastTranscript = transcript;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load conversation transcript: ${message}`);
      }
    }

    if (!watch || TERMINAL_STATUSES.has(run.status)) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop -- polling loop waits between sequential fetches
    await sleep(watchIntervalSeconds * 1000);
  }
}

async function logsCoworkerRun(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const runId = args.positionals[0];
  if (!runId) {
    throw new Error("Usage: bun run coworker logs <run-id> [--watch]");
  }

  await printRunLogs(client, runId, args.watch, args.watchIntervalSeconds);
}

async function approveCoworkerRun(
  client: RouterClient<AppRouter>,
  args: ParsedArgs,
): Promise<void> {
  const runId = args.positionals[0];
  const toolUseId = args.positionals[1];
  const decisionRaw = args.positionals[2];

  if (!runId || !toolUseId || !decisionRaw) {
    throw new Error("Usage: bun run coworker approve <run-id> <tool-use-id> <approve|deny>");
  }

  if (decisionRaw !== "approve" && decisionRaw !== "deny") {
    throw new Error("Decision must be 'approve' or 'deny'");
  }
  const decision: "approve" | "deny" = decisionRaw;

  const run = await client.coworker.getRun({ id: runId });
  if (!run.generationId) {
    throw new Error(`Run ${runId} has no active generation for approval.`);
  }

  const result = await client.generation.submitApproval({
    generationId: run.generationId,
    toolUseId,
    decision,
  });

  if (!result.success) {
    throw new Error("Approval was not applied. Request may be stale or already resolved.");
  }

  console.log(`Submitted ${decision} for ${toolUseId} on run ${runId}.`);
}

async function collectQuestionApprovalAnswers(
  rl: readline.Interface,
  questions: QuestionApprovalItem[],
): Promise<string[][]> {
  const collectOne = async (index: number): Promise<string[][]> => {
    if (index >= questions.length) {
      return [];
    }

    const question = questions[index]!;
    process.stdout.write(`\n[question] ${question.header}\n`);
    process.stdout.write(`${question.question}\n`);

    question.options.forEach((option, optionIndex) => {
      const suffix = option.description ? ` - ${option.description}` : "";
      process.stdout.write(`  ${optionIndex + 1}. ${option.label}${suffix}\n`);
    });

    if (question.custom) {
      process.stdout.write("  t. Type your own answer\n");
    }

    const prompt =
      question.options.length > 0
        ? question.multiple
          ? "Select option(s) comma-separated (default 1): "
          : "Select an option (default 1): "
        : "Answer: ";
    const rawSelection = (await ask(rl, prompt)).trim();

    let selectedAnswers: string[];
    if (question.custom && rawSelection.toLowerCase() === "t") {
      const typedPrompt = question.multiple
        ? "Type your answer(s) (comma-separated): "
        : "Type your answer: ";
      const typedAnswer = await ask(rl, typedPrompt);
      selectedAnswers = resolveQuestionSelection(question, typedAnswer);
    } else {
      selectedAnswers = resolveQuestionSelection(question, rawSelection);
    }

    const remaining = await collectOne(index + 1);
    return [selectedAnswers, ...remaining];
  };

  return collectOne(0);
}

function isReadlineOpen(rl: readline.Interface | null): rl is readline.Interface {
  if (!rl) {
    return false;
  }
  return !(rl as readline.Interface & { closed?: boolean }).closed;
}

function createApprovalPrompt(rl: readline.Interface | null): {
  rl: readline.Interface;
  close: () => void;
} | null {
  if (isReadlineOpen(rl) && process.stdin.isTTY && process.stdout.isTTY) {
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
    const output = createWriteStream("/dev/tty");
    const ttyRl = readline.createInterface({ input, output });
    return {
      rl: ttyRl,
      close: () => {
        ttyRl.close();
        input.close();
        output.end();
      },
    };
  } catch {
    return null;
  }
}

async function startBuilderAgent(
  client: RouterClient<AppRouter>,
  params: {
    coworkerId: string;
    goal: string;
    model?: string;
  },
): Promise<void> {
  const { coworkerId, goal, model } = params;
  const resolvedModel = model?.trim() || DEFAULT_COWORKER_BUILDER_MODEL;
  const { conversationId } = await client.coworker.getOrCreateBuilderConversation({
    id: coworkerId,
  });
  const started = await client.generation.startGeneration({
    conversationId,
    content: goal,
    model: resolvedModel,
    authSource: "shared",
    autoApprove: true,
  });

  console.log(`Builder started for coworker ${coworkerId}`);
  console.log(`  conversation id: ${started.conversationId}`);
  console.log(`  generation id: ${started.generationId}`);
  console.log(`  model: ${resolvedModel}`);
  console.log("\nBuilder output:\n");
  const promptRl =
    process.stdin.isTTY && process.stdout.isTTY
      ? readline.createInterface({ input: process.stdin, output: process.stdout })
      : null;

  try {
    await runGenerationStream({
      client,
      generationId: started.generationId,
      callbacks: {
        onText: (content) => {
          process.stdout.write(content);
        },
        onSystem: ({ content }) => {
          process.stdout.write(`\n[system] ${content}\n`);
        },
        onThinking: (thinking) => {
          process.stdout.write(`\n[thinking] ${thinking.content}\n`);
        },
        onToolUse: (toolUse) => {
          const metadata = resolveCliToolMetadata(toolUse);
          process.stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
          if (metadata.integration) {
            process.stdout.write(`[tool_integration] ${metadata.integration}\n`);
          }
          if (typeof metadata.isWrite === "boolean") {
            process.stdout.write(`[tool_is_write] ${metadata.isWrite}\n`);
          }
          process.stdout.write(`[tool_input] ${JSON.stringify(toolUse.toolInput)}\n`);
        },
        onToolResult: (toolName, result) => {
          if (toolName === "question") {
            process.stdout.write(`\n[tool_result] ${toolName} ${JSON.stringify(result)}\n`);
            return;
          }

          process.stdout.write(`\n[tool_result] ${toolName}\n`);
          process.stdout.write(`[tool_result_data] ${formatToolResult(result)}\n`);
        },
        onPendingApproval: async (approval) => {
          process.stdout.write(`\n[approval_needed] ${approval.toolName}\n`);
          process.stdout.write(
            `[approval_input] ${JSON.stringify({
              integration: approval.integration,
              operation: approval.operation,
              command: approval.command,
              toolInput: approval.toolInput,
            })}\n`,
          );
          const questionItems = parseQuestionApprovalInput(approval.toolInput);
          if (!questionItems) {
            process.stdout.write(
              " -> coworker builder CLI only supports interactive question approvals right now.\n",
            );
            return;
          }

          const approvalPrompt = createApprovalPrompt(promptRl);
          if (!approvalPrompt) {
            process.stdout.write(
              `\n[question_pending] ${approval.toolUseId}\n -> no interactive prompt available, leaving question interrupt pending.\n`,
            );
            return;
          }

          const questionAnswers = await (async () => {
            try {
              return await collectQuestionApprovalAnswers(approvalPrompt.rl, questionItems);
            } finally {
              approvalPrompt.close();
            }
          })();

          await client.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: "approve",
            questionAnswers,
          });
        },
        onApprovalResult: (toolUseId, decision) => {
          process.stdout.write(`\n[approval_${decision}] ${toolUseId}\n`);
        },
        onStatusChange: (status, metadata) => {
          process.stdout.write(`\n[status] ${status}\n`);
          if (metadata) {
            process.stdout.write(`[status_metadata] ${JSON.stringify(metadata)}\n`);
          }
        },
        onError: (error) => {
          process.stdout.write(`\nBuilder generation error: ${error.message}\n`);
        },
        onCancelled: () => {
          process.stdout.write("\nBuilder generation cancelled.\n");
        },
        onDone: () => {
          process.stdout.write("\n");
        },
      },
    });
  } finally {
    promptRl?.close();
  }

  const updated = await client.coworker.get({ id: coworkerId });
  console.log("\nCoworker after builder run:");
  printCoworkerDetails(updated);
}

function getCloseLoopExampleGoal(): string {
  return [
    "Create a coworker that sends a message in Slack channel #bap-experiments every hour.",
    "Use schedule trigger with hourly cadence.",
    "Keep integrations minimal and include slack.",
    "Set coworker prompt so it posts a concise experiment update message.",
  ].join(" ");
}

async function runBuilderCommand(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const coworkerRef = args.positionals[0];
  if (!coworkerRef) {
    throw new Error("Usage: bun run coworker builder <coworker-id|@username> --message <text>");
  }
  if (!args.message?.trim()) {
    throw new Error("builder requires --message");
  }

  const coworkerId = await resolveCoworkerReference(client, coworkerRef);
  await startBuilderAgent(client, {
    coworkerId,
    goal: args.message.trim(),
    model: args.model,
  });
}

async function runCloseLoopCommand(
  client: RouterClient<AppRouter>,
  args: ParsedArgs,
  options?: { useExampleGoal?: boolean },
): Promise<void> {
  const rawIntegrations = args.integrations ?? [];
  const allowedIntegrations =
    rawIntegrations.length > 0
      ? rawIntegrations.filter(isCoworkerIntegrationType)
      : (["slack"] as CoworkerIntegrationType[]);

  const invalidIntegrations = rawIntegrations.filter((item) => !isCoworkerIntegrationType(item));
  if (invalidIntegrations.length > 0) {
    console.log(`Ignoring unknown integrations: ${invalidIntegrations.join(", ")}`);
  }

  const draftName = args.name?.trim() || "Close Loop Draft";
  const created = await client.coworker.create({
    name: draftName,
    triggerType: "manual",
    prompt: "",
    autoApprove: true,
    allowedIntegrations,
    allowedCustomIntegrations: args.customIntegrations ?? [],
    schedule: null,
  });

  const goal =
    options?.useExampleGoal === true
      ? getCloseLoopExampleGoal()
      : (args.message?.trim() ?? getCloseLoopExampleGoal());

  console.log(`Created draft coworker ${created.name}`);
  console.log(`  id: ${created.id}`);
  console.log(`  goal: ${goal}`);
  console.log("");

  await startBuilderAgent(client, {
    coworkerId: created.id,
    goal,
    model: args.model,
  });
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;

  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exit(1);
  }

  const serverUrl = parsed.serverUrl || process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;
  const config = loadConfig(serverUrl);
  if (!config?.token) {
    console.error(
      `Not authenticated for ${serverUrl}. Run 'bun run chat -- --server ${serverUrl} --auth' first.`,
    );
    process.exit(1);
  }
  const client = createRpcClient(serverUrl, config.token);

  try {
    if (!parsed.command && parsed.list) {
      await listCoworkers(client, parsed);
      return;
    }
    if (!parsed.command && parsed.message?.trim()) {
      await runCloseLoopCommand(client, parsed);
      return;
    }
    if (!parsed.command) {
      printHelp();
      process.exit(1);
    }

    switch (parsed.command) {
      case "list":
      case "ls":
        await listCoworkers(client, parsed);
        break;
      case "edit":
        await editCoworker(client, parsed);
        break;
      case "upload-document":
        await uploadCoworkerDocumentCommand(client, parsed);
        break;
      case "create":
      case "new":
        await createCoworker(client, parsed);
        break;
      case "show":
      case "get":
      case "inspect":
        await showCoworker(client, parsed);
        break;
      case "run":
      case "trigger":
      case "fire":
        await runCoworker(client, parsed);
        break;
      case "logs":
      case "show-run":
        await logsCoworkerRun(client, parsed);
        break;
      case "approve":
        await approveCoworkerRun(client, parsed);
        break;
      case "runs":
        await listRuns(client, parsed);
        break;
      case "builder":
        await runBuilderCommand(client, parsed);
        break;
      case "close-loop":
        await runCloseLoopCommand(client, parsed);
        break;
      case "close-loop-example":
        await runCloseLoopCommand(client, parsed, { useExampleGoal: true });
        break;
      default:
        throw new Error(`Unknown command: ${parsed.command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await closePool().catch(() => undefined);
  }
}

void main();
