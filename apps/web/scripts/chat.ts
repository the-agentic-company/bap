import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import type { RouterClient } from "@orpc/server";
import { resolveDefaultChatModel } from "@bap/core/lib/chat-model-defaults";
import { parseModelReference } from "@bap/core/lib/model-reference";
import { listOpencodeFreeModels } from "@bap/core/server/ai/opencode-models";
import { basename } from "node:path";
import readline from "node:readline";
import type { AppRouter } from "@/server/orpc";
import { createGenerationRuntime } from "@/lib/generation-runtime";
import { runGenerationStream } from "@/lib/generation-stream";
import { createApprovalPrompt, collectQuestionApprovalAnswers } from "./lib/chat-approval";
import { authenticate, openUrlInBrowser } from "./lib/chat-auth-flow";
import {
  fileToAttachment,
  formatClockTime,
  formatDurationMs,
  formatStatusMetadata,
  formatToolResult,
  validatePersistedAssistantMessage,
} from "./lib/chat-format";
import {
  formatModelSelection,
  parseInteractiveModelCommand,
  resolveCliModelSelection,
} from "./lib/chat-model-source";
import {
  DEFAULT_SERVER_URL,
  ask,
  clearConfig,
  createPrompt,
  createRpcClient,
  loadConfig,
  saveConfig,
} from "./lib/cli-shared";
import {
  collectScriptedQuestionAnswers,
  parseQuestionApprovalInput,
} from "./lib/question-approval";
import { resolveCliToolMetadata } from "./lib/tool-metadata";

type Args = {
  authOnly: boolean;
  authSource?: ProviderAuthSource | null;
  autoApprove: boolean;
  connectedProviderIds?: string[];
  conversationId?: string;
  files: string[];
  resetAuth: boolean;
  listModels: boolean;
  message?: string;
  model?: string;
  open: boolean;
  questionAnswers: string[];
  sandboxProvider?: "e2b" | "daytona" | "docker";
  serverUrl?: string;
  sharedConnectedProviderIds?: string[];
  token?: string;
  validatePersistence: boolean;
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
] as const;

type AuthIntegrationType = (typeof AUTH_INTEGRATION_TYPES)[number];
type ChatFileAttachment = {
  fileAssetId: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    autoApprove: false,
    validatePersistence: true,
    authOnly: false,
    resetAuth: false,
    listModels: false,
    open: false,
    questionAnswers: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--conversation":
      case "-c":
        args.conversationId = argv[i + 1];
        i += 1;
        break;
      case "--message":
      case "-m":
        args.message = argv[i + 1];
        i += 1;
        break;
      case "--model":
      case "-M":
        args.model = argv[i + 1];
        i += 1;
        break;
      case "--auth-source": {
        const value = argv[i + 1];
        if (value !== "user" && value !== "shared") {
          console.error("Invalid --auth-source value. Use one of: user, shared");
          process.exit(1);
        }
        args.authSource = value;
        i += 1;
        break;
      }
      case "--sandbox": {
        const value = argv[i + 1];
        if (value !== "e2b" && value !== "daytona" && value !== "docker") {
          console.error("Invalid --sandbox value. Use one of: e2b, daytona, docker");
          process.exit(1);
        }
        args.sandboxProvider = value;
        i += 1;
        break;
      }
      case "--list-models":
        args.listModels = true;
        break;
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--open":
        args.open = true;
        break;
      case "--no-validate":
        args.validatePersistence = false;
        break;
      case "--auth":
        args.authOnly = true;
        break;
      case "--reset-auth":
        args.resetAuth = true;
        break;
      case "--token":
        args.token = argv[i + 1];
        i += 1;
        break;
      case "--file":
      case "-f":
        args.files.push(argv[i + 1]!);
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--question-answer":
      case "-q":
        args.questionAnswers.push(argv[i + 1] || "");
        i += 1;
        break;
      default:
        if (arg?.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log("\nUsage: bun run chat [options]\n");
  console.log("Options:");
  console.log("  -s, --server <url>        Server URL (default http://localhost:3000)");
  console.log("  -c, --conversation <id>   Continue an existing conversation");
  console.log(
    "  -m, --message <text>      Send an initial message (TTY stays interactive; non-TTY exits)",
  );
  console.log(
    "  -M, --model <provider/model> Model reference (default prefers ChatGPT when connected)",
  );
  console.log("  --auth-source <user|shared> Override model source when the provider supports it");
  console.log("  --sandbox <e2b|daytona|docker> Override sandbox provider for this generation");
  console.log("  --list-models             List chat model options and exit");
  console.log("  --auto-approve            Auto-approve tool calls");
  console.log("  --open                    Open auth URLs in the browser automatically");
  console.log("  --no-validate             Skip persisted message validation");
  console.log("  -q, --question-answer <v> Pre-answer OpenCode question prompts (repeatable)");
  console.log("  --auth                    Run auth flow and exit");
  console.log("  --token <token>           Use provided auth token directly");
  console.log("  --reset-auth              Clear saved token and re-auth");
  console.log("  -f, --file <path>         Attach file (can be used multiple times)");
  console.log("  -h, --help                Show help\n");
  console.log("Interactive commands:");
  console.log("  /file <path>              Attach file before sending");
  console.log("  /model                    Show current model");
  console.log("  /model <provider/model> [--auth-source <user|shared>]   Switch model");
  console.log("  /models                   List chat model options\n");
}

function isAuthIntegrationType(integration: string): integration is AuthIntegrationType {
  return (AUTH_INTEGRATION_TYPES as readonly string[]).includes(integration);
}

async function runChatLoop(
  client: RouterClient<AppRouter>,
  rl: readline.Interface,
  options: Args,
): Promise<void> {
  let conversationId = options.conversationId;

  let pendingFiles: ChatFileAttachment[] = [];

  // Attach files passed via --file on the first message
  const initialAttachments = await Promise.all(
    options.files.map(async (f) => {
      try {
        return { filePath: f, attachment: await fileToAttachment(client, f) };
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        return null;
      }
    }),
  );
  for (const result of initialAttachments) {
    if (!result) {
      continue;
    }
    pendingFiles.push(result.attachment);
    console.log(`Attached: ${basename(result.filePath)}`);
  }

  const runStep = async (): Promise<void> => {
    let rawInput: string;
    try {
      rawInput = await ask(rl, conversationId ? "followup> " : "chat> ");
    } catch (error) {
      const isClosedReadline =
        error instanceof Error &&
        "code" in error &&
        (error as Error & { code?: string }).code === "ERR_USE_AFTER_CLOSE";
      if (isClosedReadline) {
        console.log("Bye.");
        return;
      }
      throw error;
    }

    const input = rawInput.trim();
    if (!input) {
      console.log("Bye.");
      return;
    }

    // /file <path> command to attach a file before sending
    if (input.startsWith("/file ")) {
      const filePath = input.slice(6).trim();
      try {
        pendingFiles.push(await fileToAttachment(client, filePath));
        console.log(`Attached: ${basename(filePath)} (${pendingFiles.length} file(s) pending)`);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
      }
      return runStep();
    }

    if (input === "/model") {
      console.log(
        `Current model: ${formatModelSelection({
          model: options.model ?? "auto",
          authSource: options.authSource,
        })}`,
      );
      return runStep();
    }

    if (input.startsWith("/model ")) {
      try {
        const parsed = parseInteractiveModelCommand(input.slice(7).trim());
        parseModelReference(parsed.model);
        const resolvedSelection = resolveCliModelSelection({
          model: parsed.model,
          authSource: parsed.authSource,
          connectedProviderIds: options.connectedProviderIds,
          sharedConnectedProviderIds: options.sharedConnectedProviderIds,
        });
        options.model = resolvedSelection.model;
        options.authSource = resolvedSelection.authSource;
        console.log(`Switched model to: ${formatModelSelection(resolvedSelection)}`);
      } catch (error) {
        console.log(error instanceof Error ? error.message : String(error));
        return runStep();
      }
      return runStep();
    }

    if (input === "/models") {
      await printAvailableModels(options);
      return runStep();
    }

    const attachments = pendingFiles.length ? pendingFiles : undefined;
    pendingFiles = [];

    const result = await runGeneration(client, rl, input, conversationId, options, attachments);
    if (!result) {
      return;
    }

    conversationId = result.conversationId;

    return runStep();
  };

  await runStep();
}

async function runGeneration(
  client: RouterClient<AppRouter>,
  rl: readline.Interface | null,
  content: string,
  conversationId: string | undefined,
  options: Args,
  attachments?: ChatFileAttachment[],
): Promise<{ generationId: string; conversationId: string } | null> {
  let outputStarted = false;
  const generationStartedAtMs = Date.now();
  let firstVisibleOutputAtMs: number | undefined;
  const markFirstVisibleOutput = () => {
    if (firstVisibleOutputAtMs === undefined) {
      firstVisibleOutputAtMs = Date.now();
    }
  };
  const statusTimeline: Array<{ status: string; atMs: number; elapsedMs: number }> = [];
  const runtime = createGenerationRuntime();
  const streamedSandboxFileIds = new Set<string>();
  const authHandlingInProgress = new Set<string>();
  const resolvedServerUrl = options.serverUrl || process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;
  const normalizedServerUrl = resolvedServerUrl.replace(/\/$/, "");

  try {
    const result = await runGenerationStream({
      client,
      input: {
        conversationId,
        content,
        model: options.model,
        authSource: options.authSource,
        sandboxProvider: options.sandboxProvider,
        autoApprove: options.autoApprove,
        fileAttachments: attachments?.length ? attachments : undefined,
      },
      callbacks: {
        onText: (text) => {
          markFirstVisibleOutput();
          process.stdout.write(text);
          runtime.handleText(text);
          outputStarted = true;
        },
        onThinking: (thinking) => {
          markFirstVisibleOutput();
          runtime.handleThinking(thinking);
          process.stdout.write(`\n[thinking] ${thinking.content}\n`);
        },
        onToolUse: (toolUse) => {
          const metadata = resolveCliToolMetadata(toolUse);
          runtime.handleToolUse(toolUse);
          process.stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
          if (metadata.integration) {
            process.stdout.write(`[tool_integration] ${metadata.integration}\n`);
          }
          if (typeof metadata.isWrite === "boolean") {
            process.stdout.write(`[tool_is_write] ${metadata.isWrite}\n`);
          }
          process.stdout.write(`[tool_input] ${JSON.stringify(toolUse.toolInput)}\n`);
        },
        onToolResult: (toolName, result, toolUseId) => {
          runtime.handleToolResult(toolName, result, toolUseId);
          if (toolName === "question") {
            process.stdout.write(`\n[tool_result] ${toolName} ${JSON.stringify(result)}\n`);
          } else {
            process.stdout.write(`\n[tool_result] ${toolName}\n`);
            process.stdout.write(`[tool_result_data] ${formatToolResult(result)}\n`);
          }
        },
        onPendingApproval: async (approval) => {
          runtime.handlePendingApproval(approval);
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
          if (questionItems) {
            if (options.questionAnswers.length > 0) {
              const questionAnswers = collectScriptedQuestionAnswers(
                questionItems,
                options.questionAnswers,
              );
              await client.generation.submitApproval({
                generationId: approval.generationId,
                toolUseId: approval.toolUseId,
                decision: "approve",
                questionAnswers,
              });
              process.stdout.write(
                ` -> submitted scripted question answers: ${JSON.stringify(questionAnswers)}\n`,
              );
              return;
            }

            const approvalPrompt = createApprovalPrompt(rl);
            if (!approvalPrompt) {
              process.stdout.write(
                ` -> no interactive prompt available, leaving question interrupt pending (${approval.toolUseId})\n`,
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
            return;
          }

          if (options.autoApprove) {
            process.stdout.write(" -> auto-approve\n");
            await client.generation.submitApproval({
              generationId: approval.generationId,
              toolUseId: approval.toolUseId,
              decision: "approve",
            });
            return;
          }

          const approvalPrompt = createApprovalPrompt(rl);
          if (!approvalPrompt) {
            process.stdout.write(
              ` -> no interactive prompt available, leaving interrupt pending (${approval.toolUseId})\n`,
            );
            return;
          }

          const decision = await (async () => {
            try {
              return (await ask(approvalPrompt.rl, "Approve? (y/n) ")).trim().toLowerCase();
            } finally {
              approvalPrompt.close();
            }
          })();
          await client.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: decision === "y" || decision === "yes" ? "approve" : "deny",
          });
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          process.stdout.write(`\n[approval_${decision}] ${toolUseId}\n`);
        },
        onAuthNeeded: async (auth) => {
          runtime.handleAuthNeeded(auth);
          process.stdout.write(`\n[auth_needed] ${auth.integrations.join(", ")}\n`);
          const authPrompt = createApprovalPrompt(rl);

          try {
            const handleAuthIntegration = async (index: number): Promise<void> => {
              if (index >= auth.integrations.length) {
                return;
              }

              const integration = auth.integrations[index]!;
              const dedupeKey = `${auth.generationId}:${integration}`;
              if (authHandlingInProgress.has(dedupeKey)) {
                return handleAuthIntegration(index + 1);
              }
              authHandlingInProgress.add(dedupeKey);

              if (!isAuthIntegrationType(integration)) {
                process.stdout.write(
                  `[auth_error] Unsupported integration for CLI auth flow: ${integration}\n`,
                );
                return handleAuthIntegration(index + 1);
              }

              const redirectUrl = `${normalizedServerUrl}/chat/${auth.conversationId}?auth_complete=${integration}&generation_id=${auth.generationId}`;
              const { authUrl } = await client.integration.getAuthUrl({
                type: integration,
                redirectUrl,
              });
              process.stdout.write(`[auth_url] ${integration}: ${authUrl}\n`);

              const opened = options.open ? openUrlInBrowser(authUrl) : false;
              process.stdout.write(
                opened
                  ? "[auth_action] Browser opened. Complete auth in the browser.\n"
                  : "[auth_action] Open the URL above and complete auth.\n",
              );

              if (authPrompt) {
                const confirmation = (
                  await ask(authPrompt.rl, "auth> press Enter when done (or type 'cancel'): ")
                )
                  .trim()
                  .toLowerCase();
                const allow =
                  confirmation !== "cancel" && confirmation !== "n" && confirmation !== "no";
                const submitted = await client.generation.submitAuthResult({
                  generationId: auth.generationId,
                  integration,
                  success: allow,
                });
                process.stdout.write(
                  `[auth_submit] integration=${integration} success=${submitted.success}\n`,
                );
              } else {
                process.stdout.write(
                  "[auth_action] Non-interactive mode: cannot submit auth result automatically.\n",
                );
              }
              return handleAuthIntegration(index + 1);
            };

            await handleAuthIntegration(0);
          } catch (error) {
            process.stdout.write(
              `[auth_error] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          } finally {
            authPrompt?.close();
            for (const integration of auth.integrations) {
              authHandlingInProgress.delete(`${auth.generationId}:${integration}`);
            }
          }
        },
        onAuthProgress: (connected, remaining) => {
          runtime.handleAuthProgress(connected, remaining);
          process.stdout.write(
            `\n[auth_progress] connected=${connected} remaining=${remaining.join(", ")}\n`,
          );
        },
        onAuthResult: (success) => {
          runtime.handleAuthResult(success);
          process.stdout.write(`\n[auth_result] success=${success}\n`);
        },
        onSandboxFile: (file) => {
          streamedSandboxFileIds.add(file.fileId);
          process.stdout.write(`\n[file] ${file.filename} (${file.path})\n`);
        },
        onStatusChange: (status, metadata) => {
          const now = Date.now();
          const elapsedMs = Math.max(0, now - generationStartedAtMs);
          statusTimeline.push({ status, atMs: now, elapsedMs });
          process.stdout.write(
            `\n[status] ${status} @ ${formatClockTime(now)} (+${formatDurationMs(elapsedMs)})\n`,
          );
          const metadataLine = formatStatusMetadata(metadata);
          if (metadataLine) {
            process.stdout.write(`[sandbox] ${metadataLine}\n`);
          }
        },
        onDone: async (doneGenerationId, doneConversationId, messageId, _usage, artifacts) => {
          runtime.handleDone({
            generationId: doneGenerationId,
            conversationId: doneConversationId,
            messageId,
          });
          if (artifacts?.sandboxFiles?.length) {
            for (const file of artifacts.sandboxFiles) {
              if (streamedSandboxFileIds.has(file.fileId)) {
                continue;
              }
              process.stdout.write(`\n[file] ${file.filename} (${file.path}) [from_done]\n`);
            }
          }
          if (artifacts?.timing) {
            const timing = artifacts.timing;
            process.stdout.write("\n[timing] Summary\n");
            if (timing.generationDurationMs !== undefined) {
              process.stdout.write(
                `  end_to_end_total: ${formatDurationMs(timing.generationDurationMs)}\n`,
              );
            }
            if (timing.sandboxStartupDurationMs !== undefined) {
              process.stdout.write(
                `  sandbox_connect_or_create${
                  timing.sandboxStartupMode ? ` (${timing.sandboxStartupMode})` : ""
                }: ${formatDurationMs(timing.sandboxStartupDurationMs)}\n`,
              );
            }
            const phaseDurations = timing.phaseDurationsMs;
            if (phaseDurations) {
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
                [
                  "generation_to_first_visible_output",
                  phaseDurations.generationToFirstVisibleOutputMs,
                ],
                ["model_stream", phaseDurations.modelStreamMs],
                ["post_processing", phaseDurations.postProcessingMs],
              ];
              for (const [label, value] of rows) {
                if (value === undefined) {
                  continue;
                }
                process.stdout.write(`  ${label}: ${formatDurationMs(value)}\n`);
              }
            }
            if (timing.phaseTimestamps?.length) {
              process.stdout.write("[timing] Phase timestamps\n");
              for (const entry of timing.phaseTimestamps) {
                process.stdout.write(
                  `  - ${entry.phase}: ${entry.at} (+${formatDurationMs(entry.elapsedMs)})\n`,
                );
              }
            }
          }
          if (statusTimeline.length > 0) {
            process.stdout.write("[timing] Status timeline\n");
            for (const entry of statusTimeline) {
              process.stdout.write(
                `  - ${entry.status}: ${formatClockTime(entry.atMs)} (+${formatDurationMs(entry.elapsedMs)})\n`,
              );
            }
          }
          if (firstVisibleOutputAtMs !== undefined) {
            process.stdout.write(
              `[timing] client_generation_to_first_visible_output: ${formatDurationMs(
                Math.max(0, firstVisibleOutputAtMs - generationStartedAtMs),
              )}\n`,
            );
          }
          if (outputStarted) {
            process.stdout.write("\n");
          }
          if (options.validatePersistence) {
            await validatePersistedAssistantMessage(
              client,
              doneConversationId,
              messageId,
              runtime.buildAssistantMessage(),
            );
          }
        },
        onError: (error) => {
          runtime.handleError();
          process.stdout.write(`\n[error] ${error.message}\n`);
        },
        onCancelled: () => {
          runtime.handleCancelled();
          process.stdout.write("\n[cancelled]\n");
        },
      },
    });

    if (!result) {
      throw new Error("Generation stream closed before a terminal event (done/error/cancelled)");
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRequest failed: ${message}\n`);
    return null;
  }
}

function createSingleMessagePrompt(): readline.Interface | null {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }
  return createPrompt();
}

function attachSigintHandler(rl: readline.Interface): void {
  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });
}

async function printAuthenticatedUser(client: RouterClient<AppRouter>): Promise<void> {
  try {
    const me = await client.user.me();
    console.log(`[auth] ${me.email} (${me.id})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth] failed to resolve current user: ${message}`);
  }
}

async function hydrateProviderAvailability(
  client: RouterClient<AppRouter>,
  args: Args,
): Promise<{ freeModels: Awaited<ReturnType<typeof client.providerAuth.freeModels>> }> {
  const [authStatus, freeModels] = await Promise.all([
    client.providerAuth.status(),
    client.providerAuth.freeModels(),
  ]);
  args.connectedProviderIds = Object.keys(authStatus.connected ?? {});
  args.sharedConnectedProviderIds = Object.keys(authStatus.shared ?? {});
  return { freeModels };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requestedServerUrl = args.serverUrl || process.env.APP_SERVER_URL || DEFAULT_SERVER_URL;

  if (args.resetAuth) {
    clearConfig(requestedServerUrl);
  }

  const loaded = loadConfig(requestedServerUrl);
  const serverUrl = requestedServerUrl;

  let config = loaded;
  if (args.token) {
    config = { serverUrl, token: args.token };
    saveConfig(config);
  } else if (
    !config ||
    !config.token ||
    config.serverUrl !== serverUrl ||
    args.authOnly ||
    args.resetAuth
  ) {
    config = await authenticate(serverUrl, { open: args.open });
    if (!config) {
      process.exit(1);
    }
    if (args.authOnly) {
      process.exit(0);
    }
  }

  const client = createRpcClient(serverUrl, config.token);
  let freeModels: Awaited<ReturnType<typeof client.providerAuth.freeModels>> | undefined;

  try {
    const hydrated = await hydrateProviderAvailability(client, args);
    freeModels = hydrated.freeModels;
    const overrideModel = args.model ?? process.env.BAP_CHAT_MODEL;
    if (overrideModel?.trim()) {
      const trimmedOverride = overrideModel.trim();
      parseModelReference(trimmedOverride);
      const resolvedSelection = resolveCliModelSelection({
        model: trimmedOverride,
        authSource: args.authSource,
        connectedProviderIds: args.connectedProviderIds,
        sharedConnectedProviderIds: args.sharedConnectedProviderIds,
      });
      args.model = resolvedSelection.model;
      args.authSource = resolvedSelection.authSource;
    } else {
      const defaultModel = resolveDefaultChatModel({
        isOpenAIConnected:
          (args.connectedProviderIds ?? []).includes("openai") ||
          (args.sharedConnectedProviderIds ?? []).includes("openai"),
        availableOpencodeFreeModelIDs: (freeModels?.models ?? []).map((model) => model.id),
      });
      const resolvedSelection = resolveCliModelSelection({
        model: defaultModel,
        connectedProviderIds: args.connectedProviderIds,
        sharedConnectedProviderIds: args.sharedConnectedProviderIds,
      });
      args.model = resolvedSelection.model;
      args.authSource = resolvedSelection.authSource;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(
    `[model] ${formatModelSelection({ model: args.model ?? "auto", authSource: args.authSource })}`,
  );

  await printAuthenticatedUser(client);

  if (args.listModels) {
    await printAvailableModels(args, freeModels?.models ?? undefined);
    process.exit(0);
  }

  if (args.message) {
    const interactivePrompt = createSingleMessagePrompt();
    const attachments = await Promise.all(args.files.map((f) => fileToAttachment(client, f)));
    if (interactivePrompt) {
      attachSigintHandler(interactivePrompt);
    }
    const result = await runGeneration(
      client,
      interactivePrompt,
      args.message,
      args.conversationId,
      args,
      attachments.length ? attachments : undefined,
    );
    if (result) {
      console.log(`\n[conversation] ${result.conversationId}`);
      if (interactivePrompt) {
        const followupArgs: Args = {
          ...args,
          conversationId: result.conversationId,
          message: undefined,
          files: [],
        };
        await runChatLoop(client, interactivePrompt, followupArgs);
        interactivePrompt.close();
        return;
      }
    }
    interactivePrompt?.close();
    process.exit(result ? 0 : 1);
  }

  const rl = createPrompt();
  attachSigintHandler(rl);

  await runChatLoop(client, rl, args);
  rl.close();
}

async function printAvailableModels(
  args: Pick<Args, "connectedProviderIds" | "sharedConnectedProviderIds">,
  prefetchedFreeModels?: Awaited<ReturnType<typeof listOpencodeFreeModels>>,
): Promise<void> {
  try {
    const freeModels = prefetchedFreeModels ?? (await listOpencodeFreeModels());
    console.log("Bap Models:");
    console.log("- Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6) [source=shared]");
    const sharedOpenAIAvailable = (args.sharedConnectedProviderIds ?? []).includes("openai");
    console.log(
      `- GPT-5.5 (openai/gpt-5.5) [source=shared]${sharedOpenAIAvailable ? "" : " [unavailable]"}`,
    );
    console.log(
      `- GPT-5.4 (openai/gpt-5.4) [source=shared]${sharedOpenAIAvailable ? "" : " [unavailable]"}`,
    );
    console.log(
      `- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=shared]${sharedOpenAIAvailable ? "" : " [unavailable]"}`,
    );
    const sharedGoogleAvailable = (args.sharedConnectedProviderIds ?? []).includes("google");
    console.log(
      `- Gemini 3.1 Pro Preview (google/gemini-3.1-pro-preview) [source=shared]${sharedGoogleAvailable ? "" : " [unavailable]"}`,
    );

    const userOpenAIAvailable = (args.connectedProviderIds ?? []).includes("openai");
    console.log("\nYour AI Accounts:");
    if (userOpenAIAvailable) {
      console.log("- GPT-5.5 (openai/gpt-5.5) [source=user]");
      console.log("- GPT-5.4 (openai/gpt-5.4) [source=user]");
      console.log("- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=user]");
    } else {
      console.log("- ChatGPT not connected [source=user]");
    }

    if (freeModels.length > 0) {
      console.log(`\nFree OpenCode Models (${freeModels.length}):`);
      for (const model of freeModels) {
        console.log(`- ${model.name} (${model.id})`);
      }
    }
  } catch (error) {
    console.error(
      `Failed to list models: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

void main();
