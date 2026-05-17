import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { MCP_SERVER_REGISTRY, type McpServerSlug } from "../../shared/registry";

const DEFAULT_CHILD_HOST = "127.0.0.1";
const DEFAULT_CHILD_BASE_PORT = 4101;
const READY_TIMEOUT_MS = 15_000;

type ManagedGatewayChild = {
  slug: McpServerSlug;
  port: number;
  target: string;
  process: ChildProcess;
};

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort: number, host: string): Promise<number> {
  let port = startPort;
  while (!(await isPortAvailable(port, host))) {
    port += 1;
  }
  return port;
}

async function waitForPort(port: number, host: string, timeoutMs = READY_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortAvailable(port, host))) {
      return;
    }
    await Bun.sleep(150);
  }
  throw new Error(`Timed out waiting for MCP child on ${host}:${port}`);
}

function pipeChildLogs(slug: string, stream: NodeJS.ReadableStream | null, label: "stdout" | "stderr") {
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
      const logger = label === "stderr" ? console.error : console.log;
      logger(`[mcp:${slug}] ${line}`);
    }
  });
}

async function runChildBuild(params: {
  slug: McpServerSlug;
  childRoot: string;
  env: NodeJS.ProcessEnv;
  rootDir: string;
}) {
  const cwd = path.resolve(params.rootDir, params.childRoot);
  const command = [path.resolve(params.rootDir, "node_modules/.bin/xmcp"), "build"];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: params.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    pipeChildLogs(params.slug, child.stdout, "stdout");
    pipeChildLogs(params.slug, child.stderr, "stderr");

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Failed building MCP child ${params.slug} (code=${code ?? "null"} signal=${signal ?? "null"})`,
        ),
      );
    });
  });
}

function spawnChildProcess(params: {
  slug: McpServerSlug;
  childRoot: string;
  mode: "dev" | "start";
  port: number;
  env: NodeJS.ProcessEnv;
  rootDir: string;
}): ChildProcess {
  const cwd = path.resolve(params.rootDir, params.childRoot);
  const childEnv = {
    ...params.env,
    PORT: String(params.port),
    HOST: DEFAULT_CHILD_HOST,
  };

  const command =
    params.mode === "start"
      ? ["bun", "dist/http.js"]
      : [path.resolve(params.rootDir, "node_modules/.bin/xmcp"), "dev"];

  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeChildLogs(params.slug, child.stdout, "stdout");
  pipeChildLogs(params.slug, child.stderr, "stderr");
  child.on("exit", (code, signal) => {
    console.log(`[mcp:${params.slug}] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  return child;
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

    const port = await findAvailablePort(nextPort, DEFAULT_CHILD_HOST);
    nextPort = port + 1;
    const childEnv = {
      ...params.env,
      PORT: String(port),
      HOST: DEFAULT_CHILD_HOST,
    };

    if (mode === "start") {
      await runChildBuild({
        slug: server.slug,
        childRoot: server.childRoot,
        env: childEnv,
        rootDir: params.rootDir,
      });
    }

    const processHandle = spawnChildProcess({
      slug: server.slug,
      childRoot: server.childRoot,
      mode,
      port,
      env: childEnv,
      rootDir: params.rootDir,
    });
    await waitForPort(port, DEFAULT_CHILD_HOST);

    const target = `http://${DEFAULT_CHILD_HOST}:${port}`;
    children.push({
      slug: server.slug,
      port,
      target,
      process: processHandle,
    });
    targetEnv[server.internalTargetEnvVar] = target;
  }

  const shutdown = () => {
    for (const child of children) {
      if (!child.process.killed) {
        child.process.kill("SIGTERM");
      }
    }
  };

  return {
    children,
    targetEnv,
    shutdown,
  };
}
