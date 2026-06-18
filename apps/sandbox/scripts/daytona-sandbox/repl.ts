/**
 * Interactive REPL and operator-facing printing for the sandbox helper.
 *
 * `startRepl` owns the whole read-eval-print loop: it reads `sandbox>` lines,
 * dispatches built-ins (help/info/kill/exit), routes `opencode`/`claude`
 * through the PTY bridge, runs everything else as a one-shot sandbox command,
 * and handles graceful shutdown (detach vs. kill) on exit, EOF, and SIGINT.
 * The printing helpers and `formatDuration` are the script's reporting
 * surface shared with the create/attach orchestration.
 */

import { closePool } from "@bap/db/client";
import { createInterface } from "readline";

import type { ExistingSandboxTarget } from "./attach-target";
import type { DaytonaProcessResult, DaytonaSandbox } from "./daytona-client";
import { DEFAULT_WORKDIR, runInteractiveCommandWithPty, shouldUsePty } from "./pty-terminal";

const COMMAND_TIMEOUT_MS = 60 * 1000;

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s (${ms}ms)`;
}

function getCommandStdout(result: DaytonaProcessResult): string {
  return result.stdout ?? result.result ?? result.artifacts?.stdout ?? "";
}

function getCommandStderr(result: DaytonaProcessResult): string {
  return result.stderr ?? result.artifacts?.stderr ?? "";
}

export function printSandboxInfo(
  target: ExistingSandboxTarget,
  mode: "create" | "attach",
): void {
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

export async function printPublicAccessInfo(sandbox: DaytonaSandbox): Promise<void> {
  if (!sandbox.getPreviewLink && !sandbox.getSignedPreviewUrl) {
    console.log("  public services: preview links are not available on this Daytona sandbox");
    return;
  }

  console.log("  public services: use Daytona preview links for any server you start manually");
  console.log("  note: bind your debug server to 0.0.0.0:<port> inside the sandbox");
}

export function printAvailableCommands(): void {
  console.log("\nAvailable CLI commands in sandbox:");
  console.log("  google-gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  opencode                        - Run OpenCode interactive CLI");
  console.log("  claude -p <prompt>             - Run Claude Code\n");
}

export async function startRepl(
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
