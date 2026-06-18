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
 *
 * This file is the orchestrator: it wires together the focused modules under
 * `scripts/daytona-sandbox/` and owns `main()`. The five modules are:
 *   - cli-args      : argument grammar and create-mode defaults
 *   - daytona-client: Daytona SDK auth, connect, and error enrichment
 *   - attach-target : database resolution of which sandbox to act on
 *   - pty-terminal  : PTY bridge for interactive TUIs (opencode/claude)
 *   - repl          : the sandbox> loop and operator-facing printing
 */

import { closePool } from "@bap/db/client";
import { Daytona } from "@daytonaio/sdk";
import * as dotenvConfig from "dotenv/config";

import {
  DEFAULT_CREATE_USER_EMAIL,
  DEFAULT_CREATE_WORKSPACE_SLUG,
  isAttachMode,
  parseArgs,
  printUsage,
} from "./daytona-sandbox/cli-args";
import {
  assertDaytonaTarget,
  getCreateUserContext,
  resolveAttachTarget,
  resolveCreateWorkspace,
  type ExistingSandboxTarget,
} from "./daytona-sandbox/attach-target";
import {
  connectSandboxById,
  enrichCreateError,
  getDaytonaConfig,
  SNAPSHOT_NAME,
  START_TIMEOUT_SECONDS,
  type DaytonaSandbox,
} from "./daytona-sandbox/daytona-client";
import {
  formatDuration,
  printAvailableCommands,
  printPublicAccessInfo,
  printSandboxInfo,
  startRepl,
} from "./daytona-sandbox/repl";

void dotenvConfig;

export {
  DEFAULT_CREATE_USER_EMAIL,
  DEFAULT_CREATE_WORKSPACE_SLUG,
  parseArgs,
} from "./daytona-sandbox/cli-args";

async function runAttach(args: ReturnType<typeof parseArgs>): Promise<void> {
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
}

function logIntegrationStatus(integrationEnvs: Record<string, string>): void {
  if (integrationEnvs.GMAIL_ACCESS_TOKEN) {
    console.log("✓ Google Gmail integration enabled");
  } else {
    console.log("○ Google Gmail integration not found in database");
  }

  if (integrationEnvs.SLACK_ACCESS_TOKEN) {
    console.log("✓ Slack integration enabled");
  } else {
    console.log("○ Slack integration not found in database");
  }

  if (integrationEnvs.NOTION_ACCESS_TOKEN) {
    console.log("✓ Notion integration enabled");
  }

  if (integrationEnvs.GITHUB_ACCESS_TOKEN) {
    console.log("✓ GitHub integration enabled");
  }

  if (integrationEnvs.AIRTABLE_ACCESS_TOKEN) {
    console.log("✓ Airtable integration enabled");
  }
}

async function runCreate(args: ReturnType<typeof parseArgs>): Promise<void> {
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

  logIntegrationStatus(userContext.integrationEnvs);

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  getDaytonaConfig();

  if (isAttachMode(args)) {
    await runAttach(args);
    return;
  }

  await runCreate(args);
}

if (import.meta.main) {
  main().catch(async (error) => {
    await closePool().catch(() => undefined);
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
