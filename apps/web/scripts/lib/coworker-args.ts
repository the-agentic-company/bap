import { splitCsv } from "./coworker-format";

export type ParsedArgs = {
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
  remoteIntegrationEnv?: "staging" | "prod";
  remoteIntegrationUserId?: string;
  remoteIntegrationUserEmail?: string;
  limit?: number;
  // Create flags
  name?: string;
  triggerType?: string;
  prompt?: string;
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

export type CoworkerIntegrationType =
  | "google_gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "outlook"
  | "outlook_calendar"
  | "notion"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "dynamics";

const integrationTypes = new Set<CoworkerIntegrationType>([
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "outlook",
  "outlook_calendar",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
]);

export type CoworkerSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

export function isCoworkerIntegrationType(value: string): value is CoworkerIntegrationType {
  return integrationTypes.has(value as CoworkerIntegrationType);
}

export function parseArgs(argv: string[]): ParsedArgs {
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
      case "--remote-integration-env": {
        const targetEnv = argv[i + 1];
        if (targetEnv !== "staging" && targetEnv !== "prod") {
          throw new Error("--remote-integration-env must be one of: staging, prod");
        }
        args.remoteIntegrationEnv = targetEnv;
        i += 1;
        break;
      }
      case "--remote-integration-user-id":
        args.remoteIntegrationUserId = argv[i + 1];
        i += 1;
        break;
      case "--remote-integration-user-email":
        args.remoteIntegrationUserEmail = argv[i + 1];
        i += 1;
        break;
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

export function buildSchedule(args: ParsedArgs): CoworkerSchedule | undefined {
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

export function printHelp(): void {
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
  console.log(
    "  --remote-integration-env <env>    Borrow remote integrations from staging or prod",
  );
  console.log("  --remote-integration-user-id <id> Remote user id for borrowed integrations");
  console.log(
    "  --remote-integration-user-email <email> Resolve remote user by email before running",
  );
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
