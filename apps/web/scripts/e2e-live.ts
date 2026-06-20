import { parse } from "dotenv";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatCliLivePreflightFailure,
  formatCliLivePreflightSuccess,
  resolveCliLivePreflightTarget,
  runCliLivePreflight,
} from "./e2e-live-preflight";

type Mode =
  | "auth"
  | "smoke"
  | "smoke-stable"
  | "live-stable"
  | "live"
  | "record"
  | "prod-stable"
  | "prod"
  | "prod-monitor-stable"
  | "prod-monitor"
  | "cli-live-stable"
  | "cli-live";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const cliLiveTimeoutMs = 20 * 60 * 1000;

function fail(message: string): never {
  console.error(`[e2e-live] ${message}`);
  process.exit(1);
}

async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const child = spawn(command, args, {
    cwd: appRoot,
    env,
    stdio: "inherit",
  });

  let timedOut = false;
  const timeout =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        }, options.timeoutMs)
      : undefined;
  timeout?.unref();

  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).catch((error) => {
    fail(
      `${command} ${args.join(" ")} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  if (timeout) {
    clearTimeout(timeout);
  }

  if (timedOut) {
    fail(`${command} ${args.join(" ")} timed out after ${formatDuration(options.timeoutMs ?? 0)}`);
  }

  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes}min` : `${minutes}min ${seconds}s`;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    fail(
      `git ${args.join(" ")} failed: ${result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`}`,
    );
  }

  return result.stdout.trim();
}

function slugify(value: string, separator: "-" | "_" = "-"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, "g"), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, "g"), "");

  return normalized || "main";
}

function buildInstanceId(path: string): string {
  const base = slugify(path.split("/").at(-1) ?? "bap");
  const hash = createHash("sha1").update(path).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function loadEnvFile(path: string | null): Record<string, string> {
  if (!path || !existsSync(path)) {
    return {};
  }

  return parse(readFileSync(path, "utf8"));
}

function resolveSharedEnvFile(): string | null {
  const explicit = process.env.BAP_ENV_FILE?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const directCandidate = join(repoRoot, ".env");
  if (existsSync(directCandidate)) {
    return directCandidate;
  }

  const worktreeList = git(["worktree", "list", "--porcelain"]);
  const worktreePaths = worktreeList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

  for (const worktreePath of worktreePaths) {
    const candidate = join(worktreePath, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveWorktreeEnvFile(): string | null {
  const explicitRoot = process.env.BAP_INSTANCE_ROOT?.trim();
  if (explicitRoot) {
    const candidate = join(explicitRoot, "instance.env");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const instanceId = buildInstanceId(repoRoot);
  const candidate = join(repoRoot, ".worktrees", instanceId, "instance.env");
  if (existsSync(candidate)) {
    return candidate;
  }

  return null;
}

function buildBaseEnv(): { env: NodeJS.ProcessEnv; worktreeEnvFile: string | null } {
  const worktreeEnvFile = resolveWorktreeEnvFile();

  return {
    worktreeEnvFile,
    env: {
      ...loadEnvFile(resolveSharedEnvFile()),
      ...loadEnvFile(worktreeEnvFile),
      ...process.env,
    },
  };
}

function hasWorktreeContext(baseEnv: NodeJS.ProcessEnv, worktreeEnvFile: string | null): boolean {
  return worktreeEnvFile !== null || Boolean(baseEnv.BAP_INSTANCE_ROOT?.trim());
}

export function buildRecordModeEnv(
  baseEnv: NodeJS.ProcessEnv,
  options: { hasWorktreeEnv: boolean },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    E2E_LIVE: "1",
    PLAYWRIGHT_REUSE_SERVER: "1",
    PLAYWRIGHT_VIDEO: "on",
  };

  if (options.hasWorktreeEnv) {
    env.PLAYWRIGHT_SKIP_WEBSERVER ??= "1";
    env.APP_SERVER_URL ??= env.PLAYWRIGHT_BASE_URL;
  }

  return env;
}

function logRecordMode(worktreeEnvFile: string | null, env: NodeJS.ProcessEnv): void {
  if (!worktreeEnvFile) {
    return;
  }

  const target = env.PLAYWRIGHT_BASE_URL ?? env.APP_SERVER_URL ?? "unknown";
  console.log(`[e2e-live] using worktree server ${target}`);
}

function buildStableReuseServerEnv(
  baseEnv: NodeJS.ProcessEnv,
  worktreeEnvFile: string | null,
  extraEnv: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const useWorktreeServer = hasWorktreeContext(baseEnv, worktreeEnvFile);

  return {
    ...baseEnv,
    ...extraEnv,
    PLAYWRIGHT_REUSE_SERVER: extraEnv.PLAYWRIGHT_REUSE_SERVER ?? "1",
    PLAYWRIGHT_SKIP_WEBSERVER:
      extraEnv.PLAYWRIGHT_SKIP_WEBSERVER ??
      (useWorktreeServer ? "1" : (baseEnv.PLAYWRIGHT_SKIP_WEBSERVER ?? "0")),
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2] as Mode | undefined;
  if (!mode) {
    fail(
      "Usage: bun scripts/e2e-live.ts <auth|smoke|smoke-stable|live-stable|live|record|prod-stable|prod|prod-monitor-stable|prod-monitor|cli-live-stable|cli-live>",
    );
  }

  const { env: baseEnv, worktreeEnvFile } = buildBaseEnv();
  const useWorktreeServer = hasWorktreeContext(baseEnv, worktreeEnvFile);

  switch (mode) {
    case "auth":
      await runAuth(baseEnv);
      return;
    case "smoke":
      await runPlaywright({
        ...baseEnv,
        PLAYWRIGHT_REUSE_SERVER: baseEnv.PLAYWRIGHT_REUSE_SERVER ?? "1",
      });
      return;
    case "smoke-stable":
      await runPlaywright(buildStableReuseServerEnv(baseEnv, worktreeEnvFile), [
        "tests/e2e/auth-smoke.e2e.ts",
        "-g",
        "allows public legal and support routes|does not redirect /api/rpc to login",
      ]);
      return;
    case "live-stable":
      await runAuth(baseEnv);
      await runPlaywright(
        buildStableReuseServerEnv(baseEnv, worktreeEnvFile, {
          E2E_LIVE: "1",
        }),
        [
          "tests/e2e/auth-smoke.e2e.ts",
          "tests/e2e/live/chat.live.e2e.ts",
          "-g",
          "allows public legal and support routes|does not redirect /api/rpc to login|sends hi and receives an answer",
        ],
      );
      return;
    case "live":
      await runAuth(baseEnv);
      await runPlaywright({
        ...baseEnv,
        E2E_LIVE: "1",
        PLAYWRIGHT_REUSE_SERVER: "1",
      });
      return;
    case "record":
      runAuth(baseEnv);
      {
        const recordEnv = buildRecordModeEnv(baseEnv, {
          hasWorktreeEnv: useWorktreeServer,
        });
        logRecordMode(worktreeEnvFile, recordEnv);
        await runPlaywright(recordEnv);
      }
      return;
    case "prod-stable":
      await runPlaywright(
        {
          ...baseEnv,
          PLAYWRIGHT_SKIP_WEBSERVER: "1",
          PLAYWRIGHT_BASE_URL: "https://heybap.com",
        },
        [
          "tests/e2e/auth-smoke.e2e.ts",
          "-g",
          "allows public legal and support routes|does not redirect /api/rpc to login",
        ],
      );
      return;
    case "prod":
      await runAuth({
        ...baseEnv,
        PLAYWRIGHT_SKIP_WEBSERVER: "1",
        PLAYWRIGHT_BASE_URL: "https://heybap.com",
      });
      await runPlaywright({
        ...baseEnv,
        E2E_LIVE: "1",
        PLAYWRIGHT_SKIP_WEBSERVER: "1",
        PLAYWRIGHT_BASE_URL: "https://heybap.com",
      });
      return;
    case "prod-monitor":
      await runAuth({
        ...baseEnv,
        PLAYWRIGHT_SKIP_WEBSERVER: "1",
        PLAYWRIGHT_BASE_URL: "https://heybap.com",
      });
      await runPlaywright(
        {
          ...baseEnv,
          E2E_LIVE: "1",
          PLAYWRIGHT_SKIP_WEBSERVER: "1",
          PLAYWRIGHT_BASE_URL: "https://heybap.com",
          PLAYWRIGHT_HTML_OPEN: "never",
          PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report/monitor",
          PLAYWRIGHT_JSON_OUTPUT_NAME: "test-results/monitor/results.json",
        },
        ["-g", "@live", "--reporter=list,json,html"],
      );
      return;
    case "prod-monitor-stable":
      await runPlaywright(
        {
          ...baseEnv,
          PLAYWRIGHT_SKIP_WEBSERVER: "1",
          PLAYWRIGHT_BASE_URL: "https://heybap.com",
          PLAYWRIGHT_HTML_OPEN: "never",
          PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report/monitor",
          PLAYWRIGHT_JSON_OUTPUT_NAME: "test-results/monitor/results.json",
        },
        [
          "tests/e2e/auth-smoke.e2e.ts",
          "-g",
          "allows public legal and support routes|does not redirect /api/rpc to login",
          "--reporter=list,json,html",
        ],
      );
      return;
    case "cli-live-stable":
      await runCliLiveStable({
        ...baseEnv,
        E2E_LIVE: "1",
        APP_SERVER_URL: baseEnv.APP_SERVER_URL ?? "http://localhost:3000",
      });
      return;
    case "cli-live":
      await runCliLive({
        ...baseEnv,
        E2E_LIVE: "1",
        APP_SERVER_URL: baseEnv.APP_SERVER_URL ?? "http://localhost:3000",
      });
      return;
    default:
      fail(`Unsupported mode: ${mode}`);
  }
}

function runAuth(env: NodeJS.ProcessEnv): Promise<void> {
  return run("bun", ["scripts/e2e-auth.ts"], env);
}

function runPlaywright(env: NodeJS.ProcessEnv, extraArgs: string[] = []): Promise<void> {
  return run("bun", ["playwright", "test", ...extraArgs], env);
}

function runCliLiveStable(env: NodeJS.ProcessEnv): Promise<void> {
  return run("bun", ["vitest", "run", "tests/e2e-cli/auth.cli.live.e2e.test.ts"], env);
}

async function runCliLive(env: NodeJS.ProcessEnv): Promise<void> {
  const preflightTarget = resolveCliLivePreflightTarget(env);
  const preflight = await runCliLivePreflight({ env, repoRoot });
  if (!preflight.ok) {
    fail(formatCliLivePreflightFailure(preflight));
  }
  console.log(`[e2e-live] ${formatCliLivePreflightSuccess(preflight, preflightTarget)}`);

  const deadline = Date.now() + cliLiveTimeoutMs;
  const runWithCliLiveDeadline = (command: string, args: string[]) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      fail(`cli-live timed out after ${formatDuration(cliLiveTimeoutMs)}`);
    }

    return run(command, args, env, { timeoutMs: remainingMs });
  };

  await runWithCliLiveDeadline("bun", ["run", "chat:auth"]);
  await runWithCliLiveDeadline("bun", [
    "vitest",
    "run",
    "tests/e2e-cli/auth.cli.live.e2e.test.ts",
    "tests/e2e-cli/chat.cli.live.test.ts",
    "tests/e2e-cli/chat.interrupt.cli.live.test.ts",
    "tests/e2e-cli/chat.performance.cli.live.test.ts",
    "tests/e2e-cli/chat.runtime-progress-stall.cli.live.test.ts",
    "tests/e2e-cli/chat.question.cli.live.test.ts",
    "tests/e2e-cli/chat.file-upload.cli.live.test.ts",
    "tests/e2e-cli/chat.fill-pdf.cli.live.test.ts",
    "tests/e2e-cli/chat.slack.cli.live.test.ts",
    "tests/e2e-cli/chat.gmail.cli.live.test.ts",
    "tests/e2e-cli/chat.linear.cli.live.test.ts",
    "tests/e2e-cli/chat.bap-mcp.cli.live.test.ts",
    "tests/e2e-cli/chat.google-calendar.cli.live.test.ts",
    "tests/e2e-cli/chat.google-drive.cli.live.test.ts",
    "tests/e2e-cli/chat.linkedin.cli.live.test.ts",
    "tests/e2e-cli/chat.sandbox-file.cli.live.test.ts",
    "tests/e2e-cli/coworkers.cli.live.test.ts",
    "tests/e2e-cli/coworker-builder.cli.live.test.ts",
  ]);
  await runWithCliLiveDeadline("bun", ["run", "--cwd", "../sandbox", "test:live"]);
}

if (import.meta.main) {
  void main().then(() => process.exit(0));
}
