import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer, type Server } from "node:net";
import path from "node:path";
import { logger as telemetryLogger } from "@bap/core/server/utils/observability";
import { MCP_SERVER_REGISTRY, type McpServerSlug } from "../../shared/registry";
import { refreshXmcpImportMap } from "./xmcp-import-map";

const DEFAULT_CHILD_HOST = "127.0.0.1";
const DEFAULT_CHILD_BASE_PORT = 4101;
const READY_TIMEOUT_MS = 15_000;
const CHILD_HEALTH_CHECK_INTERVAL_MS = 1_000;
const CHILD_UNHEALTHY_CHECK_THRESHOLD = 3;
const CHILD_RESTART_INITIAL_DELAY_MS = 250;
const CHILD_RESTART_MAX_DELAY_MS = 5_000;
const CHILD_RESTART_STABLE_AFTER_MS = 30_000;

export type ManagedGatewayChild = {
  slug: McpServerSlug;
  port: number;
  target: string;
  process: ChildProcess;
};

type SpawnedGatewayChild = Awaited<ReturnType<typeof spawnChildProcess>>;

type ManagedChildFailureReason = "process_exit" | "target_unhealthy" | "shutdown";

export type ManagedGatewaySupervisorDependencies = {
  waitForFailure: (input: {
    process: ChildProcess;
    port: number;
    signal: AbortSignal;
  }) => Promise<ManagedChildFailureReason>;
  spawnChild: typeof spawnChildProcess;
  waitForDelay: (ms: number, signal: AbortSignal) => Promise<void>;
  terminateChild: (child: ChildProcess) => void;
  now: () => number;
};

type ReservedPort = {
  port: number;
  release: () => Promise<void>;
};

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function reservePort(port: number, host: string): Promise<ReservedPort | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      resolve({
        port,
        release: () => closeServer(server),
      });
    });
  });
}

async function reserveAvailablePort(startPort: number, host: string): Promise<ReservedPort> {
  let port = startPort;
  let reserved = await reservePort(port, host);
  while (!reserved) {
    port += 1;
    reserved = await reservePort(port, host);
  }
  return reserved;
}

export function parseMcpChildListeningPort(line: string, host: string): number | null {
  const match = line.match(/MCP Server running on http:\/\/([^:]+):(\d+)\/mcp/);
  if (!match) {
    return null;
  }

  const [, listeningHost, rawPort] = match;
  if (listeningHost !== host) {
    return null;
  }

  const port = Number.parseInt(rawPort, 10);
  return Number.isNaN(port) ? null : port;
}

export function getMcpChildRestartDelayMs(restartAttempt: number): number {
  const normalizedAttempt = Math.max(0, Math.floor(restartAttempt));
  return Math.min(
    CHILD_RESTART_INITIAL_DELAY_MS * 2 ** normalizedAttempt,
    CHILD_RESTART_MAX_DELAY_MS,
  );
}

function waitForAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function isTcpPortListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(CHILD_HEALTH_CHECK_INTERVAL_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function terminateChildProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function waitForManagedChildFailure(input: {
  process: ChildProcess;
  port: number;
  signal: AbortSignal;
}): Promise<"process_exit" | "target_unhealthy" | "shutdown"> {
  return new Promise((resolve) => {
    let unhealthyChecks = 0;
    let checking = false;
    let settled = false;
    const finish = (reason: "process_exit" | "target_unhealthy" | "shutdown") => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(interval);
      input.process.off("exit", onExit);
      input.signal.removeEventListener("abort", onAbort);
      resolve(reason);
    };
    const onExit = () => finish("process_exit");
    const onAbort = () => finish("shutdown");
    const check = async () => {
      if (checking || settled) {
        return;
      }
      checking = true;
      try {
        unhealthyChecks = (await isTcpPortListening(input.port, DEFAULT_CHILD_HOST))
          ? 0
          : unhealthyChecks + 1;
        if (unhealthyChecks >= CHILD_UNHEALTHY_CHECK_THRESHOLD) {
          finish("target_unhealthy");
        }
      } finally {
        checking = false;
      }
    };
    const interval = setInterval(() => void check(), CHILD_HEALTH_CHECK_INTERVAL_MS);
    input.process.once("exit", onExit);
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.process.exitCode !== null || input.signal.aborted) {
      finish(input.signal.aborted ? "shutdown" : "process_exit");
    }
  });
}

function pipeChildLogs(
  slug: string,
  stream: NodeJS.ReadableStream | null,
  label: "stdout" | "stderr",
  onLine?: (line: string) => void,
) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      onLine?.(line);
      const consoleLogger = label === "stderr" ? console.error : console.log;
      const prefixedLine = `[mcp:${slug}] ${line}`;
      consoleLogger(prefixedLine);
      const level = label === "stderr" ? "error" : "info";
      const fields = {
        event: "mcp.child_log",
        source: "mcp-gateway-supervisor",
        "mcp.server.slug": slug,
        "mcp.child.stream": label,
        line,
      };
      if (level === "error") {
        telemetryLogger.error(fields, "mcp child stderr");
      } else {
        telemetryLogger.info(fields, "mcp child stdout");
      }
    }
  });
}

async function spawnChildProcess(params: {
  slug: McpServerSlug;
  childRoot: string;
  mode: "dev" | "start";
  port: number;
  env: NodeJS.ProcessEnv;
  rootDir: string;
}): Promise<{
  process: ChildProcess;
  readyPort: Promise<number>;
}> {
  const cwd = path.resolve(params.rootDir, params.childRoot);
  if (params.mode === "dev") {
    await refreshXmcpImportMap(cwd);
  }
  const childEnv = {
    ...params.env,
    PORT: String(params.port),
    HOST: DEFAULT_CHILD_HOST,
  };

  const command =
    params.mode === "start"
      ? ["bun", "dist/http.js"]
      : [path.resolve(params.rootDir, "node_modules/.bin/xmcp"), "dev"];

  let readyTimeout: Timer | undefined;
  let settleReadyPort: ((port: number) => void) | undefined;
  let rejectReadyPort: ((error: Error) => void) | undefined;
  const readyPort = new Promise<number>((resolve, reject) => {
    settleReadyPort = resolve;
    rejectReadyPort = reject;
    readyTimeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for MCP child ${params.slug} to report a listening port after ${READY_TIMEOUT_MS}ms`,
        ),
      );
    }, READY_TIMEOUT_MS);
  });

  const resolveReadyPort = (line: string) => {
    const listeningPort = parseMcpChildListeningPort(line, DEFAULT_CHILD_HOST);
    if (listeningPort === null) {
      return;
    }
    if (readyTimeout) {
      clearTimeout(readyTimeout);
      readyTimeout = undefined;
    }
    settleReadyPort?.(listeningPort);
    settleReadyPort = undefined;
    rejectReadyPort = undefined;
  };

  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: childEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeChildLogs(params.slug, child.stdout, "stdout", resolveReadyPort);
  pipeChildLogs(params.slug, child.stderr, "stderr");
  child.on("error", (error) => {
    if (readyTimeout) {
      clearTimeout(readyTimeout);
      readyTimeout = undefined;
    }
    rejectReadyPort?.(error);
    settleReadyPort = undefined;
    rejectReadyPort = undefined;
  });
  child.on("exit", (code, signal) => {
    if (readyTimeout) {
      clearTimeout(readyTimeout);
      readyTimeout = undefined;
    }
    rejectReadyPort?.(
      new Error(
        `MCP child ${params.slug} exited before startup (code=${code ?? "null"} signal=${signal ?? "null"})`,
      ),
    );
    settleReadyPort = undefined;
    rejectReadyPort = undefined;
    console.log(`[mcp:${params.slug}] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  return {
    process: child,
    readyPort,
  };
}

const managedGatewaySupervisorDependencies: ManagedGatewaySupervisorDependencies = {
  waitForFailure: waitForManagedChildFailure,
  spawnChild: spawnChildProcess,
  waitForDelay: waitForAbortableDelay,
  terminateChild: terminateChildProcess,
  now: Date.now,
};

type ManagedGatewaySupervisorInput = {
  child: ManagedGatewayChild;
  initialHandle: SpawnedGatewayChild;
  spawnParams: Parameters<typeof spawnChildProcess>[0];
  signal: AbortSignal;
};

async function spawnReadyReplacement(
  input: ManagedGatewaySupervisorInput,
  dependencies: ManagedGatewaySupervisorDependencies,
): Promise<SpawnedGatewayChild | null> {
  const replacement = await dependencies.spawnChild({
    ...input.spawnParams,
    port: input.child.port,
  });
  try {
    if (input.signal.aborted) {
      dependencies.terminateChild(replacement.process);
      return null;
    }

    const listeningPort = await replacement.readyPort;
    if (input.signal.aborted) {
      dependencies.terminateChild(replacement.process);
      return null;
    }
    if (listeningPort !== input.child.port) {
      throw new Error(
        `MCP child ${input.child.slug} restarted on unexpected port ${listeningPort}; expected ${input.child.port}`,
      );
    }
    return replacement;
  } catch (error) {
    dependencies.terminateChild(replacement.process);
    throw error;
  }
}

async function restartManagedGatewayChild(
  input: ManagedGatewaySupervisorInput,
  dependencies: ManagedGatewaySupervisorDependencies,
  restartAttempt: number,
): Promise<{
  processHandle: SpawnedGatewayChild;
  restartAttempt: number;
  readyAt: number;
} | null> {
  let nextAttempt = restartAttempt;
  while (!input.signal.aborted) {
    const delayMs = getMcpChildRestartDelayMs(nextAttempt);
    nextAttempt += 1;
    // eslint-disable-next-line no-await-in-loop -- restart backoff must complete before respawn
    await dependencies.waitForDelay(delayMs, input.signal);
    if (input.signal.aborted) {
      return null;
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- only one replacement may own the fixed port
      const replacement = await spawnReadyReplacement(input, dependencies);
      if (!replacement) {
        return null;
      }
      input.child.process = replacement.process;
      console.log(`[mcp:${input.child.slug}] supervisor restored target ${input.child.target}`);
      return {
        processHandle: replacement,
        restartAttempt: nextAttempt,
        readyAt: dependencies.now(),
      };
    } catch (error) {
      if (input.signal.aborted) {
        return null;
      }
      console.error(
        `[mcp:${input.child.slug}] restart failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return null;
}

export async function superviseManagedGatewayChild(
  input: ManagedGatewaySupervisorInput,
  dependencies: ManagedGatewaySupervisorDependencies = managedGatewaySupervisorDependencies,
): Promise<void> {
  let processHandle = input.initialHandle;
  let restartAttempt = 0;
  let readyAt = dependencies.now();
  while (!input.signal.aborted) {
    // eslint-disable-next-line no-await-in-loop -- supervision is intentionally sequential
    const reason = await dependencies.waitForFailure({
      process: processHandle.process,
      port: input.child.port,
      signal: input.signal,
    });
    if (reason === "shutdown" || input.signal.aborted) {
      return;
    }
    if (dependencies.now() - readyAt >= CHILD_RESTART_STABLE_AFTER_MS) {
      restartAttempt = 0;
    }

    console.error(
      `[mcp:${input.child.slug}] supervisor detected ${reason}; restarting on port ${input.child.port}`,
    );
    dependencies.terminateChild(processHandle.process);

    // eslint-disable-next-line no-await-in-loop -- recovery must finish before supervision resumes
    const restarted = await restartManagedGatewayChild(input, dependencies, restartAttempt);
    if (!restarted) {
      return;
    }
    processHandle = restarted.processHandle;
    restartAttempt = restarted.restartAttempt;
    readyAt = restarted.readyAt;
  }
}

export function shouldManageGatewayChildren(env: Record<string, string | undefined>): boolean {
  return env.MCP_GATEWAY_MANAGED_CHILDREN === "true";
}

export function getManagedChildMode(env: Record<string, string | undefined>): "dev" | "start" {
  return env.MCP_GATEWAY_CHILD_MODE === "start" ? "start" : "dev";
}

export async function startManagedGatewayChildren(params: {
  env: NodeJS.ProcessEnv;
  rootDir: string;
}) {
  const mode = getManagedChildMode(params.env);
  const children: ManagedGatewayChild[] = [];
  const shutdownController = new AbortController();
  const targetEnv: Record<string, string> = {};
  let nextPort = Number.parseInt(
    params.env.MCP_GATEWAY_BASE_CHILD_PORT ?? String(DEFAULT_CHILD_BASE_PORT),
    10,
  );

  for (const server of Object.values(MCP_SERVER_REGISTRY)) {
    const existingTarget = params.env[server.internalTargetEnvVar]?.trim();
    if (existingTarget) {
      targetEnv[server.internalTargetEnvVar] = existingTarget;
      continue;
    }

    const reservedPort = await reserveAvailablePort(nextPort, DEFAULT_CHILD_HOST);
    const port = reservedPort.port;
    nextPort = port + 1;
    const childEnv = {
      ...params.env,
      PORT: String(port),
      HOST: DEFAULT_CHILD_HOST,
    };

    const processHandle = await spawnChildProcess({
      slug: server.slug,
      childRoot: server.childRoot,
      mode,
      port,
      env: childEnv,
      rootDir: params.rootDir,
    });
    await reservedPort.release();
    const listeningPort = await processHandle.readyPort;

    const target = `http://${DEFAULT_CHILD_HOST}:${listeningPort}`;
    const child = {
      slug: server.slug,
      port: listeningPort,
      target,
      process: processHandle.process,
    };
    children.push(child);
    targetEnv[server.internalTargetEnvVar] = target;
    void superviseManagedGatewayChild({
      child,
      initialHandle: processHandle,
      spawnParams: {
        slug: server.slug,
        childRoot: server.childRoot,
        mode,
        port: listeningPort,
        env: childEnv,
        rootDir: params.rootDir,
      },
      signal: shutdownController.signal,
    }).catch((error) => {
      console.error(
        `[mcp:${child.slug}] supervisor stopped unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  const shutdown = () => {
    shutdownController.abort();
    for (const child of children) {
      terminateChildProcess(child.process);
    }
  };

  return {
    children,
    targetEnv,
    shutdown,
  };
}
