import { env } from "@bap/core/env";
import { getCliEnvForUser } from "@bap/core/server/integrations/cli-env";
import {
  getRemoteIntegrationCredentials,
  searchRemoteIntegrationUsers,
} from "@bap/core/server/integrations/remote-integrations";
import { SANDBOX_SKILLS_ROOT } from "@bap/sandbox/paths";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DEFAULT_SERVER_URL, createRpcClient, loadConfig } from "./lib/cli-shared";

type ToolSpec = {
  scriptPath: string;
  requiredEnv: string[];
};

type ParsedArgs = {
  serverUrl: string;
  toolName?: string;
  toolArgs: string[];
  remoteIntegrationEnv?: "staging" | "prod";
  remoteIntegrationUserId?: string;
  remoteIntegrationUserEmail?: string;
};

const SKILLS_ROOT = SANDBOX_SKILLS_ROOT;

const TOOL_ENV_REQUIREMENTS: Record<string, string[]> = {
  airtable: ["AIRTABLE_ACCESS_TOKEN"],
  discord: ["DISCORD_BOT_TOKEN"],
  dynamics: ["DYNAMICS_ACCESS_TOKEN", "DYNAMICS_INSTANCE_URL"],
  github: ["GITHUB_ACCESS_TOKEN"],
  "google-calendar": ["GOOGLE_CALENDAR_ACCESS_TOKEN"],
  "google-docs": ["GOOGLE_DOCS_ACCESS_TOKEN"],
  "google-drive": ["GOOGLE_DRIVE_ACCESS_TOKEN"],
  "google-gmail": ["GMAIL_ACCESS_TOKEN"],
  "google-sheets": ["GOOGLE_SHEETS_ACCESS_TOKEN"],
  hubspot: ["HUBSPOT_ACCESS_TOKEN"],
  linkedin: ["UNIPILE_API_KEY", "UNIPILE_DSN", "LINKEDIN_ACCOUNT_ID"],
  notion: ["NOTION_ACCESS_TOKEN"],
  "outlook-calendar": ["OUTLOOK_CALENDAR_ACCESS_TOKEN"],
  "outlook-mail": ["OUTLOOK_ACCESS_TOKEN"],
  salesforce: ["SALESFORCE_ACCESS_TOKEN", "SALESFORCE_INSTANCE_URL"],
  slack: ["SLACK_ACCESS_TOKEN"],
};

const TOOL_INTEGRATION_TYPES: Partial<Record<string, string>> = {
  airtable: "airtable",
  dynamics: "dynamics",
  github: "github",
  "google-calendar": "google_calendar",
  "google-docs": "google_docs",
  "google-drive": "google_drive",
  "google-gmail": "google_gmail",
  "google-sheets": "google_sheets",
  hubspot: "hubspot",
  notion: "notion",
  "outlook-calendar": "outlook_calendar",
  "outlook-mail": "outlook",
  salesforce: "salesforce",
  slack: "slack",
};

const TOOL_SPECS = Object.fromEntries(
  Object.entries(TOOL_ENV_REQUIREMENTS).map(([toolName, requiredEnv]) => [
    toolName,
    {
      scriptPath: resolve(SKILLS_ROOT, toolName, "src", `${toolName}.ts`),
      requiredEnv,
    } satisfies ToolSpec,
  ]),
) satisfies Record<string, ToolSpec>;

function isHelpRequest(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printHelp(): void {
  console.log("\nUsage: bun run tool <tool-name> [--server <url>] [tool args]\n");
  console.log("Available tools:");
  for (const toolName of Object.keys(TOOL_SPECS)) {
    console.log(`  - ${toolName}`);
  }
  console.log("\nExamples:");
  console.log("  bun run tool google-gmail --help");
  console.log('  bun run tool google-gmail search -q "is:unread" -l 5');
  console.log(
    "  bun run tool --remote-integration-env prod --remote-integration-user-email user@example.com outlook-mail list -l 5",
  );
  console.log('  bun run tool linkedin profile get "acme-user"\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    serverUrl: process.env.APP_SERVER_URL || DEFAULT_SERVER_URL,
    toolArgs: [],
  };

  let toolCaptured = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if ((arg === "--help" || arg === "-h") && !toolCaptured) {
      printHelp();
      process.exit(0);
    }

    if ((arg === "--server" || arg === "-s") && !toolCaptured) {
      parsed.serverUrl = argv[i + 1] || parsed.serverUrl;
      i += 1;
      continue;
    }

    if (arg === "--remote-integration-env" && !toolCaptured) {
      const targetEnv = argv[i + 1];
      if (targetEnv !== "staging" && targetEnv !== "prod") {
        throw new Error("--remote-integration-env must be one of: staging, prod");
      }
      parsed.remoteIntegrationEnv = targetEnv;
      i += 1;
      continue;
    }

    if (arg === "--remote-integration-user-id" && !toolCaptured) {
      parsed.remoteIntegrationUserId = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--remote-integration-user-email" && !toolCaptured) {
      parsed.remoteIntegrationUserEmail = argv[i + 1];
      i += 1;
      continue;
    }

    if (!toolCaptured && !arg.startsWith("-")) {
      parsed.toolName = arg;
      toolCaptured = true;
      continue;
    }

    if (toolCaptured) {
      parsed.toolArgs.push(arg);
      continue;
    }

    console.error(`Unknown flag: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return parsed;
}

async function resolveRemoteIntegrationSource(parsed: ParsedArgs): Promise<
  | {
      targetEnv: "staging" | "prod";
      remoteUserId: string;
      remoteUserEmail?: string | null;
    }
  | undefined
> {
  const hasRemoteSourceInput = Boolean(
    parsed.remoteIntegrationEnv ||
    parsed.remoteIntegrationUserId ||
    parsed.remoteIntegrationUserEmail,
  );
  if (!hasRemoteSourceInput) {
    return undefined;
  }
  if (!parsed.remoteIntegrationEnv) {
    throw new Error("--remote-integration-env is required when using remote integrations");
  }
  if (parsed.remoteIntegrationUserId && parsed.remoteIntegrationUserEmail) {
    throw new Error(
      "Use only one of --remote-integration-user-id or --remote-integration-user-email",
    );
  }
  if (parsed.remoteIntegrationUserId) {
    return {
      targetEnv: parsed.remoteIntegrationEnv,
      remoteUserId: parsed.remoteIntegrationUserId,
    };
  }
  if (!parsed.remoteIntegrationUserEmail) {
    throw new Error(
      "Remote integrations require --remote-integration-user-id or --remote-integration-user-email",
    );
  }

  const result = await searchRemoteIntegrationUsers({
    targetEnv: parsed.remoteIntegrationEnv,
    query: parsed.remoteIntegrationUserEmail,
    limit: 10,
  });
  const normalizedEmail = parsed.remoteIntegrationUserEmail.trim().toLowerCase();
  const exactMatch = result.find((entry) => entry.email.toLowerCase() === normalizedEmail);
  if (!exactMatch) {
    const candidates = result.map((entry) => `${entry.email} (${entry.id})`).join(", ");
    throw new Error(
      `Remote integration user ${parsed.remoteIntegrationUserEmail} was not found in ${parsed.remoteIntegrationEnv}.${candidates ? ` Candidates: ${candidates}` : ""}`,
    );
  }

  return {
    targetEnv: parsed.remoteIntegrationEnv,
    remoteUserId: exactMatch.id,
    remoteUserEmail: exactMatch.email,
  };
}

async function resolveCliEnv(
  parsed: ParsedArgs,
): Promise<{ cliEnv: Record<string, string>; userId: string }> {
  const { serverUrl } = parsed;
  const config = loadConfig(serverUrl);
  if (!config?.token) {
    throw new Error(
      `Missing CLI auth token for ${serverUrl}. Run: bun run bap -- auth login --server ${serverUrl}`,
    );
  }

  const client = createRpcClient(serverUrl, config.token);
  const me = await client.user.me();
  if (!me?.id) {
    throw new Error("Could not resolve authenticated user from CLI token.");
  }

  const remoteIntegrationSource = await resolveRemoteIntegrationSource(parsed);
  if (remoteIntegrationSource) {
    const integrationType = parsed.toolName ? TOOL_INTEGRATION_TYPES[parsed.toolName] : undefined;
    if (!integrationType) {
      throw new Error(`Remote integrations are not supported for ${parsed.toolName}`);
    }
    const credentials = await getRemoteIntegrationCredentials({
      targetEnv: remoteIntegrationSource.targetEnv,
      remoteUserId: remoteIntegrationSource.remoteUserId,
      integrationTypes: [integrationType as never],
      requestedByUserId: me.id,
      requestedByEmail: me.email ?? null,
    });
    return {
      userId: me.id,
      cliEnv: {
        ...credentials.tokens,
        BAP_REMOTE_INTEGRATION_SOURCE: JSON.stringify({
          ...remoteIntegrationSource,
          requestedByUserId: me.id,
          requestedByEmail: me.email ?? null,
          remoteUserEmail: remoteIntegrationSource.remoteUserEmail ?? credentials.remoteUserEmail,
        }),
        BAP_RUNTIME_CREDENTIALS_URL: `${serverUrl.replace(/\/$/, "")}/api/internal/mcp/runtime-credentials`,
        APP_SERVER_SECRET: env.APP_SERVER_SECRET || "",
        BAP_USER_ID: me.id,
      },
    };
  }

  return { userId: me.id, cliEnv: await getCliEnvForUser(me.id) };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const toolName = parsed.toolName?.toLowerCase();

  if (!toolName) {
    printHelp();
    process.exit(1);
  }

  const spec = TOOL_SPECS[toolName];
  if (!spec) {
    console.error(`Unknown tool: ${toolName}`);
    printHelp();
    process.exit(1);
  }

  const toolHelpRequested = isHelpRequest(parsed.toolArgs);
  let cliEnv: Record<string, string> = {};

  if (!toolHelpRequested) {
    cliEnv = (await resolveCliEnv(parsed)).cliEnv;

    const missingEnv = spec.requiredEnv.filter((key) => !cliEnv[key]);
    if (missingEnv.length > 0) {
      throw new Error(
        `${toolName} is not fully configured for this user. Missing: ${missingEnv.join(", ")}`,
      );
    }
  }

  const child = spawn("bun", [spec.scriptPath, ...parsed.toolArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...cliEnv,
      APP_SERVER_URL: parsed.serverUrl,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`Failed to start ${toolName}: ${error.message}`);
    process.exit(1);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tool] ${message}`);
  process.exit(1);
});
