#!/usr/bin/env bun
/**
 * Interactive Daytona sandbox helper.
 *
 * Usage:
 *   bun run daytona:sandbox
 *   bun run daytona:sandbox -- --workspace-slug <workspace-slug>
 *   bun run daytona:sandbox -- --sandbox-id <sandbox-id>
 *   bun run daytona:sandbox -- --conversation-id <conversation-id>
 *   bun run daytona:sandbox -- --run-id <coworker-run-id>
 *   bun run daytona:sandbox -- --builder-coworker-id <coworker-id>
 *
 * Create mode automatically loads integration tokens from the database for the configured user.
 * Attach mode reconnects to an existing Daytona sandbox without creating a new one.
 */

import { closePool, db } from "@cmdclaw/db/client";
import * as schema from "@cmdclaw/db/schema";
import { Daytona } from "@daytonaio/sdk";
import * as dotenvConfig from "dotenv/config";
import { and, eq } from "drizzle-orm";
import { createInterface } from "readline";

void dotenvConfig;

const SNAPSHOT_NAME =
  process.env.E2B_DAYTONA_SANDBOX_NAME ||
  process.env.DAYTONA_SNAPSHOT ||
  process.env.DAYTONA_SNAPSHOT_DEV ||
  "bap-agent-dev";
const DEFAULT_WORKDIR = "/app";
const COMMAND_TIMEOUT_MS = 60 * 1000;
const START_TIMEOUT_SECONDS = 60;
export const DEFAULT_CREATE_USER_EMAIL =
  process.env.CMDCLAW_DEFAULT_USER_EMAIL?.trim() || "cmdclaw@example.com";
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

type DaytonaClientConfig = {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
};

type DaytonaProcessResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
  artifacts?: {
    stdout?: string;
    stderr?: string;
  };
};

type DaytonaPtyHandle = {
  waitForConnection: () => Promise<void>;
  sendInput: (data: string | Uint8Array) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<unknown>;
  wait: () => Promise<{ exitCode?: number; error?: string }>;
  disconnect: () => Promise<void>;
};

type DaytonaSandbox = {
  id: string;
  name?: string;
  state?: string;
  start?: () => Promise<void>;
  waitUntilStarted?: (timeoutSeconds?: number) => Promise<void>;
  delete: () => Promise<void>;
  getPreviewLink?: (port: number) => Promise<{ url: string; token?: string }>;
  getSignedPreviewUrl?: (
    port: number,
    expiresInSeconds?: number,
  ) => Promise<{ url: string; token?: string }>;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<DaytonaProcessResult>;
    createPty?: (options: {
      id: string;
      cwd?: string;
      envs?: Record<string, string>;
      cols?: number;
      rows?: number;
      onData: (data: Uint8Array) => void | Promise<void>;
    }) => Promise<DaytonaPtyHandle>;
  };
  fs: {
    uploadFile: (source: Buffer, destination: string, timeout?: number) => Promise<void>;
    downloadFile: (path: string, timeout?: number) => Promise<Buffer | string | Uint8Array>;
  };
};

type DaytonaSandboxRecord = Awaited<ReturnType<Daytona["get"]>>;

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
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shouldUsePty(cmd: string): boolean {
  const firstToken = cmd.trim().split(/\s+/)[0]?.toLowerCase();
  return firstToken === "opencode" || firstToken === "claude";
}

function normalizeInteractiveCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstToken === "opencode") {
    return `OPENCODE_CONFIG=/app/opencode.json ${trimmed}`;
  }
  return trimmed;
}

function buildPtyEnvs(): Record<string, string> {
  const termFromHost = process.env.TERM;
  const safeTerm =
    !termFromHost || termFromHost === "dumb" || termFromHost === "unknown"
      ? "xterm-256color"
      : termFromHost;

  const envs: Record<string, string> = {
    TERM: safeTerm,
    COLORTERM: process.env.COLORTERM || "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
  };

  if (process.env.TERM_PROGRAM) {
    envs.TERM_PROGRAM = process.env.TERM_PROGRAM;
  }
  if (process.env.TERM_PROGRAM_VERSION) {
    envs.TERM_PROGRAM_VERSION = process.env.TERM_PROGRAM_VERSION;
  }

  return envs;
}

function getCommandStdout(result: DaytonaProcessResult): string {
  return result.stdout ?? result.result ?? result.artifacts?.stdout ?? "";
}

function getCommandStderr(result: DaytonaProcessResult): string {
  return result.stderr ?? result.artifacts?.stderr ?? "";
}

function isDaytonaNoAvailableRunnersError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.includes("No available runners");
}

async function listDaytonaSandboxes(
  daytona: Daytona,
): Promise<DaytonaSandboxRecord[]> {
  const sandboxes: DaytonaSandboxRecord[] = [];
  for await (const sandbox of daytona.list({ limit: 100 })) {
    sandboxes.push(sandbox);
  }
  return sandboxes;
}

async function enrichCreateError(daytona: Daytona, error: unknown): Promise<Error> {
  if (!isDaytonaNoAvailableRunnersError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  try {
    const sandboxes = await listDaytonaSandboxes(daytona);
    const started = sandboxes.filter((sandbox) => sandbox.state === "started");
    if (started.length === 0) {
      return new Error(
        'Daytona reported "No available runners". No started sandboxes were found to attach to.',
      );
    }

    const examples = started
      .slice(0, 5)
      .map((sandbox) => `- ${sandbox.id} (${sandbox.name ?? sandbox.id})`)
      .join("\n");

    return new Error(
      `Daytona reported "No available runners". Attach to an existing sandbox instead, for example:\n` +
        `${examples}\n` +
        `Use: bun run daytona:sandbox -- --sandbox-id <sandbox-id>`,
    );
  } catch {
    return new Error(
      'Daytona reported "No available runners". Try attaching to an existing sandbox with `bun run daytona:sandbox -- --sandbox-id <sandbox-id>`.',
    );
  }
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
  bun run daytona:sandbox
  bun run daytona:sandbox -- --workspace-slug <workspace-slug>
  bun run daytona:sandbox -- --sandbox-id <sandbox-id>
  bun run daytona:sandbox -- --conversation-id <conversation-id>
  bun run daytona:sandbox -- --run-id <coworker-run-id>
  bun run daytona:sandbox -- --builder-coworker-id <coworker-id>

Options:
  --workspace-slug <slug>     Workspace slug to bootstrap in create mode
  --sandbox-id <id>           Attach directly to an existing Daytona sandbox
  --conversation-id <id>      Attach via a chat or coworker conversation runtime
  --run-id <id>               Attach via a coworker run
  --builder-coworker-id <id>  Attach via a coworker builder conversation
  --user-email <email>        User email for create mode token injection
  --help                      Show this help
`);
}

function isAttachMode(args: ParsedArgs): boolean {
  return Boolean(args.sandboxId || args.conversationId || args.runId || args.builderCoworkerId);
}

function getDaytonaConfig(): DaytonaClientConfig {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      "Missing Daytona auth. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.",
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

async function connectSandboxById(sandboxId: string): Promise<DaytonaSandbox> {
  const daytona = new Daytona(getDaytonaConfig());
  const sandbox = (await daytona.get(sandboxId)) as DaytonaSandbox;

  if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start?.();
    await sandbox.waitUntilStarted?.(START_TIMEOUT_SECONDS);
  }

  return sandbox;
}

async function runInteractiveCommandWithPty(sandbox: DaytonaSandbox, cmd: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[warn] PTY mode requires a TTY; cannot run interactive command.");
    return 1;
  }

  if (!sandbox.process.createPty) {
    throw new Error("This Daytona sandbox does not expose process.createPty().");
  }

  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let stdinRawEnabled = false;
  let stdinCarry = new Uint8Array();
  let stdoutCarry = new Uint8Array();

  const filterTerminalQueriesFromOutput = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdoutCarry.length + chunk.length);
    merged.set(stdoutCarry);
    merged.set(chunk, stdoutCarry.length);

    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];
      if (b !== 0x1b || i + 1 >= merged.length) {
        out.push(b);
        i += 1;
        continue;
      }

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
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const payload = decoder.decode(merged.slice(i + 2, j));
        const isStTerminated = merged[j] === 0x1b;
        const end = isStTerminated ? j + 1 : j;
        if (/^1[01];\?/i.test(payload)) {
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
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const finalByte = merged[j];
        const body = decoder.decode(merged.slice(i + 2, j));
        const isCsiQuery =
          (finalByte === 0x70 && body.startsWith("?") && body.includes("$")) ||
          ((finalByte === 0x6e || finalByte === 0x74 || finalByte === 0x75 || finalByte === 0x71) &&
            /^[?>]?[0-9;]*\$?[a-z]?$/i.test(body));
        if (isCsiQuery) {
          i = j + 1;
          continue;
        }

        for (let k = i; k <= j; k += 1) {
          out.push(merged[k]);
        }
        i = j + 1;
        continue;
      }

      out.push(b);
      i += 1;
    }

    stdoutCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const pty = await sandbox.process.createPty({
    id: `cmdclaw-${Date.now()}`,
    cwd: DEFAULT_WORKDIR,
    envs: buildPtyEnvs(),
    cols,
    rows,
    onData: (data) => {
      const filtered = filterTerminalQueriesFromOutput(data);
      if (filtered.length > 0) {
        process.stdout.write(Buffer.from(filtered));
      }
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
    pty.sendInput(filteredInput).catch(() => {});
  };

  const resizeHandler = () => {
    const nextCols = process.stdout.columns ?? cols;
    const nextRows = process.stdout.rows ?? rows;
    pty.resize(nextCols, nextRows).catch(() => {});
  };

  try {
    await pty.waitForConnection();

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      stdinRawEnabled = true;
    }
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.stdout.on("resize", resizeHandler);

    const normalizedCommand = normalizeInteractiveCommand(cmd);
    await pty.sendInput(encoder.encode(`exec env ${normalizedCommand}\n`));
    const result = await pty.wait();
    return result.exitCode ?? 0;
  } finally {
    process.stdin.off("data", stdinHandler);
    process.stdout.off("resize", resizeHandler);
    if (stdinRawEnabled && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    await pty.disconnect().catch(() => undefined);
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
      "Workspace slug is required for create mode. Pass --workspace-slug <slug> or set DEFAULT_CREATE_WORKSPACE_SLUG in scripts/daytona-sandbox.ts.",
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
        sandboxProvider: "daytona",
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
        sandboxProvider: "daytona",
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

function assertDaytonaTarget(target: ExistingSandboxTarget): void {
  if (target.sandboxProvider && target.sandboxProvider !== "daytona") {
    throw new Error(
      `Sandbox ${target.sandboxId} is using provider "${target.sandboxProvider}", not "daytona".`,
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
  console.log(`  provider: ${target.sandboxProvider ?? "daytona"}`);
  console.log(`  model: ${target.model ?? "<unknown>"}`);
  if (target.workspaceId) {
    console.log(`  workspaceId: ${target.workspaceId}`);
    console.log(`  workspaceSlug: ${target.workspaceSlug ?? "<unknown>"}`);
    console.log(`  workspaceName: ${target.workspaceName ?? "<unknown>"}`);
  }
}

async function printPublicAccessInfo(sandbox: DaytonaSandbox): Promise<void> {
  if (!sandbox.getPreviewLink && !sandbox.getSignedPreviewUrl) {
    console.log("  public services: preview links are not available on this Daytona sandbox");
    return;
  }

  console.log("  public services: use Daytona preview links for any server you start manually");
  console.log("  note: bind your debug server to 0.0.0.0:<port> inside the sandbox");
}

async function startRepl(
  sandbox: DaytonaSandbox,
  target: ExistingSandboxTarget,
  mode: "create" | "attach",
): Promise<void> {
  let readlineClosed = false;
  const makeReadline = () => {
    const next = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readlineClosed = false;
    next.on("close", () => {
      readlineClosed = true;
    });
    return next;
  };
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
        await sandbox.delete();
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
    if (shuttingDown || readlineClosed) {
      return;
    }

    try {
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
  opencode             - Run OpenCode interactive CLI
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
        await printPublicAccessInfo(sandbox);
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
          const result = await sandbox.process.executeCommand(
            cmd,
            DEFAULT_WORKDIR,
            undefined,
            Math.max(1, Math.ceil(COMMAND_TIMEOUT_MS / 1000)),
          );

          const stdout = getCommandStdout(result);
          const stderr = getCommandStderr(result);

          if (stdout) {
            process.stdout.write(stdout);
            if (!stdout.endsWith("\n")) {
              process.stdout.write("\n");
            }
          }

          if (stderr) {
            process.stderr.write(stderr);
            if (!stderr.endsWith("\n")) {
              process.stderr.write("\n");
            }
          }

          if ((result.exitCode ?? 0) !== 0) {
            console.log(`\n[Exit code: ${result.exitCode}]`);
          }
        }
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
      }

      prompt();
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!shuttingDown && message.includes("readline was closed")) {
        void shutdown(mode === "create" ? "kill" : "detach");
        return;
      }
      throw error;
    }
  };

  console.log('Type "help" for available commands, "exit" to quit.\n');
  prompt();

  process.stdin.on("end", () => {
    void shutdown(mode === "create" ? "kill" : "detach");
  });

  process.on("SIGINT", async () => {
    await shutdown(mode === "create" ? "kill" : "detach");
  });
}

function printAvailableCommands(): void {
  console.log("\nAvailable CLI commands in sandbox:");
  console.log("  google-gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  opencode                        - Run OpenCode interactive CLI");
  console.log("  claude -p <prompt>             - Run Claude Code\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  getDaytonaConfig();

  if (isAttachMode(args)) {
    const target = await resolveAttachTarget(args);
    assertDaytonaTarget(target);
    await closePool().catch(() => undefined);

    console.log(`Connecting to existing sandbox ${target.sandboxId}...`);
    const sandbox = await connectSandboxById(target.sandboxId);
    console.log(`✓ Connected to sandbox: ${sandbox.id}`);
    printSandboxInfo(target, "attach");
    await printPublicAccessInfo(sandbox);
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
  const envVars: Record<string, string> = {
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
  console.log(`\nCreating Daytona sandbox from snapshot: ${SNAPSHOT_NAME}...`);

  const daytona = new Daytona(getDaytonaConfig());
  const bootStart = Date.now();
  let sandbox: DaytonaSandbox;
  try {
    sandbox = (await daytona.create({
      snapshot: SNAPSHOT_NAME,
      envVars,
    })) as DaytonaSandbox;
  } catch (error) {
    throw await enrichCreateError(daytona, error);
  }
  await sandbox.waitUntilStarted?.(START_TIMEOUT_SECONDS);
  const bootDurationMs = Date.now() - bootStart;

  const target: ExistingSandboxTarget = {
    sandboxId: sandbox.id,
    conversationId: null,
    sessionId: null,
    runtimeId: null,
    sandboxProvider: "daytona",
    model: null,
    source: "new",
    sourceId: SNAPSHOT_NAME,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
  };

  console.log(`✓ Sandbox created: ${sandbox.id}`);
  console.log(`✓ Sandbox boot time: ${formatDuration(bootDurationMs)}`);
  await closePool().catch(() => undefined);
  printSandboxInfo(target, "create");
  await printPublicAccessInfo(sandbox);
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
