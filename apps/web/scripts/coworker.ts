import type { RouterClient } from "@orpc/server";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import { buildCoworkerEditApplyEnvelope } from "@cmdclaw/core/lib/coworker-runtime-cli";
import { coworkerBuilderEditSchema } from "@cmdclaw/core/server/services/coworker-builder-service";
import { db, closePool } from "@cmdclaw/db/client";
import { conversation, coworkerRun } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import readline from "node:readline";
import { ZodError } from "zod";
import type { AppRouter } from "@/server/orpc";
import { runGenerationStream } from "@/lib/generation-stream";
import { formatPersistedChatTranscript } from "../src/components/chat/chat-transcript";
import { DEFAULT_SERVER_URL, ask, createRpcClient, loadConfig } from "./lib/cli-shared";
import {
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "./lib/question-approval";
import { resolveCliToolMetadata } from "./lib/tool-metadata";

type ParsedArgs = {
  serverUrl?: string;
  command?: string;
  positionals: string[];
  message?: string;
  list?: boolean;
  json?: boolean;
  format?: "text" | "markdown" | "json";
  // Generic command flags
  payload?: string;
  userInput?: string;
  watch: boolean;
  debug: boolean;
  watchIntervalSeconds: number;
  limit?: number;
  // Create flags
  name?: string;
  triggerType?: string;
  prompt?: string;
  promptDo?: string;
  promptDont?: string;
  integrations?: string[];
  customIntegrations?: string[];
  autoApprove?: boolean;
  scheduleType?: string;
  scheduleInterval?: number;
  scheduleTime?: string;
  scheduleDays?: number[];
  scheduleDayOfMonth?: number;
  model?: string;
  baseUpdatedAt?: string;
  changesFile?: string;
  filePath?: string;
  description?: string;
};

type CoworkerIntegrationType =
  | "google_gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "dynamics"
  | "reddit"
  | "twitter";

const integrationTypes = new Set<CoworkerIntegrationType>([
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
]);

type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "error", "success", "failed"]);
const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    positionals: [],
    watch: false,
    debug: false,
    watchIntervalSeconds: 2,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--payload":
      case "-P":
        args.payload = argv[i + 1];
        i += 1;
        break;
      case "--user-input":
        args.userInput = argv[i + 1];
        i += 1;
        break;
      case "--watch":
        args.watch = true;
        break;
      case "--debug":
        args.debug = true;
        break;
      case "--watch-interval": {
        const parsed = Number(argv[i + 1]);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--watch-interval must be a positive number of seconds");
        }
        args.watchIntervalSeconds = parsed;
        i += 1;
        break;
      }
      case "--limit": {
        const parsed = Number(argv[i + 1]);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error("--limit must be a positive integer");
        }
        args.limit = parsed;
        i += 1;
        break;
      }
      case "--name":
      case "-n":
        args.name = argv[i + 1];
        i += 1;
        break;
      case "--trigger":
      case "-t":
        args.triggerType = argv[i + 1];
        i += 1;
        break;
      case "--prompt":
      case "-p":
        args.prompt = argv[i + 1];
        i += 1;
        break;
      case "--prompt-do":
        args.promptDo = argv[i + 1];
        i += 1;
        break;
      case "--prompt-dont":
        args.promptDont = argv[i + 1];
        i += 1;
        break;
      case "--integrations":
      case "-i":
        args.integrations = splitCsv(argv[i + 1]);
        i += 1;
        break;
      case "--custom-integrations":
        args.customIntegrations = splitCsv(argv[i + 1]);
        i += 1;
        break;
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--no-auto-approve":
        args.autoApprove = false;
        break;
      case "--schedule-type":
        args.scheduleType = argv[i + 1];
        i += 1;
        break;
      case "--schedule-interval":
        args.scheduleInterval = Number(argv[i + 1]);
        i += 1;
        break;
      case "--schedule-time":
        args.scheduleTime = argv[i + 1];
        i += 1;
        break;
      case "--schedule-days":
        args.scheduleDays = splitCsv(argv[i + 1]).map(Number);
        i += 1;
        break;
      case "--schedule-day-of-month":
        args.scheduleDayOfMonth = Number(argv[i + 1]);
        i += 1;
        break;
      case "--message":
      case "-m":
      case "--goal":
      case "--instruction":
        args.message = argv[i + 1];
        i += 1;
        break;
      case "--format": {
        const format = argv[i + 1];
        if (format !== "text" && format !== "markdown" && format !== "json") {
          throw new Error("--format must be one of: text, markdown, json");
        }
        args.format = format;
        i += 1;
        break;
      }
      case "--model":
      case "-M":
        args.model = argv[i + 1];
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--json":
        args.json = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--base-updated-at":
        args.baseUpdatedAt = argv[i + 1];
        i += 1;
        break;
      case "--changes-file":
        args.changesFile = argv[i + 1];
        i += 1;
        break;
      case "--file":
        args.filePath = argv[i + 1];
        i += 1;
        break;
      case "--description":
        args.description = argv[i + 1];
        i += 1;
        break;
      default:
        if (arg?.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`);
        }

        if (!args.command) {
          args.command = arg;
        } else {
          args.positionals.push(arg);
        }
    }
  }

  return args;
}

function splitCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

function inferMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".html":
    case ".htm":
      return "text/html";
    case ".csv":
      return "text/csv";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    on: "[ON]",
    off: "[OFF]",
    running: "[RUNNING]",
    completed: "[DONE]",
    success: "[DONE]",
    failed: "[FAILED]",
    error: "[ERROR]",
    cancelled: "[CANCELLED]",
    awaiting_approval: "[AWAITING APPROVAL]",
    awaiting_auth: "[AWAITING AUTH]",
    needs_user_input: "[NEEDS YOUR INPUT]",
  };
  return badges[status] ?? `[${status.toUpperCase()}]`;
}

function isCoworkerIntegrationType(value: string): value is CoworkerIntegrationType {
  return integrationTypes.has(value as CoworkerIntegrationType);
}

function parsePayload(payload: string | undefined): unknown {
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid JSON for --payload");
  }
}

function buildSchedule(args: ParsedArgs): CoworkerSchedule | undefined {
  if (!args.scheduleType) {
    return undefined;
  }

  switch (args.scheduleType) {
    case "interval": {
      const intervalMinutes = args.scheduleInterval ?? 60;
      if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
        throw new Error("--schedule-interval must be a positive integer (minutes)");
      }
      return { type: "interval", intervalMinutes };
    }
    case "daily":
      return { type: "daily", time: args.scheduleTime ?? "09:00" };
    case "weekly": {
      const days = args.scheduleDays ?? [1];
      if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
        throw new Error("--schedule-days must be comma-separated integers between 0 and 6");
      }
      return { type: "weekly", time: args.scheduleTime ?? "09:00", daysOfWeek: days };
    }
    case "monthly": {
      const dayOfMonth = args.scheduleDayOfMonth ?? 1;
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error("--schedule-day-of-month must be an integer between 1 and 31");
      }
      return {
        type: "monthly",
        time: args.scheduleTime ?? "09:00",
        dayOfMonth,
      };
    }
    default:
      throw new Error("--schedule-type must be one of: interval, daily, weekly, monthly");
  }
}

function printHelp(): void {
  console.log("\nUsage: bun run coworker --message <text> [options]");
  console.log("   or: bun run coworker [options] <command>\n");
  console.log("Options:");
  console.log("  -s, --server <url>                Server URL (default http://localhost:3000)");
  console.log(
    "  -m, --message <text>              Build/update a coworker from one message (default mode)",
  );
  console.log("  --list                            List coworkers (shortcut)");
  console.log("  --json                            Emit JSON for supported commands");
  console.log("  -M, --model <provider/model>      Optional model override for builder agent");
  console.log("  -h, --help                        Show help");
  console.log("\nCommands:");
  console.log("  list                              List coworkers");
  console.log("  create                            Create coworker (flags below)");
  console.log("  edit <coworker-id|@username>      Save coworker edits");
  console.log(
    "  upload-document <coworker-id|@username> Upload a persistent document for future runs",
  );
  console.log("  show <coworker-id|@username>      Show full coworker details");
  console.log("  run <coworker-id|@username>       Trigger a coworker run");
  console.log("  logs <run-id>                     Show run events and transcript");
  console.log("  approve <run-id> <tool-use-id> <approve|deny>  Submit pending approval");
  console.log(
    "  builder <coworker-id|@username>     Run coworker builder agent on an existing coworker",
  );
  console.log(
    "  close-loop                          Create a draft coworker and let builder agent configure it",
  );
  console.log("  close-loop-example                  Example: hourly post in #bap-experiments");
  console.log("\nAliases:");
  console.log("  trigger <coworker-id|@username>   Alias of run");
  console.log("  show-run <run-id>                 Alias of logs");
  console.log("  runs <coworker-id|@username>      List recent runs for a coworker");
  console.log("\nRun flags:");
  console.log("  -P, --payload <json>              JSON payload for run/trigger");
  console.log(
    "  --user-input <text>               Trusted first user input for coworkers that need it",
  );
  console.log("  --watch                           Poll until run reaches terminal status");
  console.log(
    "  --debug                           Trigger a fresh run and tail run, transcript, and final DB state",
  );
  console.log("  --watch-interval <seconds>        Polling interval for --watch (default 2)");
  console.log("\nLogs/Runs flags:");
  console.log(
    "  --limit <n>                       Limit run list size for runs command (default 20)",
  );
  console.log("  --watch                           Poll run logs until terminal status");
  console.log("\nShow flags:");
  console.log("  --format <text|markdown|json>     Output format for show (default text)");
  console.log("\nCreate flags:");
  console.log("  -n, --name <name>                 Coworker name (required)");
  console.log("  -t, --trigger <type>              Trigger type (required)");
  console.log("  -p, --prompt <instructions>       Agent instructions (required)");
  console.log("  --prompt-do <text>                Optional DO guidance");
  console.log("  --prompt-dont <text>              Optional DON'T guidance");
  console.log("  -i, --integrations <csv>          Allowed integrations");
  console.log("  --custom-integrations <csv>       Allowed custom integration names");
  console.log("  --auto-approve                    Enable auto-approval");
  console.log("  --no-auto-approve                 Disable auto-approval");
  console.log("  --schedule-type <type>            interval | daily | weekly | monthly");
  console.log("  --schedule-interval <minutes>     Used by interval schedules");
  console.log("  --schedule-time <HH:MM>           Used by daily/weekly/monthly schedules");
  console.log("  --schedule-days <0,1,..6>         Used by weekly schedules");
  console.log("  --schedule-day-of-month <1-31>    Used by monthly schedules\n");
  console.log("Builder flags:");
  console.log("  --message <text>                  Natural-language coworker objective");
  console.log("  -M, --model <provider/model>      Optional generation model override");
  console.log("\nEdit flags:");
  console.log("  --base-updated-at <iso>           Required optimistic concurrency timestamp");
  console.log("  --changes-file <path>             Read JSON edit payload from a file");
  console.log("\nUpload Document flags:");
  console.log("  --file <path>                     Local file path to upload");
  console.log("  --description <text>              Optional document notes");
  console.log("\nExample:");
  console.log('  bun run coworker --message "send message in #bap-experiments every hour"\n');
}

type CoworkerDetails = {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  autoApprove: boolean;
  model: string;
  authSource: string | null;
  triggerType: string;
  prompt: string;
  promptDo: string | null;
  promptDont: string | null;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
  toolAccessMode: string;
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  allowedSkillSlugs: string[];
  schedule: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  runs: Array<{
    id: string;
    status: string;
    startedAt: Date | string;
    finishedAt: Date | string | null;
    errorMessage: string | null;
  }>;
};

function printCoworkerSummary(coworker: {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  status: string;
  triggerType: string;
  schedule?: unknown;
  lastRunStatus?: string | null;
  lastRunAt?: Date | string | null;
}): void {
  const displayName = coworker.name.trim() || "(unnamed)";
  const lastRun = coworker.lastRunStatus
    ? ` | last run: ${statusBadge(coworker.lastRunStatus)} ${formatDate(coworker.lastRunAt)}`
    : "";

  console.log(`${statusBadge(coworker.status)} ${displayName}`);
  console.log(`  id: ${coworker.id}`);
  console.log(`  username: ${coworker.username ? `@${coworker.username}` : "-"}`);
  console.log(`  description: ${coworker.description ?? "-"}`);
  console.log(`  trigger: ${coworker.triggerType}${lastRun}`);
  if (coworker.schedule) {
    console.log(`  schedule: ${JSON.stringify(coworker.schedule)}`);
  }
  console.log("");
}

function formatCoworkerDetailsMarkdown(details: CoworkerDetails): string {
  const lines = [
    `# ${details.name.trim() || "Unnamed Coworker"}`,
    "",
    `- ID: \`${details.id}\``,
    `- Status: ${details.status}`,
    `- Username: ${details.username ? `@${details.username}` : "-"}`,
    `- Description: ${details.description ?? "-"}`,
    `- Trigger: ${details.triggerType}`,
    `- Tool Access Mode: ${details.toolAccessMode}`,
    `- Auto Approve: ${details.autoApprove ? "yes" : "no"}`,
    `- Needs User Input: ${details.requiresUserInput ? "yes" : "no"}`,
    `- Created: ${formatDate(details.createdAt)}`,
    `- Updated: ${formatDate(details.updatedAt)}`,
    `- Allowed Integrations: ${details.allowedIntegrations.join(", ") || "-"}`,
    `- Custom Integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`,
    `- Allowed Skills: ${details.allowedSkillSlugs.join(", ") || "-"}`,
    "",
    "## Prompt",
    "",
    details.prompt || "(empty)",
  ];

  if (details.promptDo) {
    lines.push("", "## Prompt Do", "", details.promptDo);
  }
  if (details.promptDont) {
    lines.push("", "## Prompt Don't", "", details.promptDont);
  }
  if (details.userInputPrompt) {
    lines.push("", "## User Input Prompt", "", details.userInputPrompt);
  }
  if (details.schedule) {
    lines.push("", "## Schedule", "", "```json", JSON.stringify(details.schedule, null, 2), "```");
  }
  if (details.runs.length > 0) {
    lines.push("", "## Recent Runs", "");
    for (const run of details.runs) {
      lines.push(
        `- \`${run.id}\` ${statusBadge(run.status)} started ${formatDate(run.startedAt)}${run.finishedAt ? `, finished ${formatDate(run.finishedAt)}` : ""}${run.errorMessage ? `, error: ${run.errorMessage}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

function printCoworkerDetails(
  details: CoworkerDetails,
  format: ParsedArgs["format"] = "text",
): void {
  if (format === "json") {
    console.log(JSON.stringify(details, null, 2));
    return;
  }

  if (format === "markdown") {
    console.log(formatCoworkerDetailsMarkdown(details));
    return;
  }

  console.log(`${statusBadge(details.status)} ${details.name.trim() || "(unnamed)"}`);
  console.log(`  id: ${details.id}`);
  console.log(`  username: ${details.username ? `@${details.username}` : "-"}`);
  console.log(`  description: ${details.description ?? "-"}`);
  console.log(`  trigger: ${details.triggerType}`);
  console.log(`  model: ${details.model}`);
  console.log(`  auth source: ${details.authSource ?? "-"}`);
  console.log(`  tool access: ${details.toolAccessMode}`);
  console.log(`  auto approve: ${details.autoApprove ? "yes" : "no"}`);
  console.log(`  needs user input: ${details.requiresUserInput ? "yes" : "no"}`);
  if (details.userInputPrompt) {
    console.log(`  user input prompt: ${details.userInputPrompt}`);
  }
  console.log(`  created: ${formatDate(details.createdAt)}`);
  console.log(`  updated: ${formatDate(details.updatedAt)}`);
  console.log(`  allowed integrations: ${details.allowedIntegrations.join(", ") || "-"}`);
  console.log(`  custom integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`);
  console.log(`  allowed skills: ${details.allowedSkillSlugs.join(", ") || "-"}`);
  console.log(`  prompt: ${details.prompt || "(empty)"}`);
  if (details.promptDo) {
    console.log(`  prompt do: ${details.promptDo}`);
  }
  if (details.promptDont) {
    console.log(`  prompt don't: ${details.promptDont}`);
  }
  if (details.schedule) {
    console.log(`  schedule: ${JSON.stringify(details.schedule)}`);
  }
  if (details.runs.length > 0) {
    console.log("  recent runs:");
    for (const run of details.runs) {
      const finishedAt = run.finishedAt ? ` | finished ${formatDate(run.finishedAt)}` : "";
      const errorMessage = run.errorMessage ? ` | error: ${run.errorMessage}` : "";
      console.log(
        `    - ${statusBadge(run.status)} ${run.id} | started ${formatDate(run.startedAt)}${finishedAt}${errorMessage}`,
      );
    }
  }
}

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
    promptDo: args.promptDo,
    promptDont: args.promptDont,
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
  const result = await client.coworker.trigger({
    id: coworkerId,
    payload,
    trustedUserInput:
      trustedUserInput && trustedUserInput.length > 0 ? trustedUserInput : undefined,
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

type DebugControl = {
  stopRequested: boolean;
  cleanupStarted: boolean;
  signalCount: number;
};

type ContentPartLike =
  | {
      type?: unknown;
      id?: unknown;
      name?: unknown;
      input?: unknown;
      tool_use_id?: unknown;
      text?: unknown;
      content?: unknown;
    }
  | Record<string, unknown>;

function printPrefixedBlock(prefix: string, content: string): void {
  for (const line of content.split("\n")) {
    console.log(`${prefix} ${line}`);
  }
}

function printDebugCoworkerSnapshot(details: CoworkerDetails): void {
  console.log("[debug] Current coworker definition");
  console.log(`[debug] id: ${details.id}`);
  console.log(`[debug] name: ${details.name}`);
  console.log(`[debug] updated: ${formatDate(details.updatedAt)}`);
  console.log(`[debug] trigger: ${details.triggerType}`);
  console.log(`[debug] model: ${details.model}`);
  console.log(`[debug] auth source: ${details.authSource ?? "-"}`);
  console.log(`[debug] auto approve: ${details.autoApprove ? "yes" : "no"}`);
  console.log(`[debug] tool access: ${details.toolAccessMode}`);
  console.log(`[debug] allowed integrations: ${details.allowedIntegrations.join(", ") || "-"}`);
  console.log(
    `[debug] custom integrations: ${details.allowedCustomIntegrations.join(", ") || "-"}`,
  );
  console.log(`[debug] allowed skills: ${details.allowedSkillSlugs.join(", ") || "-"}`);
  console.log("[debug] prompt:");
  printPrefixedBlock("[debug]", details.prompt || "(empty)");
  if (details.promptDo) {
    console.log("[debug] prompt do:");
    printPrefixedBlock("[debug]", details.promptDo);
  }
  if (details.promptDont) {
    console.log("[debug] prompt don't:");
    printPrefixedBlock("[debug]", details.promptDont);
  }
  console.log("");
}

function createDebugControl(): {
  control: DebugControl;
  dispose: () => void;
} {
  const control: DebugControl = {
    stopRequested: false,
    cleanupStarted: false,
    signalCount: 0,
  };

  const onInterrupt = () => {
    control.signalCount += 1;
    if (control.signalCount === 1) {
      control.stopRequested = true;
      console.log(
        "\n[debug] Interrupt received, stopping live tail and printing final DB snapshot...",
      );
      return;
    }
    if (control.cleanupStarted) {
      console.log("\n[debug] Second interrupt received during cleanup, exiting immediately.");
      process.exit(130);
    }
  };

  process.on("SIGINT", onInterrupt);

  return {
    control,
    dispose: () => {
      process.off("SIGINT", onInterrupt);
    },
  };
}

function summarizeFinalContentParts(parts: unknown[] | null | undefined): Array<string> {
  const items = Array.isArray(parts) ? (parts as ContentPartLike[]) : [];
  const pickLast = (predicate: (part: ContentPartLike) => boolean) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const part = items[index];
      if (predicate(part)) {
        return part;
      }
    }
    return null;
  };

  const summaries: Array<string> = [];
  const lastToolUse = pickLast((part) => part.type === "tool_use");
  if (lastToolUse) {
    summaries.push(
      `last tool_use: ${String(lastToolUse.name ?? "unknown")} ${JSON.stringify(lastToolUse.input ?? {})}`,
    );
  }
  const lastToolResult = pickLast((part) => part.type === "tool_result");
  if (lastToolResult) {
    summaries.push(`last tool_result: ${String(lastToolResult.content ?? "")}`);
  }
  const lastText = pickLast((part) => part.type === "text");
  if (lastText) {
    summaries.push(`last text: ${String(lastText.text ?? "")}`);
  }
  return summaries;
}

async function printFinalDbSnapshot(runId: string): Promise<void> {
  try {
    const run = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.id, runId),
      with: { generation: true },
    });
    if (!run) {
      console.warn(`[db] Run ${runId} not found.`);
      return;
    }

    const linkedConversation = run.generation?.conversationId
      ? await db.query.conversation.findFirst({
          where: eq(conversation.id, run.generation.conversationId),
        })
      : null;

    console.log("");
    console.log("[db] Final persisted snapshot");
    console.log(`[db] run.id: ${run.id}`);
    console.log(`[db] run.status: ${run.status}`);
    console.log(`[db] run.startedAt: ${formatDate(run.startedAt)}`);
    console.log(`[db] run.finishedAt: ${formatDate(run.finishedAt)}`);
    console.log(`[db] run.errorMessage: ${run.errorMessage ?? "-"}`);
    console.log(`[db] run.triggerPayload: ${JSON.stringify(run.triggerPayload ?? {})}`);

    if (run.generation) {
      console.log(`[db] generation.id: ${run.generation.id}`);
      console.log(`[db] generation.status: ${run.generation.status}`);
      console.log(`[db] generation.completedAt: ${formatDate(run.generation.completedAt)}`);
      console.log(`[db] generation.errorMessage: ${run.generation.errorMessage ?? "-"}`);
      console.log(
        `[db] generation.pendingApproval: ${run.generation.pendingApproval ? "present" : "null"}`,
      );
      console.log(
        `[db] generation.pendingAuth: ${run.generation.pendingAuth ? "present" : "null"}`,
      );
      console.log(`[db] generation.sandboxId: ${run.generation.sandboxId ?? "-"}`);
      console.log(`[db] generation.sandboxProvider: ${run.generation.sandboxProvider ?? "-"}`);
      console.log(`[db] generation.runtimeHarness: ${run.generation.runtimeHarness ?? "-"}`);
      console.log(
        `[db] generation.runtimeProtocolVersion: ${run.generation.runtimeProtocolVersion ?? "-"}`,
      );
      const partSummaries = summarizeFinalContentParts(run.generation.contentParts);
      if (partSummaries.length > 0) {
        for (const summary of partSummaries) {
          printPrefixedBlock("[db]", summary);
        }
      }
    } else {
      console.log("[db] generation: -");
    }

    if (linkedConversation) {
      console.log(`[db] conversation.id: ${linkedConversation.id}`);
      console.log(`[db] conversation.generationStatus: ${linkedConversation.generationStatus}`);
      console.log(
        `[db] conversation.currentGenerationId: ${linkedConversation.currentGenerationId ?? "-"}`,
      );
      console.log(`[db] conversation.updatedAt: ${formatDate(linkedConversation.updatedAt)}`);
    } else {
      console.log("[db] conversation: -");
    }
  } catch (error) {
    console.warn(
      `[db] Failed to load final snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function debugCoworkerRun(
  client: RouterClient<AppRouter>,
  params: {
    coworkerId: string;
    runId: string;
    generationId: string;
    conversationId: string;
  },
  watchIntervalSeconds: number,
): Promise<void> {
  const { runId } = params;
  const seenEventIds = new Set<string>();
  let previousStatus = "";
  let lastTranscript = "";
  const { control, dispose } = createDebugControl();

  try {
    while (!control.stopRequested) {
      // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
      const run = await client.coworker.getRun({ id: runId });

      if (run.status !== previousStatus) {
        console.log(`[run] status: ${previousStatus || "-"} -> ${run.status}`);
        console.log(`[run] started: ${formatDate(run.startedAt)}`);
        if (run.finishedAt) {
          console.log(`[run] finished: ${formatDate(run.finishedAt)}`);
        }
        if (run.errorMessage) {
          printPrefixedBlock("[run]", `error: ${run.errorMessage}`);
        }
        previousStatus = run.status;
      }

      const unseenEvents = run.events.filter((event) => !seenEventIds.has(event.id));
      for (const event of unseenEvents) {
        seenEventIds.add(event.id);
        console.log(`[run] event ${event.type} @ ${formatDate(event.createdAt)}`);
        printPrefixedBlock("[run]", JSON.stringify(event.payload, null, 2));
      }

      if (run.conversationId) {
        try {
          // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
          const runConversation = await client.conversation.get({ id: run.conversationId });
          const transcript = formatConversationTranscript(runConversation.messages);
          if (transcript && transcript !== lastTranscript) {
            const label = lastTranscript ? "updated transcript" : "transcript";
            console.log(`[transcript] ${label}`);
            printPrefixedBlock("[transcript]", transcript);
            lastTranscript = transcript;
          }
        } catch (error) {
          console.error(
            `[transcript] Failed to load transcript: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (TERMINAL_STATUSES.has(run.status)) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- polling loop waits between sequential fetches
      await sleep(watchIntervalSeconds * 1000);
    }
  } finally {
    dispose();
  }

  control.cleanupStarted = true;
  await printFinalDbSnapshot(runId);
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

function formatConversationTranscript(
  messages: Array<{
    id: string;
    role: string;
    content: string;
    contentParts: unknown[] | null;
    attachments: Array<{ filename: string; mimeType: string }>;
    sandboxFiles: Array<{ path: string; filename: string; mimeType: string; fileId: string }>;
  }>,
): string {
  const transcriptMessages = messages.map((message) => ({
    ...message,
    contentParts: message.contentParts ?? undefined,
  })) as Parameters<typeof formatPersistedChatTranscript>[0];

  return formatPersistedChatTranscript(transcriptMessages);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

  const serverUrl = parsed.serverUrl || process.env.CMDCLAW_SERVER_URL || DEFAULT_SERVER_URL;
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
