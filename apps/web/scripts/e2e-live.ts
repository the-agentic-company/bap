import { parse } from "dotenv";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function fail(message: string): never {
  console.error(`[e2e-live] ${message}`);
  process.exit(1);
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, args, {
    cwd: appRoot,
    env,
    stdio: "inherit",
  });

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

  if (status !== 0) {
    process.exit(status ?? 1);
  }
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
  const base = slugify(path.split("/").at(-1) ?? "cmdclaw");
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
  const explicit = process.env.CMDCLAW_ENV_FILE?.trim();
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
  const explicitRoot = process.env.CMDCLAW_INSTANCE_ROOT?.trim();
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
  return worktreeEnvFile !== null || Boolean(baseEnv.CMDCLAW_INSTANCE_ROOT?.trim());
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
    env.CMDCLAW_SERVER_URL ??= env.PLAYWRIGHT_BASE_URL;
  }

  return env;
}

function logRecordMode(worktreeEnvFile: string | null, env: NodeJS.ProcessEnv): void {
  if (!worktreeEnvFile) {
    return;
  }

  const target = env.PLAYWRIGHT_BASE_URL ?? env.CMDCLAW_SERVER_URL ?? "unknown";
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
          "src/app/chat/chat.live.e2e.test.ts",
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
          PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
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
        PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
      });
      await runPlaywright({
        ...baseEnv,
        E2E_LIVE: "1",
        PLAYWRIGHT_SKIP_WEBSERVER: "1",
        PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
      });
      return;
    case "prod-monitor":
      await runAuth({
        ...baseEnv,
        PLAYWRIGHT_SKIP_WEBSERVER: "1",
        PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
      });
      await runPlaywright(
        {
          ...baseEnv,
          E2E_LIVE: "1",
          PLAYWRIGHT_SKIP_WEBSERVER: "1",
          PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
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
          PLAYWRIGHT_BASE_URL: "https://cmdclaw.ai",
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
        CMDCLAW_SERVER_URL: baseEnv.CMDCLAW_SERVER_URL ?? "http://localhost:3000",
      });
      return;
    case "cli-live":
      await runCliLive({
        ...baseEnv,
        E2E_LIVE: "1",
        CMDCLAW_SERVER_URL: baseEnv.CMDCLAW_SERVER_URL ?? "http://localhost:3000",
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
  await run("bun", ["run", "chat:auth"], env);
  await run(
    "bun",
    [
      "vitest",
      "run",
      "tests/e2e-cli/auth.cli.live.e2e.test.ts",
      "src/app/chat/chat.cli.live.test.ts",
      "src/app/chat/chat.interrupt.cli.live.test.ts",
      "src/app/chat/chat.performance.cli.live.test.ts",
      "src/app/chat/chat.question.cli.live.test.ts",
      "src/app/chat/chat.file-upload.cli.live.test.ts",
      "src/app/chat/chat.fill-pdf.cli.live.test.ts",
      "src/app/chat/chat.slack.cli.live.test.ts",
      "src/app/chat/chat.gmail.cli.live.test.ts",
      "src/app/chat/chat.linear.cli.live.test.ts",
      "src/app/chat/chat.google-calendar.cli.live.test.ts",
      "src/app/chat/chat.google-drive.cli.live.test.ts",
      "src/app/coworkers/coworkers.cli.live.test.ts",
      "src/app/coworkers/coworker-builder.cli.live.test.ts",
    ],
    env,
  );
  await run("bun", ["run", "--cwd", "../sandbox", "test:live"], env);
}

if (import.meta.main) {
  void main().then(() => process.exit(0));
}
