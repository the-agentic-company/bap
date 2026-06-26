import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { logger as telemetryLogger } from "@bap/core/server/utils/observability";
import { MCP_SERVER_REGISTRY, type McpServerSlug } from "../../shared/registry";
import { refreshXmcpImportMap } from "./xmcp-import-map";

const DEFAULT_CHILD_HOST = "127.0.0.1";
const DEFAULT_CHILD_BASE_PORT = 4101;
const READY_TIMEOUT_MS = 15_000;

type ManagedGatewayChild = {
  slug: McpServerSlug;
  port: number;
  target: string;
  process: ChildProcess;
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
    children.push({
      slug: server.slug,
      port: listeningPort,
      target,
      process: processHandle.process,
    });
    targetEnv[server.internalTargetEnvVar] = target;
  }

  const shutdown = () => {
    for (const child of children) {
      const pid = child.process.pid;
      if (pid) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          if (!child.process.killed) {
            child.process.kill("SIGTERM");
          }
        }
      }
    }
  };

  return {
    children,
    targetEnv,
    shutdown,
  };
}
