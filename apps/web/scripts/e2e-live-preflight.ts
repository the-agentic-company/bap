import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

type PreflightService = "web server" | "worker" | "local tunnel";
type PreflightStatus = "ok" | "missing" | "unhealthy";

export type CliLivePreflightCheck = {
  service: PreflightService;
  status: PreflightStatus;
  detail: string;
  recovery: string;
};

export type CliLivePreflightResult = {
  ok: boolean;
  checks: CliLivePreflightCheck[];
};

export type SystemProcess = {
  pid: number;
  command: string;
};

const DEFAULT_SERVER_URL = "http://localhost:3000";
const DEFAULT_LOCAL_TUNNEL_HEALTH_URL = "http://127.0.0.1:3399/__localcan/health";
const DEFAULT_HEALTH_TIMEOUT_MS = 800;

const webRecovery =
  "Start the web server with `bun run dev` or `bun run dev:web`, then rerun the command.";
const workerRecovery =
  "Start the worker with `bun run dev` or `bun run dev:worker`, then rerun the command.";
const tunnelRecovery =
  "Start the local tunnel with `bun run dev` or `bun run --cwd apps/local-tunnel dev`, then rerun the command.";

function ok(service: PreflightService, detail: string, recovery: string): CliLivePreflightCheck {
  return { service, status: "ok", detail, recovery };
}

function missing(
  service: PreflightService,
  detail: string,
  recovery: string,
): CliLivePreflightCheck {
  return { service, status: "missing", detail, recovery };
}

function unhealthy(
  service: PreflightService,
  detail: string,
  recovery: string,
): CliLivePreflightCheck {
  return { service, status: "unhealthy", detail, recovery };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizePath(path: string): string {
  return resolve(path).replace(/\/+$/, "");
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EPERM"
    );
  }
}

export function resolveCliLiveWebHealthUrl(env: NodeJS.ProcessEnv): string {
  const serverUrl =
    env.APP_SERVER_URL?.trim() || env.PLAYWRIGHT_BASE_URL?.trim() || DEFAULT_SERVER_URL;
  return new URL("/api/dev/health", serverUrl).toString();
}

async function checkJsonHealth(args: {
  service: PreflightService;
  url: string;
  recovery: string;
  timeoutMs: number;
  acceptsBody: (body: unknown) => boolean;
  expectedBody: string;
}): Promise<CliLivePreflightCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetch(args.url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return unhealthy(args.service, `GET ${args.url} did not return JSON`, args.recovery);
    }

    if (!response.ok) {
      return unhealthy(
        args.service,
        `GET ${args.url} returned HTTP ${response.status}`,
        args.recovery,
      );
    }

    if (!args.acceptsBody(body)) {
      return unhealthy(
        args.service,
        `GET ${args.url} did not return ${args.expectedBody}`,
        args.recovery,
      );
    }

    return ok(args.service, `healthy at ${args.url}`, args.recovery);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${args.timeoutMs}ms`
        : formatError(error);
    return missing(args.service, `GET ${args.url} failed: ${reason}`, args.recovery);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkWebServer(env: NodeJS.ProcessEnv): Promise<CliLivePreflightCheck> {
  try {
    return await checkJsonHealth({
      service: "web server",
      url: resolveCliLiveWebHealthUrl(env),
      recovery: webRecovery,
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      acceptsBody: (body) =>
        typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true,
      expectedBody: "`{ ok: true }`",
    });
  } catch (error) {
    return unhealthy("web server", `APP_SERVER_URL is invalid: ${formatError(error)}`, webRecovery);
  }
}

async function checkLocalTunnel(): Promise<CliLivePreflightCheck> {
  return checkJsonHealth({
    service: "local tunnel",
    url: DEFAULT_LOCAL_TUNNEL_HEALTH_URL,
    recovery: tunnelRecovery,
    timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    acceptsBody: (body) =>
      typeof body === "object" &&
      body !== null &&
      (body as { ok?: unknown; proxy?: unknown }).ok === true &&
      (body as { proxy?: unknown }).proxy === "localcan",
    expectedBody: '`{ ok: true, proxy: "localcan" }`',
  });
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readTrackedWorkerProcess(instanceRoot: string): CliLivePreflightCheck | null {
  const processFile = join(instanceRoot, "processes.json");
  if (!existsSync(processFile)) {
    return null;
  }

  try {
    const processes = parseJsonFile(processFile) as { worker?: unknown };
    const pid = processes.worker;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return missing(
        "worker",
        `tracked process file has no worker pid at ${processFile}`,
        workerRecovery,
      );
    }

    if (isPidRunning(pid)) {
      return ok("worker", `tracked worker pid ${pid} is running`, workerRecovery);
    }

    return missing(
      "worker",
      `tracked worker pid ${pid} from ${processFile} is not running`,
      workerRecovery,
    );
  } catch (error) {
    return unhealthy(
      "worker",
      `could not read tracked worker process file ${processFile}: ${formatError(error)}`,
      workerRecovery,
    );
  }
}

function listSystemProcesses(): SystemProcess[] {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line): SystemProcess | null => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        command: match[2] ?? "",
      };
    })
    .filter((processEntry): processEntry is SystemProcess => processEntry !== null);
}

function readProcessCwdFromProcfs(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

function readProcessCwdWithLsof(pid: number): string | null {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("n"))
      ?.slice(1)
      .trim() || null
  );
}

function readProcessCwdWithPwdx(pid: number): string | null {
  const result = spawnSync("pwdx", [String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return null;
  }

  const match = result.stdout.match(/^\d+:\s*(.+)$/);
  return match?.[1]?.trim() || null;
}

function readProcessCwd(pid: number): string | null {
  return (
    readProcessCwdFromProcfs(pid) ?? readProcessCwdWithLsof(pid) ?? readProcessCwdWithPwdx(pid)
  );
}

function commandDirectlyNamesWorker(command: string, repoRoot: string): boolean {
  const normalizedCommand = command.toLowerCase();
  const workerRoot = normalizePath(join(repoRoot, "apps/worker")).toLowerCase();

  return (
    normalizedCommand.includes("@bap/worker") ||
    normalizedCommand.includes("apps/worker") ||
    normalizedCommand.includes(workerRoot)
  );
}

function commandCouldBeWorkerEntrypoint(command: string): boolean {
  const normalizedCommand = command.toLowerCase();
  return (
    normalizedCommand.includes("bun") &&
    normalizedCommand.includes("index.ts") &&
    normalizedCommand.includes("--env-file")
  );
}

export function collectWorkerProcessMatches(
  processes: SystemProcess[],
  repoRoot: string,
  resolveCwd: (pid: number) => string | null = readProcessCwd,
  isRunning: (pid: number) => boolean = isPidRunning,
): SystemProcess[] {
  const workerRoot = normalizePath(join(repoRoot, "apps/worker"));
  return processes.filter((processEntry) => {
    if (!isRunning(processEntry.pid)) {
      return false;
    }

    if (commandDirectlyNamesWorker(processEntry.command, repoRoot)) {
      return true;
    }

    if (!commandCouldBeWorkerEntrypoint(processEntry.command)) {
      return false;
    }

    const cwd = resolveCwd(processEntry.pid);
    return cwd !== null && normalizePath(cwd) === workerRoot;
  });
}

function checkWorkerProcess(env: NodeJS.ProcessEnv, repoRoot: string): CliLivePreflightCheck {
  const tracked = env.BAP_INSTANCE_ROOT?.trim()
    ? readTrackedWorkerProcess(env.BAP_INSTANCE_ROOT.trim())
    : null;
  if (tracked?.status === "ok") {
    return tracked;
  }

  const matches = collectWorkerProcessMatches(listSystemProcesses(), repoRoot);
  if (matches.length > 0) {
    const pids = matches.map((processEntry) => processEntry.pid).join(", ");
    return ok("worker", `worker process running with pid ${pids}`, workerRecovery);
  }

  const trackedDetail = tracked ? `${tracked.detail}; ` : "";
  return missing(
    "worker",
    `${trackedDetail}no worker process found for ${join(repoRoot, "apps/worker")}`,
    workerRecovery,
  );
}

export async function runCliLivePreflight(args: {
  env: NodeJS.ProcessEnv;
  repoRoot: string;
}): Promise<CliLivePreflightResult> {
  const [web, tunnel] = await Promise.all([checkWebServer(args.env), checkLocalTunnel()]);
  const worker = checkWorkerProcess(args.env, args.repoRoot);
  const checks = [web, worker, tunnel];

  return {
    ok: checks.every((check) => check.status === "ok"),
    checks,
  };
}

function formatServiceNames(checks: CliLivePreflightCheck[]): string {
  return checks.map((check) => check.service).join(", ");
}

export function formatCliLivePreflightFailure(result: CliLivePreflightResult): string {
  const missingChecks = result.checks.filter((check) => check.status === "missing");
  const unhealthyChecks = result.checks.filter((check) => check.status === "unhealthy");
  const failedChecks = result.checks.filter((check) => check.status !== "ok");
  const lines = ["cli-live pre-check failed."];

  if (missingChecks.length > 0) {
    lines.push(`not started: ${formatServiceNames(missingChecks)}`);
  }
  if (unhealthyChecks.length > 0) {
    lines.push(`unhealthy: ${formatServiceNames(unhealthyChecks)}`);
  }

  for (const check of failedChecks) {
    lines.push(`- ${check.service}: ${check.detail}`);
    lines.push(`  ${check.recovery}`);
  }

  return lines.join("\n");
}
