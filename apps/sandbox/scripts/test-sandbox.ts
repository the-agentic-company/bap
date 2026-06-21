#!/usr/bin/env bun
/**
 * Interactive E2B sandbox helper.
 *
 * Usage:
 *   bun run e2b:sandbox
 *   bun run e2b:sandbox -- --workspace-slug <workspace-slug>
 *   bun run e2b:sandbox -- --sandbox-id <sandbox-id>
 *   bun run e2b:sandbox -- --conversation-id <conversation-id>
 *   bun run e2b:sandbox -- --run-id <coworker-run-id>
 *   bun run e2b:sandbox -- --builder-coworker-id <coworker-id>
 *
 * Create mode automatically loads integration tokens from the database for the configured user.
 * Attach mode reconnects to an existing E2B sandbox without creating a new one.
 */

import { closePool, db } from "@bap/db/client";
import * as schema from "@bap/db/schema";
import * as dotenvConfig from "dotenv/config";
import { and, eq } from "drizzle-orm";
import { Sandbox } from "e2b";
import { createInterface } from "readline";

void dotenvConfig;

const TEMPLATE_NAME = process.env.E2B_DAYTONA_SANDBOX_NAME || "bap-agent-dev";
const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_CREATE_USER_EMAIL =
  process.env.BAP_DEFAULT_USER_EMAIL?.trim() || "bap@example.com";
export const DEFAULT_CREATE_WORKSPACE_SLUG = "concentrix-c1e27b8c";

type IntegrationType = "google_gmail" | "slack" | "notion" | "github" | "airtable";

export type ParsedArgs = {
  sandboxId?: string;
  conversationId?: string;
  runId?: string;
  builderCoworkerId?: string;
  userEmail: string;
  workspaceSlug: string;
  help: boolean;
};

type SandboxSource = "new" | "sandbox_id" | "conversation_id" | "run_id" | "builder_coworker_id";

type ExistingSandboxTarget = {
  sandboxId: string;
  conversationId: string | null;
  sessionId: string | null;
  runtimeId: string | null;
  sandboxProvider: string | null;
  model: string | null;
  source: SandboxSource;
  sourceId: string;
  workspaceId?: string | null;
  workspaceSlug?: string | null;
  workspaceName?: string | null;
};

type CreateWorkspaceTarget = {
  id: string;
  slug: string | null;
  name: string;
};

type CreateUserContext = {
  id: string;
  integrationEnvs: Record<string, string>;
};

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  google_gmail: "GMAIL_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s (${ms}ms)`;
}

function escapeShell(value: string): string {
  return `"${value.replace(/["$`\\]/g, "\\$&")}"`;
}

function shouldUsePty(cmd: string): boolean {
  const firstToken = cmd.trim().split(/\s+/)[0]?.toLowerCase();
  return firstToken === "opencode" || firstToken === "claude";
}

function normalizeInteractiveCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstToken === "opencode") {
    return `OPENCODE_CONFIG=/app/opencode.json OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true ${trimmed}`;
  }
  return trimmed;
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    userEmail: DEFAULT_CREATE_USER_EMAIL,
    workspaceSlug: DEFAULT_CREATE_WORKSPACE_SLUG,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--sandbox-id":
        args.sandboxId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--conversation-id":
        args.conversationId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--run-id":
        args.runId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--builder-coworker-id":
        args.builderCoworkerId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--user-email":
        args.userEmail = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--workspace-slug":
        args.workspaceSlug = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const attachSelectors = [
    args.sandboxId,
    args.conversationId,
    args.runId,
    args.builderCoworkerId,
  ].filter((value): value is string => Boolean(value));

  if (attachSelectors.length > 1) {
    throw new Error(
      "Use only one attach selector: --sandbox-id, --conversation-id, --run-id, or --builder-coworker-id.",
    );
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage:
  bun run e2b:sandbox
  bun run e2b:sandbox -- --workspace-slug <workspace-slug>
  bun run e2b:sandbox -- --sandbox-id <sandbox-id>
  bun run e2b:sandbox -- --conversation-id <conversation-id>
  bun run e2b:sandbox -- --run-id <coworker-run-id>
  bun run e2b:sandbox -- --builder-coworker-id <coworker-id>

Options:
  --workspace-slug <slug>     Workspace slug to bootstrap in create mode
  --sandbox-id <id>            Attach directly to an existing E2B sandbox
  --conversation-id <id>       Attach via a chat or coworker conversation runtime
  --run-id <id>                Attach via a coworker run
  --builder-coworker-id <id>   Attach via a coworker builder conversation
  --user-email <email>         User email for create mode token injection
  --help                       Show this help
`);
}

function isAttachMode(args: ParsedArgs): boolean {
  return Boolean(args.sandboxId || args.conversationId || args.runId || args.builderCoworkerId);
}

async function connectSandboxById(sandboxId: string): Promise<Sandbox> {
  const sandboxApi = Sandbox as unknown as {
    connect?: (
      id: string,
      options?: {
        timeoutMs?: number;
      },
    ) => Promise<Sandbox>;
  };

  if (!sandboxApi.connect) {
    throw new Error("Sandbox.connect is not available in this E2B SDK version.");
  }

  const sandbox = await sandboxApi.connect(sandboxId, {
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  const timeoutApi = sandbox as Sandbox & {
    setTimeout?: (timeoutMs: number) => Promise<unknown>;
  };
  if (typeof timeoutApi.setTimeout === "function") {
    await timeoutApi.setTimeout(SANDBOX_TIMEOUT_MS);
  }

  return sandbox;
}

async function runInteractiveCommandWithPty(sandbox: Sandbox, cmd: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[warn] PTY mode requires a TTY; falling back to non-interactive command mode.");
    const result = await sandbox.commands.run(cmd, {
      timeoutMs: 60 * 60 * 1000,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  let stdinRawEnabled = false;
  let stdinCarry = new Uint8Array();

  const ptyHandle = await sandbox.pty.create({
    cols,
    rows,
    cwd: "/app",
    timeoutMs: 60 * 60 * 1000,
    envs: {
      COLORTERM: "truecolor",
    },
    onData: (data) => {
      process.stdout.write(Buffer.from(data));
    },
  });

  const filterProbeResponses = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdinCarry.length + chunk.length);
    merged.set(stdinCarry);
    merged.set(chunk, stdinCarry.length);
    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];

      if (b === 0x1b && i + 1 < merged.length) {
        const next = merged[i + 1];

        if (next === 0x5d) {
          let j = i + 2;
          while (
            j < merged.length &&
            merged[j] !== 0x07 &&
            !(merged[j] === 0x1b && j + 1 < merged.length && merged[j + 1] === 0x5c)
          ) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const oscPayload = decoder.decode(merged.slice(i + 2, j));
          const isOscTerminatedBySt = merged[j] === 0x1b;
          const end = isOscTerminatedBySt ? j + 1 : j;

          if (/^1[01];rgb:/i.test(oscPayload)) {
            i = end + 1;
            continue;
          }

          for (let k = i; k <= end; k += 1) {
            out.push(merged[k]);
          }
          i = end + 1;
          continue;
        }

        if (next === 0x5b) {
          let j = i + 2;
          while (j < merged.length && (merged[j] < 0x40 || merged[j] > 0x7e)) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const finalByte = merged[j];
          const csiBody = decoder.decode(merged.slice(i + 2, j));

          if (finalByte === 0x79 && csiBody.startsWith("?") && csiBody.includes("$")) {
            i = j + 1;
            continue;
          }

          for (let k = i; k <= j; k += 1) {
            out.push(merged[k]);
          }
          i = j + 1;
          continue;
        }
      }

      out.push(b);
      i += 1;
    }

    stdinCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const stdinHandler = (chunk: Buffer | string) => {
    if (typeof chunk === "string") {
      if (/(?:^|])11;rgb:[0-9a-f/]+/i.test(chunk) || /\?\d+(?:;\d+)*\$[a-z]/i.test(chunk)) {
        return;
      }
    }

    const rawInput = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);
    const filteredInput = filterProbeResponses(rawInput);
    if (filteredInput.length === 0) {
      return;
    }
    sandbox.pty.sendInput(ptyHandle.pid, filteredInput).catch(() => {});
  };

  const resizeHandler = () => {
    const nextCols = process.stdout.columns ?? cols;
    const nextRows = process.stdout.rows ?? rows;
    sandbox.pty.resize(ptyHandle.pid, { cols: nextCols, rows: nextRows }).catch(() => {});
  };

  try {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      stdinRawEnabled = true;
    }
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.stdout.on("resize", resizeHandler);

    const normalizedCommand = normalizeInteractiveCommand(cmd);
    await sandbox.pty.sendInput(ptyHandle.pid, encoder.encode(`exec env ${normalizedCommand}\n`));
    const result = await ptyHandle.wait();
    return result.exitCode;
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    return 1;
  } finally {
    process.stdin.off("data", stdinHandler);
    process.stdout.off("resize", resizeHandler);
    if (stdinRawEnabled && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  }
}

async function getCreateUserContext(userEmail: string): Promise<CreateUserContext> {
  const [foundUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, userEmail))
    .limit(1);

  if (!foundUser) {
    throw new Error(`User not found: ${userEmail}`);
  }

  const results = await db
    .select({
      type: schema.integration.type,
      accessToken: schema.integrationToken.accessToken,
    })
    .from(schema.integration)
    .innerJoin(
      schema.integrationToken,
      eq(schema.integration.id, schema.integrationToken.integrationId),
    )
    .where(and(eq(schema.integration.userId, foundUser.id), eq(schema.integration.enabled, true)));

  const envVars: Record<string, string> = {};
  for (const row of results) {
    const envVar = ENV_VAR_MAP[row.type as IntegrationType];
    if (envVar) {
      envVars[envVar] = row.accessToken;
    }
  }

  return {
    id: foundUser.id,
    integrationEnvs: envVars,
  };
}

async function resolveCreateWorkspace(workspaceSlug: string): Promise<CreateWorkspaceTarget> {
  const normalizedWorkspaceSlug = workspaceSlug.trim();

  if (!normalizedWorkspaceSlug) {
    throw new Error(
      "Workspace slug is required for create mode. Pass --workspace-slug <slug> or set DEFAULT_CREATE_WORKSPACE_SLUG in scripts/test-sandbox.ts.",
    );
  }

  const workspace = await db.query.workspace.findFirst({
    where: eq(schema.workspace.slug, normalizedWorkspaceSlug),
    columns: {
      id: true,
      slug: true,
      name: true,
    },
  });

  if (!workspace) {
    throw new Error(`Workspace not found for slug: ${normalizedWorkspaceSlug}`);
  }

  if (!workspace.slug) {
    throw new Error(`Workspace ${workspace.id} (${workspace.name}) does not have a slug.`);
  }

  return workspace;
}

async function getRuntimeTargetByConversationId(
  conversationId: string,
): Promise<ExistingSandboxTarget | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(schema.conversationRuntime.conversationId, conversationId),
    columns: {
      id: true,
      sandboxId: true,
      sessionId: true,
      sandboxProvider: true,
    },
  });

  if (!runtime?.sandboxId) {
    return null;
  }

  const convo = await db.query.conversation.findFirst({
    where: eq(schema.conversation.id, conversationId),
    columns: {
      model: true,
    },
  });

  return {
    sandboxId: runtime.sandboxId,
    conversationId,
    sessionId: runtime.sessionId,
    runtimeId: runtime.id,
    sandboxProvider: runtime.sandboxProvider,
    model: convo?.model ?? null,
    source: "conversation_id",
    sourceId: conversationId,
  };
}

async function getRuntimeTargetBySandboxId(
  sandboxId: string,
): Promise<ExistingSandboxTarget | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(schema.conversationRuntime.sandboxId, sandboxId),
    columns: {
      id: true,
      conversationId: true,
      sandboxId: true,
      sessionId: true,
      sandboxProvider: true,
    },
  });

  if (!runtime?.sandboxId) {
    return null;
  }

  const convo = await db.query.conversation.findFirst({
    where: eq(schema.conversation.id, runtime.conversationId),
    columns: {
      model: true,
    },
  });

  return {
    sandboxId: runtime.sandboxId,
    conversationId: runtime.conversationId,
    sessionId: runtime.sessionId,
    runtimeId: runtime.id,
    sandboxProvider: runtime.sandboxProvider,
    model: convo?.model ?? null,
    source: "sandbox_id",
    sourceId: sandboxId,
  };
}

async function resolveAttachTarget(args: ParsedArgs): Promise<ExistingSandboxTarget> {
  if (args.sandboxId) {
    if (!process.env.DATABASE_URL) {
      return {
        sandboxId: args.sandboxId,
        conversationId: null,
        sessionId: null,
        runtimeId: null,
        sandboxProvider: "e2b",
        model: null,
        source: "sandbox_id",
        sourceId: args.sandboxId,
      };
    }

    return (
      (await getRuntimeTargetBySandboxId(args.sandboxId)) ?? {
        sandboxId: args.sandboxId,
        conversationId: null,
        sessionId: null,
        runtimeId: null,
        sandboxProvider: "e2b",
        model: null,
        source: "sandbox_id",
        sourceId: args.sandboxId,
      }
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL environment variable required when resolving sandbox by conversation, run, or builder.",
    );
  }

  if (args.conversationId) {
    const target = await getRuntimeTargetByConversationId(args.conversationId);
    if (!target) {
      throw new Error(`No active sandbox runtime found for conversation ${args.conversationId}.`);
    }
    return target;
  }

  if (args.runId) {
    const run = await db.query.coworkerRun.findFirst({
      where: eq(schema.coworkerRun.id, args.runId),
      columns: {
        generationId: true,
      },
    });

    if (!run?.generationId) {
      throw new Error(`Coworker run ${args.runId} does not have a generation to attach to.`);
    }

    const generation = await db.query.generation.findFirst({
      where: eq(schema.generation.id, run.generationId),
      columns: {
        conversationId: true,
      },
    });

    if (!generation?.conversationId) {
      throw new Error(`Coworker run ${args.runId} has no linked conversation.`);
    }

    const target = await getRuntimeTargetByConversationId(generation.conversationId);
    if (!target) {
      throw new Error(`No active sandbox runtime found for coworker run ${args.runId}.`);
    }

    return {
      ...target,
      source: "run_id",
      sourceId: args.runId,
    };
  }

  if (args.builderCoworkerId) {
    const coworker = await db.query.coworker.findFirst({
      where: eq(schema.coworker.id, args.builderCoworkerId),
      columns: {
        builderConversationId: true,
      },
    });

    if (!coworker?.builderConversationId) {
      throw new Error(
        `Coworker ${args.builderCoworkerId} does not have a builder conversation to attach to.`,
      );
    }

    const target = await getRuntimeTargetByConversationId(coworker.builderConversationId);
    if (!target) {
      throw new Error(
        `No active sandbox runtime found for builder coworker ${args.builderCoworkerId}.`,
      );
    }

    return {
      ...target,
      source: "builder_coworker_id",
      sourceId: args.builderCoworkerId,
    };
  }

  throw new Error("No attach target provided.");
}

function assertE2BTarget(target: ExistingSandboxTarget): void {
  if (target.sandboxProvider && target.sandboxProvider !== "e2b") {
    throw new Error(
      `Sandbox ${target.sandboxId} is using provider "${target.sandboxProvider}", not "e2b".`,
    );
  }
}

function printSandboxInfo(target: ExistingSandboxTarget, mode: "create" | "attach"): void {
  console.log("");
  console.log(mode === "create" ? "Sandbox ready:" : "Attached to sandbox:");
  console.log(`  sandboxId: ${target.sandboxId}`);
  console.log(`  source: ${target.source} (${target.sourceId})`);
  console.log(`  conversationId: ${target.conversationId ?? "<unknown>"}`);
  console.log(`  runtimeId: ${target.runtimeId ?? "<unknown>"}`);
  console.log(`  sessionId: ${target.sessionId ?? "<unknown>"}`);
  console.log(`  provider: ${target.sandboxProvider ?? "e2b"}`);
  console.log(`  model: ${target.model ?? "<unknown>"}`);
  if (target.workspaceId) {
    console.log(`  workspaceId: ${target.workspaceId}`);
    console.log(`  workspaceSlug: ${target.workspaceSlug ?? "<unknown>"}`);
    console.log(`  workspaceName: ${target.workspaceName ?? "<unknown>"}`);
  }
}

function printPublicAccessInfo(sandbox: Sandbox): void {
  console.log(`  public services: https://<port>-${sandbox.sandboxId}.${sandbox.sandboxDomain}/`);
  console.log("  note: bind your debug server to 0.0.0.0:<port> inside the sandbox");
}

async function startRepl(
  sandbox: Sandbox,
  target: ExistingSandboxTarget,
  mode: "create" | "attach",
): Promise<void> {
  const makeReadline = () =>
    createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  let rl = makeReadline();
  let shuttingDown = false;

  const shutdown = async (action: "detach" | "kill"): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    rl.close();

    try {
      if (action === "kill") {
        console.log("\nKilling sandbox...");
        await sandbox.kill();
      } else {
        console.log("\nDetaching from sandbox...");
      }
    } finally {
      await closePool().catch(() => undefined);
      console.log("Goodbye!");
      process.exit(0);
    }
  };

  const prompt = () => {
    rl.question("sandbox> ", async (input) => {
      const cmd = input.trim();

      if (!cmd) {
        prompt();
        return;
      }

      if (cmd === "exit" || cmd === "quit") {
        await shutdown(mode === "create" ? "kill" : "detach");
        return;
      }

      if (cmd === "help") {
        console.log(`
Commands:
  <any bash command>   - Run command in sandbox
  google-gmail <cmd>   - Gmail CLI (list, get, unread, send)
  slack <cmd>          - Slack CLI (channels, history, send, search, users)
  claude -p <prompt>   - Run Claude Code
  info                 - Show resolved sandbox metadata
  env                  - Show environment variables
  kill                 - Kill sandbox and exit
  exit/quit            - ${mode === "create" ? "Kill sandbox and exit" : "Detach and exit"}
`);
        prompt();
        return;
      }

      if (cmd === "info") {
        printSandboxInfo(target, mode);
        printPublicAccessInfo(sandbox);
        prompt();
        return;
      }

      if (cmd === "kill") {
        await shutdown("kill");
        return;
      }

      try {
        if (shouldUsePty(cmd)) {
          rl.close();
          const exitCode = await runInteractiveCommandWithPty(sandbox, cmd);
          rl = makeReadline();
          if (exitCode !== 0) {
            console.log(`\n[Exit code: ${exitCode}]`);
          }
        } else {
          const result = await sandbox.commands.run(cmd, {
            timeoutMs: 60000,
            onStdout: (data) => {
              process.stdout.write(data);
            },
            onStderr: (data) => {
              process.stderr.write(data);
            },
          });

          if (result.exitCode !== 0) {
            console.log(`\n[Exit code: ${result.exitCode}]`);
          }
        }
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
      }

      prompt();
    });
  };

  console.log('Type "help" for available commands, "exit" to quit.\n');
  prompt();

  process.on("SIGINT", async () => {
    await shutdown(mode === "create" ? "kill" : "detach");
  });
}

function printAvailableCommands(): void {
  console.log("\nAvailable CLI commands in sandbox:");
  console.log("  google-gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  claude -p <prompt>          - Run Claude Code\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY environment variable required");
  }

  if (isAttachMode(args)) {
    const target = await resolveAttachTarget(args);
    assertE2BTarget(target);
    await closePool().catch(() => undefined);

    console.log(`Connecting to existing sandbox ${target.sandboxId}...`);
    const sandbox = await connectSandboxById(target.sandboxId);
    console.log(`✓ Connected to sandbox: ${sandbox.sandboxId}`);
    printSandboxInfo(target, "attach");
    printPublicAccessInfo(sandbox);
    printAvailableCommands();
    await startRepl(sandbox, target, "attach");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable required");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable required");
  }

  console.log(`Resolving workspace slug ${args.workspaceSlug}...`);
  const workspace = await resolveCreateWorkspace(args.workspaceSlug);

  console.log(`Loading integration tokens for ${args.userEmail}...`);
  const userContext = await getCreateUserContext(args.userEmail);
  const envs: Record<string, string> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ...userContext.integrationEnvs,
  };

  if (userContext.integrationEnvs.GMAIL_ACCESS_TOKEN) {
    console.log("✓ Google Gmail integration enabled");
  } else {
    console.log("○ Google Gmail integration not found in database");
  }

  if (userContext.integrationEnvs.SLACK_ACCESS_TOKEN) {
    console.log("✓ Slack integration enabled");
  } else {
    console.log("○ Slack integration not found in database");
  }

  if (userContext.integrationEnvs.NOTION_ACCESS_TOKEN) {
    console.log("✓ Notion integration enabled");
  }

  if (userContext.integrationEnvs.GITHUB_ACCESS_TOKEN) {
    console.log("✓ GitHub integration enabled");
  }

  if (userContext.integrationEnvs.AIRTABLE_ACCESS_TOKEN) {
    console.log("✓ Airtable integration enabled");
  }

  console.log(`✓ Using workspace: ${workspace.name} (${workspace.slug})`);
  console.log(`\nCreating sandbox from template: ${TEMPLATE_NAME}...`);

  const bootStart = Date.now();
  const sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });
  const bootDurationMs = Date.now() - bootStart;

  const target: ExistingSandboxTarget = {
    sandboxId: sandbox.sandboxId,
    conversationId: null,
    sessionId: null,
    runtimeId: null,
    sandboxProvider: "e2b",
    model: null,
    source: "new",
    sourceId: TEMPLATE_NAME,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
  };

  console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);
  console.log(`✓ Sandbox boot time: ${formatDuration(bootDurationMs)}`);
  await closePool().catch(() => undefined);
  printSandboxInfo(target, "create");
  printPublicAccessInfo(sandbox);
  printAvailableCommands();
  await startRepl(sandbox, target, "create");
}

if (import.meta.main) {
  main().catch(async (error) => {
    await closePool().catch(() => undefined);
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
