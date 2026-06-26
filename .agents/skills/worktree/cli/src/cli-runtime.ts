import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import {
  resolveConfiguredSharedWorktreeRoot,
  resolveSharedWorktreeLocksDir,
  resolveSharedWorktreeSlotLeasePath,
} from "./coordination";
import {
  buildSharedStackConfig,
  type SharedStackConfig,
} from "./stack";
import { MAX_RUNNING_WORKTREE_WEB_PROCESSES } from "./start-guard";

export const require = createRequire(new URL("../../../../../apps/web/package.json", import.meta.url));
export const { Client } = require("pg") as typeof import("pg");
export const { serializeSignedCookie } = require("better-call") as typeof import("better-call");
export const dotenv = require("dotenv") as typeof import("dotenv");

export type CommandName =
  | "create"
  | "setup"
  | "start"
  | "stop"
  | "destroy"
  | "docker-up"
  | "docker-down"
  | "dev"
  | "status"
  | "processes"
  | "cleanup"
  | "env"
  | "bootstrap-user";

export type InstanceMetadata = {
  instanceId: string;
  repoRoot: string;
  instanceRoot: string;
  stackSlot: number;
  appPort: number;
  wsPort: number;
  appUrl: string;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databaseUrl: string;
  redisUser: string;
  redisPassword: string;
  queueName: string;
  redisNamespace: string;
  minioBucketName: string;
  minioAccessKeyId: string;
  minioSecretAccessKey: string;
  createdAt: string;
  updatedAt: string;
};

export type InstanceProcesses = Partial<Record<"web" | "worker" | "ws", number>>;

export type DerivedEnv = Record<string, string>;

export type SourceUserRecord = {
  id: string;
  email: string;
};

export type SessionProfileRecord = {
  token: string;
  email: string;
  expiresAt: Date;
};

export const COMMENTED_WORKTREE_ENV_KEYS = [
  "DAYTONA_API_PORT",
  "DAYTONA_PROXY_PORT",
  "DAYTONA_SSH_GATEWAY_PORT",
  "DAYTONA_DEX_PORT",
  "DAYTONA_API_URL",
  "DAYTONA_DB_VOLUME",
  "DAYTONA_DEX_VOLUME",
  "DAYTONA_REGISTRY_VOLUME",
] as const;

export const DEFAULT_BASE_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres";
export const PROCESS_NAMES = ["web", "worker", "ws"] as const;
export const DEV_START_TIMEOUT_MS = 120_000;
export const GENERATED_WORKTREE_ENV_HEADER =
  "# Auto-generated for worktree by .agents/skills/worktree/cli/src/cli.ts.";
export const GENERATED_WORKTREE_ENV_NOTICE = "# Do not edit manually; re-run a worktree command to refresh it.";
export const WORKTREE_CLI_COMMAND = "bun .agents/skills/worktree/cli/src/cli.ts";
export const WORKTREE_START_LIMIT_ERROR =
  `You already have ${MAX_RUNNING_WORKTREE_WEB_PROCESSES} worktree web servers running, you cannot start another one, please talk to the user first for him to stop one of the worktrees`;
export type ProcessName = (typeof PROCESS_NAMES)[number];

let sharedStackRuntimeCache: SharedStackConfig | null = null;

export function printHelp(): void {
  console.log(`Usage: ${WORKTREE_CLI_COMMAND} <command>`);
  console.log("");
  console.log("Commands:");
  console.log("  create   Create or update the isolated worktree instance");
  console.log("  setup    Ensure shared Docker services are running, prepare the database, and start background processes");
  console.log("  start    Start or restart background processes for this worktree");
  console.log("  stop     Stop background processes for this worktree");
  console.log("  destroy  Stop processes, remove worktree resources, and remove local state");
  console.log("  docker-up    Ensure the shared Docker stack is running and provision worktree resources");
  console.log("  docker-down  No-op for shared observability; worktree Docker is no longer isolated");
  console.log("  dev      Start web, worker, and ws in the foreground");
  console.log("  status   Show the current worktree instance state");
  console.log("  processes  List running worktree processes and stop commands, including stop all");
  console.log("  cleanup  Stop orphaned worktree service processes under worktree roots");
  console.log("  env      Print derived environment variables for this worktree");
  console.log("  bootstrap-user  Copy source developer identity and integrations");
}

export function fail(message: string): never {
  console.error(`[worktree] ${message}`);
  process.exit(1);
}

export function runCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`
      }`,
    );
  }

  return result.stdout.trim();
}

export function resolveRepoRoot(): string {
  return runCommand("git", ["rev-parse", "--show-toplevel"], process.cwd());
}

export function resolveWorktreeEnvFile(repoRoot: string): string {
  return join(repoRoot, ".env");
}

export function isGeneratedWorktreeEnvFile(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  const content = readFileSync(path, "utf8");
  return content.startsWith(GENERATED_WORKTREE_ENV_HEADER);
}

export function resolveSharedEnvFile(repoRoot: string): string {
  const explicit = process.env.BAP_ENV_FILE?.trim();
  if (explicit && existsSync(explicit) && !isGeneratedWorktreeEnvFile(explicit)) {
    return explicit;
  }

  const directCandidate = join(repoRoot, ".env");
  if (existsSync(directCandidate) && !isGeneratedWorktreeEnvFile(directCandidate)) {
    return directCandidate;
  }

  const worktreeList = runCommand("git", ["worktree", "list", "--porcelain"], repoRoot);
  const worktreePaths = worktreeList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

  for (const worktreePath of worktreePaths) {
    const candidate = join(worktreePath, ".env");
    if (existsSync(candidate) && !isGeneratedWorktreeEnvFile(candidate)) {
      return candidate;
    }
  }

  fail(
    "Unable to find a shared .env file. Put one in the main checkout or another linked checkout, or set BAP_ENV_FILE to a non-generated env file.",
  );
}

export function loadSharedEnv(repoRoot: string): string {
  const envFile = resolveSharedEnvFile(repoRoot);
  const parsed = dotenv.parse(readFileSync(envFile, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  }

  return envFile;
}

export function readSharedEnvValues(repoRoot: string): Record<string, string> {
  const envFile = resolveSharedEnvFile(repoRoot);
  const parsed = dotenv.parse(readFileSync(envFile, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, process.env[key] ?? String(value)]),
  );
}

export function slugify(value: string, separator: "-" | "_" = "-"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, "g"), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, "g"), "");

  return normalized || "main";
}

export function buildInstanceId(repoRoot: string): string {
  const base = slugify(repoRoot.split("/").filter(Boolean).at(-1) ?? "bap");
  const hash = createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export function buildDatabaseName(instanceId: string): string {
  const prefix = "bap_";
  const suffix = slugify(instanceId, "_");
  const maxLength = 63;
  return `${prefix}${suffix}`.slice(0, maxLength);
}

export function buildDatabaseUser(instanceId: string): string {
  const prefix = "bap_";
  const suffix = slugify(`${instanceId}_user`, "_");
  return `${prefix}${suffix}`.slice(0, 63);
}

export function buildAppUrl(appPort: number): string {
  return `http://127.0.0.1:${appPort}`;
}

export function buildHealthCheckUrl(appUrl: string): string {
  return new URL("/api/dev/health", appUrl).toString();
}

export function buildLoopbackUrl(port: number, path = ""): string {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `http://127.0.0.1:${port}${suffix}`;
}

export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function isDatabaseConnectionError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND")
  );
}

export function buildQueueName(instanceId: string): string {
  return `bap-${slugify(instanceId)}`;
}

export function buildRedisNamespace(instanceId: string): string {
  return `instance:${slugify(instanceId)}:`;
}

export function buildRedisUser(instanceId: string): string {
  return `wt-${createHash("sha1").update(`${instanceId}:redis`).digest("hex").slice(0, 16)}`;
}

export function buildMinioBucketName(instanceId: string): string {
  return `bap-${slugify(instanceId)}`.slice(0, 63);
}

export function buildMinioAccessKeyId(instanceId: string): string {
  return `wt${createHash("sha1").update(`${instanceId}:minio`).digest("hex").slice(0, 18)}`;
}

export function generateCredentialSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export function buildDatabaseUrlForMetadata(metadata: Pick<InstanceMetadata, "databaseName" | "databaseUser" | "databasePassword">): string {
  const shared = resolveRuntimeSharedStackConfig();
  const url = new URL(buildPostgresBaseUrl(shared.postgresPort, metadata.databaseName));
  url.username = metadata.databaseUser;
  url.password = metadata.databasePassword;
  return url.toString();
}

export function clearSharedStackRuntimeCache(): void {
  sharedStackRuntimeCache = null;
}

export function resolveDockerComposeServiceContainerId(projectName: string, service: string): string | null {
  const result = spawnSync(
    "docker",
    [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

export function resolveDockerComposeServiceEnv(projectName: string, service: string): Record<string, string> {
  const containerId = resolveDockerComposeServiceContainerId(projectName, service);
  if (!containerId) {
    return {};
  }

  const result = spawnSync(
    "docker",
    ["inspect", containerId, "--format", "{{json .Config.Env}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return {};
  }

  try {
    const entries = JSON.parse(result.stdout.trim()) as unknown;
    if (!Array.isArray(entries)) {
      return {};
    }

    return Object.fromEntries(
      entries
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => {
          const separatorIndex = entry.indexOf("=");
          if (separatorIndex === -1) {
            return [entry, ""];
          }
          return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
        }),
    );
  } catch {
    return {};
  }
}

export function resolveDockerPublishedPort(projectName: string, service: string, containerPort: number): number | null {
  const containerId = resolveDockerComposeServiceContainerId(projectName, service);
  if (!containerId) {
    return null;
  }

  const result = spawnSync(
    "docker",
    ["inspect", containerId, "--format", "{{json .NetworkSettings.Ports}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  if (!output) {
    return null;
  }

  try {
    const ports = JSON.parse(output) as Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null | undefined
    >;
    const bindings = ports[`${containerPort}/tcp`];
    if (!Array.isArray(bindings) || bindings.length === 0) {
      return null;
    }

    const hostPort = bindings.find((binding) => binding.HostIp === "0.0.0.0")?.HostPort
      ?? bindings.find((binding) => binding.HostIp === "::")?.HostPort
      ?? bindings[0]?.HostPort;
    const parsed = Number.parseInt(hostPort ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveRuntimeSharedStackConfig(): SharedStackConfig {
  const base = buildSharedStackConfig();
  if (sharedStackRuntimeCache && sharedStackRuntimeCache.composeProjectName === base.composeProjectName) {
    return sharedStackRuntimeCache;
  }

  const resolved: SharedStackConfig = {
    ...base,
    postgresPort:
      resolveDockerPublishedPort(base.composeProjectName, "database", 5432) ?? base.postgresPort,
    redisPort:
      resolveDockerPublishedPort(base.composeProjectName, "redis", 6379) ?? base.redisPort,
    minioApiPort:
      resolveDockerPublishedPort(base.composeProjectName, "minio", 9000) ?? base.minioApiPort,
    minioConsolePort:
      resolveDockerPublishedPort(base.composeProjectName, "minio", 9001) ?? base.minioConsolePort,
    grafanaPort:
      resolveDockerPublishedPort(base.composeProjectName, "grafana", 3000) ?? base.grafanaPort,
    alertmanagerPort:
      resolveDockerPublishedPort(base.composeProjectName, "alertmanager", 9093) ?? base.alertmanagerPort,
  };

  sharedStackRuntimeCache = resolved;
  return resolved;
}

export function parseStackSlot(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99) {
    return null;
  }

  return value;
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function metadataPath(instanceRoot: string): string {
  return join(instanceRoot, "metadata.json");
}

export function processPath(instanceRoot: string): string {
  return join(instanceRoot, "processes.json");
}

export function logsDir(instanceRoot: string): string {
  return join(instanceRoot, "logs");
}

export function runtimeDir(instanceRoot: string): string {
  return join(instanceRoot, "runtime");
}

export function authArtifactsDir(instanceRoot: string): string {
  return join(runtimeDir(instanceRoot), "auth");
}

export function agentBrowserStatePath(instanceRoot: string): string {
  return join(authArtifactsDir(instanceRoot), "dev-user.storage-state.json");
}

export function agentBrowserSessionName(instanceId: string): string {
  return instanceId;
}

export function ensureParentDir(path: string): void {
  ensureDir(join(path, ".."));
}

export function profileSlugForServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname.toLowerCase();
    const port = url.port ? `-${url.port}` : "";
    return `${protocol}--${host}${port}`.replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return serverUrl.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  }
}

export function resolveCliProfilePath(serverUrl: string): string {
  const home = process.env.HOME;
  if (!home) {
    fail("HOME is not set, unable to persist CLI auth profile.");
  }

  return join(home, ".bap", "profiles", `chat-config.${profileSlugForServerUrl(serverUrl)}.json`);
}

export function saveCliProfile(serverUrl: string, token: string): void {
  const profilePath = resolveCliProfilePath(serverUrl);
  ensureParentDir(profilePath);
  writeFileSync(profilePath, `${JSON.stringify({ serverUrl, token }, null, 2)}\n`, "utf8");
}

export function expandPath(value: string, repoRoot: string): string {
  if (value.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) {
      fail(`Unable to expand ${value}: HOME is not set`);
    }
    return join(home, value.slice(2));
  }

  if (isAbsolute(value)) {
    return value;
  }

  return resolvePath(repoRoot, value);
}

export function resolveSharedWorktreeRootPath(): string {
  try {
    return resolveConfiguredSharedWorktreeRoot({
      cwd: process.cwd(),
      homeDir: process.env.HOME,
      explicitRoot: process.env.BAP_SHARED_WORKTREE_ROOT,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function resolveSharedWorktreeLocksPath(): string {
  return resolveSharedWorktreeLocksDir(resolveSharedWorktreeRootPath());
}

export function resolveSharedWorktreeInstancesPath(): string {
  return join(resolveSharedWorktreeRootPath(), "instances");
}

export function resolveSlotLeasePath(slot: number): string {
  return resolveSharedWorktreeSlotLeasePath(resolveSharedWorktreeRootPath(), slot);
}

export function buildPostgresBaseUrl(port: number, databaseName = "postgres"): string {
  const url = new URL("postgresql://127.0.0.1");
  url.username = "postgres";
  url.password = resolvePostgresPassword();
  url.port = String(port);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function resolvePostgresPassword(): string {
  const shared = buildSharedStackConfig();
  const containerPassword = resolveDockerComposeServiceEnv(
    shared.composeProjectName,
    "database",
  ).POSTGRES_PASSWORD?.trim();
  if (containerPassword) {
    return containerPassword;
  }

  return process.env.DATABASE_PASSWORD?.trim() || process.env.DB_PASSWORD?.trim() || "postgres";
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}
