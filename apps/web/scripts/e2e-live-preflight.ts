import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

type PreflightService = "web server" | "worker" | "local tunnel" | "Bap MCP";
type PreflightStatus = "ok" | "missing" | "unhealthy";
type CliLivePreflightTarget = "local" | "remote";

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
const remoteWorkerRecovery =
  "Start or repair the deployed worker service for APP_SERVER_URL, then rerun the command.";
const tunnelRecovery =
  "Start the local tunnel with `bun run dev` or `bun run --cwd apps/local-tunnel dev`, then rerun the command.";
const bapMcpRecovery =
  "Start or repair the public MCP tunnel configured by APP_MCP_BASE_URL, then rerun the command.";

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

function resolveCliLiveServerUrl(env: NodeJS.ProcessEnv): string {
  return env.APP_SERVER_URL?.trim() || env.PLAYWRIGHT_BASE_URL?.trim() || DEFAULT_SERVER_URL;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function isLocalTunnelHost(hostname: string): boolean {
  return hostname.toLowerCase().includes("localcan");
}

export function resolveCliLivePreflightTarget(env: NodeJS.ProcessEnv): CliLivePreflightTarget {
  try {
    const hostname = new URL(resolveCliLiveServerUrl(env)).hostname;
    return isLoopbackHost(hostname) || isLocalTunnelHost(hostname) ? "local" : "remote";
  } catch {
    return "local";
  }
}

export function resolveCliLiveWebHealthUrl(
  env: NodeJS.ProcessEnv,
  target: CliLivePreflightTarget = resolveCliLivePreflightTarget(env),
): string {
  const path = target === "remote" ? "/api/health" : "/api/dev/health";
  return new URL(path, resolveCliLiveServerUrl(env)).toString();
}

function resolveCliLiveTestingApiUrl(env: NodeJS.ProcessEnv): string {
  return new URL("/api/internal/testing/cli-live", resolveCliLiveServerUrl(env)).toString();
}

function acceptsBasicOkBody(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
}

function acceptsRemoteHealthBody(body: unknown): boolean {
  if (!acceptsBasicOkBody(body)) {
    return false;
  }

  const checks = (body as { checks?: unknown }).checks;
  return (
    typeof checks === "object" &&
    checks !== null &&
    (checks as { database?: unknown }).database === true &&
    (checks as { redis?: unknown }).redis === true
  );
}

function parseJsonText(text: string): unknown | null {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function summarizeRemoteWorkerReadiness(body: unknown): {
  ready: boolean;
  queueName: string;
  workerCount: number;
} {
  const record = typeof body === "object" && body !== null ? body : {};
  const queueName =
    typeof (record as { queueName?: unknown }).queueName === "string"
      ? (record as { queueName: string }).queueName
      : "unknown";
  const workerCount =
    typeof (record as { workerCount?: unknown }).workerCount === "number"
      ? (record as { workerCount: number }).workerCount
      : 0;

  return {
    ready: (record as { ready?: unknown }).ready === true,
    queueName,
    workerCount,
  };
}

function formatRemoteWorkerDetail(summary: { queueName: string; workerCount: number }): string {
  return `remote queue "${summary.queueName}" has ${summary.workerCount} registered worker(s)`;
}

export function resolveCliLiveBapMcpUrl(env: NodeJS.ProcessEnv): string | null {
  const baseUrl = env.APP_MCP_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  return new URL("/bap", baseUrl).toString();
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

async function checkWebServer(
  env: NodeJS.ProcessEnv,
  target: CliLivePreflightTarget,
): Promise<CliLivePreflightCheck> {
  try {
    return await checkJsonHealth({
      service: "web server",
      url: resolveCliLiveWebHealthUrl(env, target),
      recovery: webRecovery,
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      acceptsBody: target === "remote" ? acceptsRemoteHealthBody : acceptsBasicOkBody,
      expectedBody:
        target === "remote"
          ? "`{ ok: true, checks: { database: true, redis: true } }`"
          : "`{ ok: true }`",
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

async function checkRemoteWorker(env: NodeJS.ProcessEnv): Promise<CliLivePreflightCheck> {
  const secret = env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    return missing(
      "worker",
      "APP_SERVER_SECRET is not configured, so remote worker readiness cannot be checked",
      remoteWorkerRecovery,
    );
  }

  let url: string;
  try {
    url = resolveCliLiveTestingApiUrl(env);
  } catch (error) {
    return unhealthy(
      "worker",
      `APP_SERVER_URL is invalid: ${formatError(error)}`,
      remoteWorkerRecovery,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "worker:queue-ready" }),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = parseJsonText(text);
    if (body === null) {
      return unhealthy("worker", `POST ${url} did not return JSON`, remoteWorkerRecovery);
    }

    if (!response.ok) {
      return unhealthy(
        "worker",
        `POST ${url} returned HTTP ${response.status}`,
        remoteWorkerRecovery,
      );
    }

    const summary = summarizeRemoteWorkerReadiness(body);
    if (!summary.ready) {
      return unhealthy("worker", formatRemoteWorkerDetail(summary), remoteWorkerRecovery);
    }

    return ok("worker", formatRemoteWorkerDetail(summary), remoteWorkerRecovery);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${DEFAULT_HEALTH_TIMEOUT_MS}ms`
        : formatError(error);
    return missing("worker", `POST ${url} failed: ${reason}`, remoteWorkerRecovery);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBapMcp(env: NodeJS.ProcessEnv): Promise<CliLivePreflightCheck> {
  const secret = env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    return missing(
      "Bap MCP",
      "APP_SERVER_SECRET is not configured, so platform MCP tokens cannot be minted",
      bapMcpRecovery,
    );
  }

  let url: string | null = null;
  try {
    url = resolveCliLiveBapMcpUrl(env);
  } catch (error) {
    return unhealthy(
      "Bap MCP",
      `APP_MCP_BASE_URL is invalid: ${formatError(error)}`,
      bapMcpRecovery,
    );
  }

  if (!url) {
    return missing("Bap MCP", "APP_MCP_BASE_URL is not configured", bapMcpRecovery);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json, text/event-stream, */*" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status >= 500) {
      return unhealthy("Bap MCP", `GET ${url} returned HTTP ${response.status}`, bapMcpRecovery);
    }
    if (/Public URL not available/i.test(text)) {
      return unhealthy(
        "Bap MCP",
        `GET ${url} returned a LocalCan unavailable page`,
        bapMcpRecovery,
      );
    }

    return ok("Bap MCP", `reachable at ${url}`, bapMcpRecovery);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${DEFAULT_HEALTH_TIMEOUT_MS}ms`
        : formatError(error);
    return missing("Bap MCP", `GET ${url} failed: ${reason}`, bapMcpRecovery);
  } finally {
    clearTimeout(timeout);
  }
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
  const target = resolveCliLivePreflightTarget(args.env);
  const [web, worker, tunnel, bapMcp] =
    target === "remote"
      ? await Promise.all([
          checkWebServer(args.env, target),
          checkRemoteWorker(args.env),
          Promise.resolve<CliLivePreflightCheck | null>(null),
          checkBapMcp(args.env),
        ])
      : await Promise.all([
          checkWebServer(args.env, target),
          Promise.resolve(checkWorkerProcess(args.env, args.repoRoot)),
          checkLocalTunnel(),
          checkBapMcp(args.env),
        ]);
  const checks = [web, worker, tunnel, bapMcp].filter(
    (check): check is CliLivePreflightCheck => check !== null,
  );

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

export function formatCliLivePreflightSuccess(
  result: CliLivePreflightResult,
  target: CliLivePreflightTarget,
): string {
  const lines = [`cli-live pre-check passed (${target}).`];

  for (const check of result.checks) {
    lines.push(`- ${check.service}: ${check.detail}`);
  }

  return lines.join("\n");
}
