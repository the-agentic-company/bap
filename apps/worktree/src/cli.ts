import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { Client as PgClient } from "pg";

import {
  buildWorktreeSlotLease,
  isWorktreeSlotLeaseFresh,
  isWorktreeSlotLeaseOwnedByInstance,
  refreshWorktreeSlotLease,
  resolveConfiguredSharedWorktreeRoot,
  resolveSharedWorktreeInstanceRoot,
  resolveSharedWorktreeLocksDir,
  resolveSharedWorktreeSlotLeasePath,
  type WorktreeSlotLease,
} from "./coordination";
import {
  buildDescendantPidSet,
  collectWorktreeProcessCleanupCandidates,
  isNextProcessCommand,
  type SystemProcess,
  type WorktreeProcessCleanupCandidate,
} from "./process-cleanup";
import {
  buildSharedStackConfig,
  buildWorktreeHostPorts,
  buildWorktreeStackConfig,
  formatWorktreeStackSlot,
  type SharedStackConfig,
  type WorktreeHostPort,
} from "./stack";
import {
  shouldBlockStartingWorktreeWeb,
  summarizeRunningWorktreeWebProcesses,
  MAX_RUNNING_WORKTREE_WEB_PROCESSES,
  type WorktreeWebProcessSnapshot,
} from "./start-guard";
import { buildWorktreePublicCallbackBaseUrl } from "../../../packages/core/src/lib/worktree-routing";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { Client } = require("pg") as typeof import("pg");
const { serializeSignedCookie } = require("better-call") as typeof import("better-call");
const dotenv = require("dotenv") as typeof import("dotenv");

type CommandName =
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

type InstanceMetadata = {
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

type InstanceProcesses = Partial<Record<"web" | "worker" | "ws", number>>;

type DerivedEnv = Record<string, string>;
type SlotPortState = WorktreeHostPort & {
  available: boolean;
  owner: string | null;
};

type SourceUserRecord = {
  id: string;
  email: string;
};

type SessionProfileRecord = {
  token: string;
  email: string;
  expiresAt: Date;
};

const COMMENTED_WORKTREE_ENV_KEYS = [
  "DAYTONA_API_PORT",
  "DAYTONA_PROXY_PORT",
  "DAYTONA_SSH_GATEWAY_PORT",
  "DAYTONA_DEX_PORT",
  "DAYTONA_API_URL",
  "DAYTONA_DB_VOLUME",
  "DAYTONA_DEX_VOLUME",
  "DAYTONA_REGISTRY_VOLUME",
] as const;

const DEFAULT_BASE_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres";
const PROCESS_NAMES = ["web", "worker", "ws"] as const;
const DEV_START_TIMEOUT_MS = 120_000;
const GENERATED_WORKTREE_ENV_HEADER = "# Auto-generated for worktree by apps/worktree/src/cli.ts.";
const GENERATED_WORKTREE_ENV_NOTICE = "# Do not edit manually; re-run a worktree command to refresh it.";
const WORKTREE_START_LIMIT_ERROR =
  `You already have ${MAX_RUNNING_WORKTREE_WEB_PROCESSES} worktree nextjs server running, you cannot start another one, please talk to the user first for him to stop one of the worktree`;
type ProcessName = (typeof PROCESS_NAMES)[number];

let sharedStackRuntimeCache: SharedStackConfig | null = null;

function printHelp(): void {
  console.log("Usage: bun run worktree <command>");
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

function fail(message: string): never {
  console.error(`[worktree] ${message}`);
  process.exit(1);
}

function runCommand(command: string, args: string[], cwd: string): string {
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

function resolveRepoRoot(): string {
  return runCommand("git", ["rev-parse", "--show-toplevel"], process.cwd());
}

function resolveWorktreeEnvFile(repoRoot: string): string {
  return join(repoRoot, ".env");
}

function isGeneratedWorktreeEnvFile(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  const content = readFileSync(path, "utf8");
  return content.startsWith(GENERATED_WORKTREE_ENV_HEADER);
}

function resolveSharedEnvFile(repoRoot: string): string {
  const explicit = process.env.CMDCLAW_ENV_FILE?.trim();
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
    "Unable to find a shared .env file. Put one in the main checkout or another linked checkout, or set CMDCLAW_ENV_FILE to a non-generated env file.",
  );
}

function loadSharedEnv(repoRoot: string): string {
  const envFile = resolveSharedEnvFile(repoRoot);
  const parsed = dotenv.parse(readFileSync(envFile, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  }

  return envFile;
}

function readSharedEnvValues(repoRoot: string): Record<string, string> {
  const envFile = resolveSharedEnvFile(repoRoot);
  const parsed = dotenv.parse(readFileSync(envFile, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, process.env[key] ?? String(value)]),
  );
}

function slugify(value: string, separator: "-" | "_" = "-"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, "g"), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, "g"), "");

  return normalized || "main";
}

function buildInstanceId(repoRoot: string): string {
  const base = slugify(repoRoot.split("/").filter(Boolean).at(-1) ?? "cmdclaw");
  const hash = createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function buildDatabaseName(instanceId: string): string {
  const prefix = "cmdclaw_";
  const suffix = slugify(instanceId, "_");
  const maxLength = 63;
  return `${prefix}${suffix}`.slice(0, maxLength);
}

function buildDatabaseUser(instanceId: string): string {
  const prefix = "cmdclaw_";
  const suffix = slugify(`${instanceId}_user`, "_");
  return `${prefix}${suffix}`.slice(0, 63);
}

function buildAppUrl(appPort: number): string {
  return `http://127.0.0.1:${appPort}`;
}

function buildHealthCheckUrl(appUrl: string): string {
  return new URL("/api/dev/health", appUrl).toString();
}

function buildLoopbackUrl(port: number, path = ""): string {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `http://127.0.0.1:${port}${suffix}`;
}

function redactConnectionString(connectionString: string): string {
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

function isDatabaseConnectionError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND")
  );
}

function buildQueueName(instanceId: string): string {
  return `cmdclaw-${slugify(instanceId)}`;
}

function buildRedisNamespace(instanceId: string): string {
  return `instance:${slugify(instanceId)}:`;
}

function buildRedisUser(instanceId: string): string {
  return `wt-${createHash("sha1").update(`${instanceId}:redis`).digest("hex").slice(0, 16)}`;
}

function buildMinioBucketName(instanceId: string): string {
  return `cmdclaw-${slugify(instanceId)}`.slice(0, 63);
}

function buildMinioAccessKeyId(instanceId: string): string {
  return `wt${createHash("sha1").update(`${instanceId}:minio`).digest("hex").slice(0, 18)}`;
}

function generateCredentialSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

function buildDatabaseUrlForMetadata(metadata: Pick<InstanceMetadata, "databaseName" | "databaseUser" | "databasePassword">): string {
  const shared = resolveRuntimeSharedStackConfig();
  const url = new URL(buildPostgresBaseUrl(shared.postgresPort, metadata.databaseName));
  url.username = metadata.databaseUser;
  url.password = metadata.databasePassword;
  return url.toString();
}

function clearSharedStackRuntimeCache(): void {
  sharedStackRuntimeCache = null;
}

function resolveDockerComposeServiceContainerId(projectName: string, service: string): string | null {
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

function resolveDockerPublishedPort(projectName: string, service: string, containerPort: number): number | null {
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

function resolveRuntimeSharedStackConfig(): SharedStackConfig {
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

function parseStackSlot(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99) {
    return null;
  }

  return value;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function metadataPath(instanceRoot: string): string {
  return join(instanceRoot, "metadata.json");
}

function processPath(instanceRoot: string): string {
  return join(instanceRoot, "processes.json");
}

function logsDir(instanceRoot: string): string {
  return join(instanceRoot, "logs");
}

function runtimeDir(instanceRoot: string): string {
  return join(instanceRoot, "runtime");
}

function authArtifactsDir(instanceRoot: string): string {
  return join(runtimeDir(instanceRoot), "auth");
}

function agentBrowserStatePath(instanceRoot: string): string {
  return join(authArtifactsDir(instanceRoot), "dev-user.storage-state.json");
}

function agentBrowserSessionName(instanceId: string): string {
  return instanceId;
}

function ensureParentDir(path: string): void {
  ensureDir(join(path, ".."));
}

function profileSlugForServerUrl(serverUrl: string): string {
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

function resolveCliProfilePath(serverUrl: string): string {
  const home = process.env.HOME;
  if (!home) {
    fail("HOME is not set, unable to persist CLI auth profile.");
  }

  return join(home, ".cmdclaw", "profiles", `chat-config.${profileSlugForServerUrl(serverUrl)}.json`);
}

function saveCliProfile(serverUrl: string, token: string): void {
  const profilePath = resolveCliProfilePath(serverUrl);
  ensureParentDir(profilePath);
  writeFileSync(profilePath, `${JSON.stringify({ serverUrl, token }, null, 2)}\n`, "utf8");
}

function expandPath(value: string, repoRoot: string): string {
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

function resolveSharedWorktreeRootPath(): string {
  try {
    return resolveConfiguredSharedWorktreeRoot({
      cwd: process.cwd(),
      homeDir: process.env.HOME,
      explicitRoot: process.env.CMDCLAW_SHARED_WORKTREE_ROOT,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function resolveSharedWorktreeLocksPath(): string {
  return resolveSharedWorktreeLocksDir(resolveSharedWorktreeRootPath());
}

function resolveSharedWorktreeInstancesPath(): string {
  return join(resolveSharedWorktreeRootPath(), "instances");
}

function resolveSlotLeasePath(slot: number): string {
  return resolveSharedWorktreeSlotLeasePath(resolveSharedWorktreeRootPath(), slot);
}

function resolveLegacyStateRoot(repoRoot: string): string {
  return join(repoRoot, ".worktrees");
}

function resolveLegacyInstanceRoot(repoRoot: string, instanceId: string): string {
  return join(resolveLegacyStateRoot(repoRoot), instanceId);
}

function resolveInstanceRootForRepoRoot(repoRoot: string): string {
  return resolveSharedWorktreeInstanceRoot(resolveSharedWorktreeRootPath(), buildInstanceId(repoRoot));
}

function pruneLegacyStateRootIfEmpty(repoRoot: string): void {
  const legacyStateRoot = resolveLegacyStateRoot(repoRoot);
  if (!existsSync(legacyStateRoot)) {
    return;
  }

  try {
    if (readdirSync(legacyStateRoot).length === 0) {
      rmSync(legacyStateRoot, { recursive: false, force: true });
    }
  } catch {
    // Leave the legacy directory in place if cleanup is not safe.
  }
}

function migrateLegacyInstanceRoot(repoRoot: string): string {
  const instanceId = buildInstanceId(repoRoot);
  const sharedInstanceRoot = resolveSharedWorktreeInstanceRoot(
    resolveSharedWorktreeRootPath(),
    instanceId,
  );
  const legacyInstanceRoot = resolveLegacyInstanceRoot(repoRoot, instanceId);

  if (!existsSync(legacyInstanceRoot)) {
    return sharedInstanceRoot;
  }

  if (existsSync(sharedInstanceRoot)) {
    rmSync(legacyInstanceRoot, { recursive: true, force: true });
    pruneLegacyStateRootIfEmpty(repoRoot);
    return sharedInstanceRoot;
  }

  ensureDir(resolveSharedWorktreeInstancesPath());
  try {
    renameSync(legacyInstanceRoot, sharedInstanceRoot);
  } catch {
    cpSync(legacyInstanceRoot, sharedInstanceRoot, { recursive: true });
    rmSync(legacyInstanceRoot, { recursive: true, force: true });
  }

  pruneLegacyStateRootIfEmpty(repoRoot);
  return sharedInstanceRoot;
}

function resolveRecognizedWorktreeRoots(): string[] {
  const configured = process.env.CMDCLAW_WORKTREE_STATUS_PATHS?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => expandPath(value, process.cwd()));
  }

  const home = process.env.HOME;
  if (!home) {
    return [];
  }

  return [join(home, ".codex", "worktrees")];
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function hasRecognizedWorktreePathSegment(repoRoot: string): boolean {
  const normalizedRepoRoot = normalizePath(repoRoot);
  return ["/.claude/worktrees/", "/.codex/worktrees/"].some((segment) =>
    normalizedRepoRoot.includes(segment),
  );
}

function isRecognizedWorktreeRepo(repoRoot: string): boolean {
  const normalizedRepoRoot = normalizePath(repoRoot);
  return (
    resolveRecognizedWorktreeRoots().some((root) => {
      const normalizedRoot = normalizePath(root);
      return (
        normalizedRepoRoot === normalizedRoot ||
        normalizedRepoRoot.startsWith(`${normalizedRoot}/`)
      );
    }) || hasRecognizedWorktreePathSegment(normalizedRepoRoot)
  );
}

function loadMetadata(instanceRoot: string): InstanceMetadata | null {
  const path = metadataPath(instanceRoot);
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8")) as InstanceMetadata;
}

function saveMetadata(metadata: InstanceMetadata): void {
  ensureDir(metadata.instanceRoot);
  writeFileSync(metadataPath(metadata.instanceRoot), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function loadProcesses(instanceRoot: string): InstanceProcesses {
  const path = processPath(instanceRoot);
  if (!existsSync(path)) {
    return {};
  }

  return JSON.parse(readFileSync(path, "utf8")) as InstanceProcesses;
}

function saveProcesses(instanceRoot: string, processes: InstanceProcesses): void {
  ensureDir(instanceRoot);
  writeFileSync(processPath(instanceRoot), `${JSON.stringify(processes, null, 2)}\n`, "utf8");
}

function removeProcessesFile(instanceRoot: string): void {
  const path = processPath(instanceRoot);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function loadSlotLease(slot: number): WorktreeSlotLease | null {
  const path = resolveSlotLeasePath(slot);
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8")) as WorktreeSlotLease;
}

function writeSlotLease(lease: WorktreeSlotLease, mode: "create" | "update"): boolean {
  ensureDir(resolveSharedWorktreeLocksPath());

  try {
    writeFileSync(resolveSlotLeasePath(lease.slot), `${JSON.stringify(lease, null, 2)}\n`, {
      encoding: "utf8",
      flag: mode === "create" ? "wx" : "w",
    });
    return true;
  } catch (error) {
    if (
      mode === "create" &&
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return false;
    }

    throw error;
  }
}

function removeSlotLease(
  slot: number,
  owner?: {
    instanceId: string;
    repoRoot: string;
  },
): void {
  const path = resolveSlotLeasePath(slot);
  if (!existsSync(path)) {
    return;
  }

  if (owner) {
    const lease = loadSlotLease(slot);
    if (lease && !isWorktreeSlotLeaseOwnedByInstance(lease, owner)) {
      return;
    }
  }

  unlinkSync(path);
}

function hydrateMetadataCredentials(metadata: InstanceMetadata): InstanceMetadata {
  const databaseUser = metadata.databaseUser || buildDatabaseUser(metadata.instanceId);
  const databasePassword = metadata.databasePassword || generateCredentialSecret();
  const redisUser = metadata.redisUser || buildRedisUser(metadata.instanceId);
  const redisPassword = metadata.redisPassword || generateCredentialSecret();
  const minioBucketName = metadata.minioBucketName || buildMinioBucketName(metadata.instanceId);
  const minioAccessKeyId = metadata.minioAccessKeyId || buildMinioAccessKeyId(metadata.instanceId);
  const minioSecretAccessKey = metadata.minioSecretAccessKey || generateCredentialSecret();

  return {
    ...metadata,
    databaseUser,
    databasePassword,
    databaseUrl: buildDatabaseUrlForMetadata({
      databaseName: metadata.databaseName,
      databaseUser,
      databasePassword,
    }),
    redisUser,
    redisPassword,
    minioBucketName,
    minioAccessKeyId,
    minioSecretAccessKey,
  };
}

function buildAppPorts(stackSlot: number): { appPort: number; wsPort: number } {
  return {
    appPort: 3700 + stackSlot,
    wsPort: 4700 + stackSlot,
  };
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    let finished = false;

    const finish = (value: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(value);
    };

    server.unref();
    server.once("error", () => {
      finish(false);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        finish(error == null);
      });
    });
  });
}

function describeDockerPortOwner(port: number): string | null {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const owner = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return owner ? `docker:${owner}` : null;
}

function describeListeningPortOwner(port: number): string | null {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return null;
  }

  const line = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)[1];

  if (!line) {
    return null;
  }

  const [command, pid, user] = line.split(/\s+/);
  if (!command) {
    return null;
  }

  const details = [
    pid ? `pid=${pid}` : null,
    user ? `user=${user}` : null,
  ].filter(Boolean);

  return details.length > 0 ? `${command} ${details.join(" ")}` : command;
}

function describePortOwner(port: number): string | null {
  return describeDockerPortOwner(port) ?? describeListeningPortOwner(port);
}

async function resolveSlotPortState(slot: number): Promise<SlotPortState[]> {
  const assignments = buildWorktreeHostPorts(slot);
  return await Promise.all(
    assignments.map(async (assignment) => {
      const available = await isPortAvailable(assignment.port);
      return {
        ...assignment,
        available,
        owner: available ? null : describePortOwner(assignment.port),
      };
    }),
  );
}

async function resolveSlotConflicts(slot: number): Promise<SlotPortState[]> {
  return (await resolveSlotPortState(slot)).filter((entry) => !entry.available);
}

function formatSlotConflict(conflict: SlotPortState): string {
  return `${conflict.name}:${conflict.port}${conflict.owner ? ` (${conflict.owner})` : ""}`;
}

function listDockerProjectContainers(metadata: InstanceMetadata): string[] {
  void metadata;
  return [];
}

function hasRunningTrackedProcesses(metadata: InstanceMetadata): boolean {
  return getProcessEntries(metadata).some((entry) => isPidRunning(entry.pid));
}

function isSlotActivelyOwnedByInstance(metadata: InstanceMetadata): boolean {
  return hasRunningTrackedProcesses(metadata) || listDockerProjectContainers(metadata).length > 0;
}

function isSlotLeaseStale(lease: WorktreeSlotLease): boolean {
  const ownerMetadata = loadMetadataForRepoRoot(lease.repoRoot);
  if (
    ownerMetadata &&
    ownerMetadata.instanceId === lease.instanceId &&
    ownerMetadata.stackSlot === lease.slot
  ) {
    return false;
  }

  return !isWorktreeSlotLeaseFresh(lease);
}

async function canUseReservedSlot(slot: number, existing: InstanceMetadata | null): Promise<boolean> {
  const conflicts = await resolveSlotConflicts(slot);
  if (conflicts.length === 0) {
    return true;
  }

  return existing?.stackSlot === slot && isSlotActivelyOwnedByInstance(existing);
}

type SlotReservationAttempt =
  | { status: "reserved" }
  | { status: "busy"; reason: string };

async function tryReserveStackSlot(
  repoRoot: string,
  slot: number,
  existing: InstanceMetadata | null,
): Promise<SlotReservationAttempt> {
  const owner = {
    instanceId: buildInstanceId(repoRoot),
    repoRoot,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = loadSlotLease(slot);
    if (!lease) {
      const createdLease = buildWorktreeSlotLease({
        slot,
        instanceId: owner.instanceId,
        repoRoot: owner.repoRoot,
      });
      if (!writeSlotLease(createdLease, "create")) {
        continue;
      }

      if (!(await canUseReservedSlot(slot, existing))) {
        removeSlotLease(slot, owner);
        const conflicts = await resolveSlotConflicts(slot);
        return {
          status: "busy",
          reason:
            conflicts.length > 0
              ? conflicts.map(formatSlotConflict).join(", ")
              : "the slot ports are already in use",
        };
      }

      return { status: "reserved" };
    }

    if (isWorktreeSlotLeaseOwnedByInstance(lease, owner)) {
      writeSlotLease(refreshWorktreeSlotLease(lease), "update");

      if (!(await canUseReservedSlot(slot, existing))) {
        const conflicts = await resolveSlotConflicts(slot);
        return {
          status: "busy",
          reason:
            conflicts.length > 0
              ? conflicts.map(formatSlotConflict).join(", ")
              : "the slot ports are already in use",
        };
      }

      return { status: "reserved" };
    }

    if (!isSlotLeaseStale(lease)) {
      return {
        status: "busy",
        reason: `lease held by ${lease.instanceId} (${lease.repoRoot})`,
      };
    }

    try {
      removeSlotLease(slot, {
        instanceId: lease.instanceId,
        repoRoot: lease.repoRoot,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return {
    status: "busy",
    reason: "the slot lease changed while attempting to claim it",
  };
}

async function reserveStackSlot(
  repoRoot: string,
  existing: InstanceMetadata | null,
  options?: {
    excludedSlots?: Set<number>;
    preferredSlot?: number | null;
  },
): Promise<{ slot: number; previousSlot: number | null; reason: string | null }> {
  const excludedSlots = options?.excludedSlots ?? new Set<number>();
  const preferredSlot = options?.preferredSlot ?? parseStackSlot(existing?.stackSlot);
  let preferredReason: string | null = null;

  if (preferredSlot !== null && !excludedSlots.has(preferredSlot)) {
    const preferred = await tryReserveStackSlot(repoRoot, preferredSlot, existing);
    if (preferred.status === "reserved") {
      return {
        slot: preferredSlot,
        previousSlot: null,
        reason: null,
      };
    }

    preferredReason = preferred.reason;
  }

  for (let slot = 1; slot <= 99; slot += 1) {
    if (slot === preferredSlot || excludedSlots.has(slot)) {
      continue;
    }

    const reserved = await tryReserveStackSlot(repoRoot, slot, existing);
    if (reserved.status === "reserved") {
      return {
        slot,
        previousSlot: preferredSlot,
        reason: preferredReason,
      };
    }
  }

  fail("Unable to allocate a free two-digit worktree stack slot");
}

function deriveDatabaseUrl(baseDatabaseUrl: string, databaseName: string): string {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function resolvePostgresPassword(): string {
  return process.env.DATABASE_PASSWORD?.trim() || process.env.DB_PASSWORD?.trim() || "postgres";
}

function resolveSharedRedisAdminPassword(): string {
  return process.env.CMDCLAW_SHARED_REDIS_ADMIN_PASSWORD?.trim() || "cmdclaw-redis-admin";
}

function resolveSharedMinioRootCredentials(): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY_ID?.trim() || "minioadmin",
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
      process.env.S3_SECRET_ACCESS_KEY?.trim() ||
      "minioadmin",
  };
}

function buildPostgresBaseUrl(port: number, databaseName = "postgres"): string {
  const url = new URL("postgresql://127.0.0.1");
  url.username = "postgres";
  url.password = resolvePostgresPassword();
  url.port = String(port);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function buildPostgresAdminUrl(metadata: InstanceMetadata): string {
  return buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort);
}

async function withAdminClient<T>(
  connectionString: string,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      fail(
        `database is unavailable at ${redactConnectionString(connectionString)}. Run 'bun run worktree:setup' to start the Docker stack and retry.`,
      );
    }
    throw error;
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withClient<T>(connectionString: string, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureDatabase(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    const existing = await client.query("select 1 from pg_database where datname = $1", [
      metadata.databaseName,
    ]);

    if (existing.rowCount === 0) {
      await client.query(`create database ${quoteIdentifier(metadata.databaseName)}`);
      console.log(`[worktree] created database ${metadata.databaseName}`);
    }
  });
}

async function ensureDatabaseRole(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    const existing = await client.query("select 1 from pg_roles where rolname = $1", [
      metadata.databaseUser,
    ]);

    if (existing.rowCount === 0) {
      await client.query(
        `create role ${quoteIdentifier(metadata.databaseUser)} login password '${metadata.databasePassword.replaceAll("'", "''")}'`,
      );
      console.log(`[worktree] created postgres role ${metadata.databaseUser}`);
    } else {
      await client.query(
        `alter role ${quoteIdentifier(metadata.databaseUser)} with login password '${metadata.databasePassword.replaceAll("'", "''")}'`,
      );
    }

    await client.query(`revoke all on database ${quoteIdentifier(metadata.databaseName)} from public`);
    await client.query(
      `grant all privileges on database ${quoteIdentifier(metadata.databaseName)} to ${quoteIdentifier(metadata.databaseUser)}`,
    );
    await client.query(
      `alter database ${quoteIdentifier(metadata.databaseName)} owner to ${quoteIdentifier(metadata.databaseUser)}`,
    );
  });

  await withAdminClient(
    buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort, metadata.databaseName),
    async (client) => {
      await client.query(`revoke all on schema public from public`);
      await client.query(
        `grant all on schema public to ${quoteIdentifier(metadata.databaseUser)}`,
      );
      await client.query(
        `alter schema public owner to ${quoteIdentifier(metadata.databaseUser)}`,
      );
    },
  );
}

async function ensureDatabaseExtensions(metadata: InstanceMetadata): Promise<void> {
  await withAdminClient(
    buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort, metadata.databaseName),
    async (client) => {
      await client.query("create extension if not exists vector");
    },
  );
}

async function dropDatabase(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    await client.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [metadata.databaseName],
    );
    await client.query(`drop database if exists ${quoteIdentifier(metadata.databaseName)}`);
  });
  console.log(`[worktree] dropped database ${metadata.databaseName}`);
}

async function dropDatabaseRole(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    await client.query(`drop role if exists ${quoteIdentifier(metadata.databaseUser)}`);
  });
  console.log(`[worktree] dropped postgres role ${metadata.databaseUser}`);
}

function buildMinioPolicyName(instanceId: string): string {
  return `wt-${createHash("sha1").update(`${instanceId}:minio-policy`).digest("hex").slice(0, 16)}`;
}

async function ensureRedisAclUser(metadata: InstanceMetadata): Promise<void> {
  const bullQueuePattern = `bull:${metadata.queueName}*`;
  runSharedServiceCommand(metadata.repoRoot, "redis", [
    "redis-cli",
    "-a",
    resolveSharedRedisAdminPassword(),
    "ACL",
    "SETUSER",
    metadata.redisUser,
    "reset",
    "on",
    `>${metadata.redisPassword}`,
    `~${metadata.redisNamespace}*`,
    `~${bullQueuePattern}`,
    `&${metadata.redisNamespace}*`,
    `&${bullQueuePattern}`,
    "+@all",
  ]);
  console.log(`[worktree] ensured redis ACL user ${metadata.redisUser}`);
}

async function dropRedisAclUser(metadata: InstanceMetadata): Promise<void> {
  runSharedServiceCommand(
    metadata.repoRoot,
    "redis",
    ["redis-cli", "-a", resolveSharedRedisAdminPassword(), "ACL", "DELUSER", metadata.redisUser],
    { allowFailure: true },
  );
  console.log(`[worktree] dropped redis ACL user ${metadata.redisUser}`);
}

async function ensureMinioTenant(metadata: InstanceMetadata): Promise<void> {
  const rootCredentials = resolveSharedMinioRootCredentials();
  const policyName = buildMinioPolicyName(metadata.instanceId);
  const policyDocument = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetBucketLocation", "s3:ListBucket"],
          Resource: [`arn:aws:s3:::${metadata.minioBucketName}`],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: [`arn:aws:s3:::${metadata.minioBucketName}/*`],
        },
      ],
    },
    null,
    2,
  );

  const script = [
    `mc alias set local http://127.0.0.1:9000 ${JSON.stringify(rootCredentials.accessKeyId)} ${JSON.stringify(rootCredentials.secretAccessKey)} >/dev/null`,
    `mc mb --ignore-existing local/${metadata.minioBucketName} >/dev/null`,
    `mc admin user remove local ${metadata.minioAccessKeyId} >/dev/null 2>&1 || true`,
    `mc admin policy remove local ${policyName} >/dev/null 2>&1 || true`,
    `cat <<'EOF' > /tmp/${policyName}.json`,
    policyDocument,
    "EOF",
    `mc admin policy create local ${policyName} /tmp/${policyName}.json >/dev/null`,
    `mc admin user add local ${metadata.minioAccessKeyId} ${JSON.stringify(metadata.minioSecretAccessKey)} >/dev/null`,
    `mc admin policy attach local ${policyName} --user ${metadata.minioAccessKeyId} >/dev/null`,
  ].join("\n");

  runSharedServiceCommand(metadata.repoRoot, "minio", ["sh", "-lc", script]);
  console.log(`[worktree] ensured minio bucket ${metadata.minioBucketName}`);
}

async function dropMinioTenant(metadata: InstanceMetadata): Promise<void> {
  const rootCredentials = resolveSharedMinioRootCredentials();
  const policyName = buildMinioPolicyName(metadata.instanceId);
  const script = [
    `mc alias set local http://127.0.0.1:9000 ${JSON.stringify(rootCredentials.accessKeyId)} ${JSON.stringify(rootCredentials.secretAccessKey)} >/dev/null`,
    `mc rm --recursive --force local/${metadata.minioBucketName} >/dev/null 2>&1 || true`,
    `mc rb --force local/${metadata.minioBucketName} >/dev/null 2>&1 || true`,
    `mc admin user remove local ${metadata.minioAccessKeyId} >/dev/null 2>&1 || true`,
    `mc admin policy remove local ${policyName} >/dev/null 2>&1 || true`,
  ].join("\n");

  runSharedServiceCommand(metadata.repoRoot, "minio", ["sh", "-lc", script], { allowFailure: true });
  console.log(`[worktree] removed minio bucket ${metadata.minioBucketName}`);
}

function buildDerivedEnv(metadata: InstanceMetadata): DerivedEnv {
  const instanceRuntimeDir = runtimeDir(metadata.instanceRoot);
  const instanceAppUrl = metadata.appUrl;
  const sharedStack = resolveRuntimeSharedStackConfig();
  const databaseUrl = new URL(buildDatabaseUrlForMetadata(metadata));

  return {
    PORT: String(metadata.appPort),
    WS_PORT: String(metadata.wsPort),
    APP_URL: instanceAppUrl,
    VITE_APP_URL: instanceAppUrl,
    E2B_CALLBACK_BASE_URL: buildWorktreePublicCallbackBaseUrl({
      instanceId: metadata.instanceId,
      callbackBaseUrl: process.env.E2B_CALLBACK_BASE_URL,
      appUrl: process.env.APP_URL,
      viteAppUrl: process.env.VITE_APP_URL,
      nodeEnv: process.env.NODE_ENV,
    }),
    CMDCLAW_SERVER_URL: instanceAppUrl,
    PLAYWRIGHT_PORT: String(metadata.appPort),
    PLAYWRIGHT_BASE_URL: instanceAppUrl,
    E2E_AUTH_STATE_PATH: join(instanceRuntimeDir, "playwright", "user.json"),
    DATABASE_URL: databaseUrl.toString(),
    DATABASE_PASSWORD: metadata.databasePassword,
    DB_PASSWORD: metadata.databasePassword,
    REDIS_URL: `redis://${encodeURIComponent(metadata.redisUser)}:${encodeURIComponent(metadata.redisPassword)}@127.0.0.1:${sharedStack.redisPort}/0`,
    AWS_ENDPOINT_URL: `http://127.0.0.1:${sharedStack.minioApiPort}`,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    AWS_ACCESS_KEY_ID: metadata.minioAccessKeyId,
    AWS_SECRET_ACCESS_KEY: metadata.minioSecretAccessKey,
    AWS_S3_BUCKET_NAME: metadata.minioBucketName,
    AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE ?? "true",
    BULLMQ_QUEUE_NAME: metadata.queueName,
    CMDCLAW_INSTANCE_ID: metadata.instanceId,
    CMDCLAW_INSTANCE_ROOT: metadata.instanceRoot,
    CMDCLAW_REDIS_NAMESPACE: metadata.redisNamespace,
    CMDCLAW_WORKTREE_ID: metadata.instanceId,
    CMDCLAW_WORKTREE_SLOT: formatWorktreeStackSlot(metadata.stackSlot),
    CMDCLAW_COMPOSE_PROJECT: sharedStack.composeProjectName,
    COMPOSE_PROJECT_NAME: sharedStack.composeProjectName,
    CMDCLAW_POSTGRES_PORT: String(sharedStack.postgresPort),
    CMDCLAW_REDIS_PORT: String(sharedStack.redisPort),
    CMDCLAW_MINIO_API_PORT: String(sharedStack.minioApiPort),
    CMDCLAW_MINIO_CONSOLE_PORT: String(sharedStack.minioConsolePort),
    CMDCLAW_OTEL_GRPC_PORT: String(sharedStack.vectorOtelGrpcPort),
    CMDCLAW_OTEL_HTTP_PORT: String(sharedStack.vectorOtelHttpPort),
    CMDCLAW_VECTOR_OTLP_GRPC_PORT: String(sharedStack.vectorOtelGrpcPort),
    CMDCLAW_VECTOR_OTLP_HTTP_PORT: String(sharedStack.vectorOtelHttpPort),
    CMDCLAW_VECTOR_TRACES_PORT: String(sharedStack.vectorTracePort),
    CMDCLAW_VECTOR_LOG_PORT: String(sharedStack.vectorLogPort),
    CMDCLAW_VECTOR_LOG_URL: `http://127.0.0.1:${sharedStack.vectorLogPort}/logs`,
    CMDCLAW_VECTOR_METRICS_URL: `http://127.0.0.1:${sharedStack.vectorOtelHttpPort}/v1/metrics`,
    CMDCLAW_VECTOR_TRACES_URL: `http://127.0.0.1:${sharedStack.vectorTracePort}/v1/traces`,
    CMDCLAW_VICTORIA_METRICS_PORT: String(sharedStack.victoriaMetricsPort),
    CMDCLAW_VICTORIA_LOGS_PORT: String(sharedStack.victoriaLogsPort),
    CMDCLAW_VICTORIA_TRACES_PORT: String(sharedStack.victoriaTracesPort),
    CMDCLAW_VICTORIA_METRICS_URL: `http://127.0.0.1:${sharedStack.victoriaMetricsPort}`,
    CMDCLAW_VICTORIA_LOGS_URL: `http://127.0.0.1:${sharedStack.victoriaLogsPort}`,
    CMDCLAW_VICTORIA_TRACES_URL: `http://127.0.0.1:${sharedStack.victoriaTracesPort}`,
    CMDCLAW_ALERTMANAGER_PORT: String(sharedStack.alertmanagerPort),
    CMDCLAW_VMALERT_PORT: String(sharedStack.vmalertPort),
    CMDCLAW_GRAFANA_PORT: String(sharedStack.grafanaPort),
    CMDCLAW_POSTGRES_VOLUME: sharedStack.postgresVolume,
    CMDCLAW_REDIS_VOLUME: sharedStack.redisVolume,
    CMDCLAW_MINIO_VOLUME: sharedStack.minioVolume,
    CMDCLAW_VICTORIA_METRICS_VOLUME: sharedStack.victoriaMetricsVolume,
    CMDCLAW_VICTORIA_LOGS_VOLUME: sharedStack.victoriaLogsVolume,
    CMDCLAW_VICTORIA_TRACES_VOLUME: sharedStack.victoriaTracesVolume,
    CMDCLAW_ALERTMANAGER_VOLUME: sharedStack.alertmanagerVolume,
    CMDCLAW_GRAFANA_VOLUME: sharedStack.grafanaVolume,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port,
    PGDATABASE: databaseUrl.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    AGENT_BROWSER_SESSION: agentBrowserSessionName(metadata.instanceId),
  };
}

function buildCommentedWorktreeEnv(metadata: InstanceMetadata): Record<(typeof COMMENTED_WORKTREE_ENV_KEYS)[number], string> {
  const stack = buildWorktreeStackConfig(metadata.instanceId, metadata.stackSlot);

  return {
    DAYTONA_API_PORT: String(stack.daytonaApiPort),
    DAYTONA_PROXY_PORT: String(stack.daytonaProxyPort),
    DAYTONA_SSH_GATEWAY_PORT: String(stack.daytonaSshGatewayPort),
    DAYTONA_DEX_PORT: String(stack.daytonaDexPort),
    DAYTONA_API_URL: `http://127.0.0.1:${stack.daytonaApiPort}/api`,
    DAYTONA_DB_VOLUME: stack.daytonaDbVolume,
    DAYTONA_DEX_VOLUME: stack.daytonaDexVolume,
    DAYTONA_REGISTRY_VOLUME: stack.daytonaRegistryVolume,
  };
}

function buildWorktreeRuntimeEnv(metadata: InstanceMetadata): DerivedEnv {
  return {
    ...readSharedEnvValues(metadata.repoRoot),
    ...buildDerivedEnv(metadata),
  };
}

function buildSharedComposeEnv(repoRoot: string): NodeJS.ProcessEnv {
  const shared = buildSharedStackConfig();
  return {
    ...process.env,
    ...readSharedEnvValues(repoRoot),
    CMDCLAW_COMPOSE_PROJECT: shared.composeProjectName,
    COMPOSE_PROJECT_NAME: shared.composeProjectName,
    CMDCLAW_POSTGRES_PORT: String(shared.postgresPort),
    CMDCLAW_REDIS_PORT: String(shared.redisPort),
    CMDCLAW_MINIO_API_PORT: String(shared.minioApiPort),
    CMDCLAW_MINIO_CONSOLE_PORT: String(shared.minioConsolePort),
    CMDCLAW_GRAFANA_PORT: String(shared.grafanaPort),
    CMDCLAW_ALERTMANAGER_PORT: String(shared.alertmanagerPort),
    CMDCLAW_VECTOR_OTLP_GRPC_PORT: String(shared.vectorOtelGrpcPort),
    CMDCLAW_VECTOR_OTLP_HTTP_PORT: String(shared.vectorOtelHttpPort),
    CMDCLAW_VECTOR_TRACES_PORT: String(shared.vectorTracePort),
    CMDCLAW_VECTOR_LOG_PORT: String(shared.vectorLogPort),
    CMDCLAW_VICTORIA_METRICS_PORT: String(shared.victoriaMetricsPort),
    CMDCLAW_VICTORIA_LOGS_PORT: String(shared.victoriaLogsPort),
    CMDCLAW_VICTORIA_TRACES_PORT: String(shared.victoriaTracesPort),
    CMDCLAW_VMALERT_PORT: String(shared.vmalertPort),
    CMDCLAW_POSTGRES_VOLUME: shared.postgresVolume,
    CMDCLAW_REDIS_VOLUME: shared.redisVolume,
    CMDCLAW_MINIO_VOLUME: shared.minioVolume,
    CMDCLAW_GRAFANA_VOLUME: shared.grafanaVolume,
    CMDCLAW_ALERTMANAGER_VOLUME: shared.alertmanagerVolume,
    CMDCLAW_VICTORIA_METRICS_VOLUME: shared.victoriaMetricsVolume,
    CMDCLAW_VICTORIA_LOGS_VOLUME: shared.victoriaLogsVolume,
    CMDCLAW_VICTORIA_TRACES_VOLUME: shared.victoriaTracesVolume,
  };
}

function runInheritedCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit ${result.status ?? 1}`);
  }
}

function ensureDockerDaemonAvailable(): void {
  const whichResult = spawnSync("docker", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (whichResult.status !== 0) {
    fail("cannot start worktree because Docker is not installed or not on PATH");
  }

  const infoResult = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (infoResult.status !== 0) {
    const output = infoResult.stderr?.trim() || infoResult.stdout?.trim();
    fail(
      `cannot start worktree because Docker is not running${
        output ? `: ${output}` : ""
      }`,
    );
  }
}

function isDockerInstalled(): boolean {
  const result = spawnSync("docker", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0;
}

function isDockerDaemonReachable(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0;
}

function printStatusEndpoints(metadata: InstanceMetadata): void {
  const sharedStack = resolveRuntimeSharedStackConfig();
  const databaseUrl = new URL(buildDatabaseUrlForMetadata(metadata));

  console.log(`[worktree] shared docker project ${sharedStack.composeProjectName}`);
  console.log(`[worktree] app ${metadata.appUrl}`);
  console.log(`[worktree] health ${buildHealthCheckUrl(metadata.appUrl)}`);
  console.log(
    `[worktree] postgres ${databaseUrl.hostname}:${databaseUrl.port}/${databaseUrl.pathname.replace(/^\//, "")}`,
  );
  console.log(`[worktree] redis redis://127.0.0.1:${sharedStack.redisPort}`);
  console.log(`[worktree] minio api ${buildLoopbackUrl(sharedStack.minioApiPort)}`);
  console.log(`[worktree] minio console ${buildLoopbackUrl(sharedStack.minioConsolePort)}`);
  console.log(`[worktree] metrics ${buildLoopbackUrl(sharedStack.victoriaMetricsPort)}`);
  console.log(`[worktree] logs ${buildLoopbackUrl(sharedStack.victoriaLogsPort)}`);
  console.log(`[worktree] traces ${buildLoopbackUrl(sharedStack.victoriaTracesPort)}`);
  console.log(`[worktree] grafana ${buildLoopbackUrl(sharedStack.grafanaPort)}`);
  console.log(`[worktree] alertmanager ${buildLoopbackUrl(sharedStack.alertmanagerPort)}`);
  console.log(`[worktree] vmalert ${buildLoopbackUrl(sharedStack.vmalertPort)}`);
  console.log(`[worktree] otel grpc 127.0.0.1:${sharedStack.vectorOtelGrpcPort}`);
  console.log(`[worktree] otel http ${buildLoopbackUrl(sharedStack.vectorOtelHttpPort)}`);
  console.log(
    `[worktree] vector traces ${buildLoopbackUrl(sharedStack.vectorTracePort, "/v1/traces")}`,
  );
  console.log(`[worktree] vector logs ${buildLoopbackUrl(sharedStack.vectorLogPort, "/logs")}`);
  console.log(`[worktree] env file ${resolveWorktreeEnvFile(metadata.repoRoot)}`);
}

function isDockerPortAllocationFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("port is already allocated") || normalized.includes("bind for 0.0.0.0:");
}

async function ensureWorktreeDockerStackUp(metadata: InstanceMetadata): Promise<InstanceMetadata> {
  return metadata;
}

function runSharedServiceCommand(
  repoRoot: string,
  service: string,
  command: string[],
  options?: { input?: string; allowFailure?: boolean },
): string {
  const env = buildSharedComposeEnv(repoRoot);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      resolveSharedEnvFile(repoRoot),
      "-p",
      env.CMDCLAW_COMPOSE_PROJECT ?? buildSharedStackConfig().composeProjectName,
      "-f",
      "docker/compose/dev.yml",
      "exec",
      "-T",
      service,
      ...command,
    ],
    {
      cwd: repoRoot,
      env,
      input: options?.input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.status !== 0 && !options?.allowFailure) {
    fail(
      `docker compose exec ${service} ${command.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`
      }`,
    );
  }

  return result.stdout.trim();
}

function isDockerComposeServiceRunning(projectName: string, service: string): boolean {
  const result = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
      "--format",
      "{{.Names}}",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    return false;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(Boolean);
}

function ensureSharedInfraRunning(repoRoot: string): void {
  const env = buildSharedComposeEnv(repoRoot);
  const projectName = env.CMDCLAW_COMPOSE_PROJECT ?? buildSharedStackConfig().composeProjectName;
  const services = [
    "database",
    "redis",
    "minio",
    "victoria-metrics",
    "victoria-logs",
    "victoria-traces",
    "vector",
    "alertmanager",
    "vmalert",
    "grafana",
  ];
  const missingServices = services.filter((service) => !isDockerComposeServiceRunning(projectName, service));

  if (missingServices.length === 0) {
    return;
  }

  runInheritedCommand(
    "docker",
    [
      "compose",
      "--env-file",
      resolveSharedEnvFile(repoRoot),
      "-p",
      projectName,
      "-f",
      "docker/compose/dev.yml",
      "up",
      "-d",
      "--no-deps",
      ...missingServices,
    ],
    repoRoot,
    env,
  );
  clearSharedStackRuntimeCache();
}

function listDockerProjectContainerIds(metadata: InstanceMetadata): string[] {
  void metadata;
  return [];
}

function teardownDockerResources(metadata: InstanceMetadata): void {
  void metadata;
}

async function dockerUpInstance(): Promise<void> {
  const metadata = await resolveMetadata();
  ensureDockerDaemonAvailable();
  ensureSharedInfraRunning(metadata.repoRoot);
  await waitForDatabaseReady(buildPostgresAdminUrl(metadata), DEV_START_TIMEOUT_MS);
  await ensureDatabase(metadata);
  await ensureDatabaseExtensions(metadata);
  await ensureDatabaseRole(metadata);
  await ensureRedisAclUser(metadata);
  await ensureMinioTenant(metadata);
  console.log("[worktree] shared docker stack ready");
  printStatusEndpoints(metadata);
}

async function dockerDownInstance(): Promise<void> {
  await resolveMetadata();
  console.log("[worktree] shared observability is managed globally; nothing worktree-scoped to stop");
}

function resolveSourceRepoRoot(targetRepoRoot: string): string | null {
  const explicit =
    process.env.CMDCLAW_WORKTREE_SOURCE_TREE_PATH?.trim() || process.env.CODEX_SOURCE_TREE_PATH?.trim();
  if (explicit && explicit !== targetRepoRoot) {
    return explicit;
  }

  const worktreeList = runCommand("git", ["worktree", "list", "--porcelain"], targetRepoRoot);
  const blocks = worktreeList
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  let fallback: string | null = null;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim());
    const worktree = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
    if (!worktree || worktree === targetRepoRoot) {
      continue;
    }
    if (branch === "refs/heads/main") {
      return worktree;
    }
    fallback ??= worktree;
  }

  return fallback;
}

function loadMetadataForRepoRoot(repoRoot: string): InstanceMetadata | null {
  const instanceRoot = resolveInstanceRootForRepoRoot(repoRoot);
  const legacyInstanceRoot = resolveLegacyInstanceRoot(repoRoot, buildInstanceId(repoRoot));
  if (!existsSync(instanceRoot) && existsSync(legacyInstanceRoot)) {
    migrateLegacyInstanceRoot(repoRoot);
  }
  return loadMetadata(instanceRoot);
}

function loadProcessesForRepoRoot(repoRoot: string): InstanceProcesses {
  const instanceRoot = resolveInstanceRootForRepoRoot(repoRoot);
  const legacyInstanceRoot = resolveLegacyInstanceRoot(repoRoot, buildInstanceId(repoRoot));
  if (!existsSync(instanceRoot) && existsSync(legacyInstanceRoot)) {
    migrateLegacyInstanceRoot(repoRoot);
  }
  return loadProcesses(instanceRoot);
}

function listLinkedRepoRoots(repoRoot: string): string[] {
  const worktreeList = runCommand("git", ["worktree", "list", "--porcelain"], repoRoot);
  const repoRoots = worktreeList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => normalizePath(line.slice("worktree ".length)));

  return Array.from(new Set(repoRoots));
}

function buildWorktreeWebProcessSnapshots(currentRepoRoot: string): WorktreeWebProcessSnapshot[] {
  return listLinkedRepoRoots(currentRepoRoot).map((repoRoot) => {
    const recognized = isRecognizedWorktreeRepo(repoRoot);
    const trackedProcesses = recognized ? loadProcessesForRepoRoot(repoRoot) : {};
    const webPid = typeof trackedProcesses.web === "number" ? trackedProcesses.web : null;

    return {
      repoRoot,
      recognized,
      webPid,
      webRunning: webPid !== null && isPidRunning(webPid),
    };
  });
}

function listSharedInstanceMetadata(): InstanceMetadata[] {
  const instancesRoot = resolveSharedWorktreeInstancesPath();
  if (!existsSync(instancesRoot)) {
    return [];
  }

  return readdirSync(instancesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadMetadata(join(instancesRoot, entry.name)))
    .filter((metadata): metadata is InstanceMetadata => metadata !== null);
}

function listKnownWorktreeMetadata(repoRoot: string): InstanceMetadata[] {
  const metadataByRepoRoot = new Map<string, InstanceMetadata>();

  for (const metadata of listSharedInstanceMetadata()) {
    if (isRecognizedWorktreeRepo(metadata.repoRoot)) {
      metadataByRepoRoot.set(normalizePath(metadata.repoRoot), metadata);
    }
  }

  for (const linkedRepoRoot of listLinkedRepoRoots(repoRoot)) {
    if (!isRecognizedWorktreeRepo(linkedRepoRoot)) {
      continue;
    }

    const metadata = loadMetadataForRepoRoot(linkedRepoRoot);
    if (metadata) {
      metadataByRepoRoot.set(normalizePath(metadata.repoRoot), metadata);
    }
  }

  return [...metadataByRepoRoot.values()].sort((left, right) => {
    if (left.stackSlot !== right.stackSlot) {
      return left.stackSlot - right.stackSlot;
    }

    return left.repoRoot.localeCompare(right.repoRoot);
  });
}

function listSystemProcesses(): SystemProcess[] {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line): SystemProcess | null => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        pid: Number.parseInt(match[1], 10),
        ppid: Number.parseInt(match[2], 10),
        command: match[3].trim(),
      };
    })
    .filter((processEntry): processEntry is SystemProcess => processEntry !== null);
}

function listNextProcessesForWorktree(
  metadata: InstanceMetadata,
  processes: SystemProcess[],
): SystemProcess[] {
  const tracked = loadProcesses(metadata.instanceRoot);
  const webRootPids = typeof tracked.web === "number" ? [tracked.web] : [];
  const webDescendants = buildDescendantPidSet(processes, webRootPids);
  const repoRoot = normalizePath(metadata.repoRoot);

  return processes
    .filter((processEntry) => {
      if (webDescendants.has(processEntry.pid)) {
        return true;
      }

      return (
        processEntry.command.includes(repoRoot) &&
        isNextProcessCommand(processEntry.command)
      );
    })
    .sort((left, right) => left.pid - right.pid);
}

function formatProcessCommand(command: string): string {
  const maxLength = 160;
  if (command.length <= maxLength) {
    return command;
  }

  return `${command.slice(0, maxLength - 3)}...`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatPidList(pids: number[]): string {
  if (pids.length === 0) {
    return "-";
  }

  if (pids.length === 1) {
    return String(pids[0]);
  }

  return pids.join(", ");
}

function classifyNextProcess(command: string): string {
  if (/\bnext\s+dev\b/.test(command) && command.startsWith("bun ")) {
    return "dev command";
  }

  if (command.includes("/node_modules/.bin/next ")) {
    return "next cli";
  }

  if (command.includes("next-server")) {
    return "next server";
  }

  const fileMatch = command.match(/\/([^/]+\.js)(?:\s|$)/);
  if (fileMatch) {
    return fileMatch[1];
  }

  const basename = command.split(/\s+/)[0]?.split("/").pop();
  return basename && basename !== "(node)" ? basename : "node helper";
}

function groupNextProcesses(processes: SystemProcess[]): Array<{ label: string; pids: number[] }> {
  const groups = new Map<string, number[]>();
  for (const processEntry of processes) {
    const label = classifyNextProcess(processEntry.command);
    const pids = groups.get(label) ?? [];
    pids.push(processEntry.pid);
    groups.set(label, pids);
  }

  return [...groups.entries()]
    .map(([label, pids]) => ({ label, pids: pids.sort((left, right) => left - right) }))
    .sort((left, right) => {
      const priority = ["dev command", "next cli", "next server"];
      const leftPriority = priority.indexOf(left.label);
      const rightPriority = priority.indexOf(right.label);
      if (leftPriority !== -1 || rightPriority !== -1) {
        return (leftPriority === -1 ? priority.length : leftPriority) -
          (rightPriority === -1 ? priority.length : rightPriority);
      }

      return left.label.localeCompare(right.label);
    });
}

function formatServiceName(name: ProcessName): string {
  return name.padEnd(6, " ");
}

function assertWorktreeWebStartAllowed(metadata: InstanceMetadata): void {
  const summary = summarizeRunningWorktreeWebProcesses({
    currentRepoRoot: metadata.repoRoot,
    snapshots: buildWorktreeWebProcessSnapshots(metadata.repoRoot),
  });

  if (shouldBlockStartingWorktreeWeb(summary, MAX_RUNNING_WORKTREE_WEB_PROCESSES)) {
    fail(WORKTREE_START_LIMIT_ERROR);
  }
}

function resolveSourceDatabaseUrl(targetRepoRoot: string): string | null {
  const explicit = process.env.CMDCLAW_WORKTREE_SOURCE_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const sourceRepoRoot = resolveSourceRepoRoot(targetRepoRoot);
  if (!sourceRepoRoot) {
    return process.env.DATABASE_URL?.trim() || null;
  }

  if (!isRecognizedWorktreeRepo(sourceRepoRoot)) {
    return process.env.DATABASE_URL?.trim() || null;
  }

  return (
    loadMetadataForRepoRoot(sourceRepoRoot)?.databaseUrl ??
    process.env.DATABASE_URL?.trim() ??
    null
  );
}

function buildJsonStorageState(params: {
  appUrl: string;
  signedSessionToken: string;
  expiresAtEpochSeconds: number;
}): string {
  const origin = new URL(params.appUrl);
  const storageState = {
    cookies: [
      {
        name: "better-auth.session_token",
        value: params.signedSessionToken,
        domain: origin.hostname,
        path: "/",
        expires: params.expiresAtEpochSeconds,
        httpOnly: true,
        secure: origin.protocol === "https:",
        sameSite: "Lax",
      },
    ],
    origins: [],
  };

  return `${JSON.stringify(storageState, null, 2)}\n`;
}

function toIdentifierList(columns: string[]): string {
  return columns.map((column) => quoteIdentifier(column)).join(", ");
}

const tableColumnCache = new Map<string, Set<string>>();

async function getTableColumnSet(client: PgClient, tableName: string): Promise<Set<string>> {
  const cached = tableColumnCache.get(tableName);
  if (cached) {
    return cached;
  }

  const result = await client.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = $1
    `,
    [tableName],
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnCache.set(tableName, columns);
  return columns;
}

async function upsertRows(
  client: PgClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  conflictColumns: string[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const targetColumns = await getTableColumnSet(client, tableName);
  const columns = Object.keys(rows[0] ?? {}).filter((column) =>
    targetColumns.has(column),
  );
  if (columns.length === 0) {
    return;
  }

  const placeholders: string[] = [];
  const values: unknown[] = [];
  let parameterIndex = 1;

  for (const row of rows) {
    const rowPlaceholders = columns.map(() => `$${parameterIndex++}`);
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
    for (const column of columns) {
      values.push(row[column]);
    }
  }

  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  const updateClause =
    updateColumns.length > 0
      ? `do update set ${updateColumns
          .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
          .join(", ")}`
      : "do nothing";

  await client.query(
    `insert into ${quoteIdentifier(tableName)} (${toIdentifierList(columns)}) values ${placeholders.join(
      ", ",
    )} on conflict (${toIdentifierList(conflictColumns)}) ${updateClause}`,
    values,
  );
}

async function selectRows(
  client: PgClient,
  tableName: string,
  whereClause: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  const result = await client.query<Record<string, unknown>>(
    `select * from ${quoteIdentifier(tableName)} where ${whereClause}`,
    params,
  );
  return result.rows;
}

async function resolveLatestLocalSessionProfile(
  metadata: InstanceMetadata,
): Promise<SessionProfileRecord | null> {
  return withClient(buildDatabaseUrlForMetadata(metadata), async (client) => {
    const result = await client.query<{
      token: string;
      email: string;
      expires_at: Date;
    }>(
      `
        select s.token, u.email, s.expires_at
        from "session" s
        join "user" u on u.id = s.user_id
        where s.expires_at > now()
        order by s.updated_at desc nulls last, s.created_at desc
        limit 1
      `,
    );

    const row = result.rows[0];
    if (!row?.token || !row.email || !(row.expires_at instanceof Date)) {
      return null;
    }

    return {
      token: row.token,
      email: row.email,
      expiresAt: row.expires_at,
    };
  });
}

async function syncCliProfileFromLocalSession(metadata: InstanceMetadata): Promise<boolean> {
  const sessionProfile = await resolveLatestLocalSessionProfile(metadata);
  if (!sessionProfile) {
    return false;
  }

  saveCliProfile(metadata.appUrl, sessionProfile.token);
  console.log(`[worktree] cli profile ${resolveCliProfilePath(metadata.appUrl)}`);
  console.log(`[worktree] cli auth user ${sessionProfile.email}`);
  console.log(`[worktree] cli auth expires ${sessionProfile.expiresAt.toISOString()}`);
  return true;
}

async function resolveBootstrapSourceUser(sourceClient: PgClient): Promise<SourceUserRecord | null> {
  const explicitEmail = process.env.CMDCLAW_WORKTREE_DEV_USER_EMAIL?.trim();
  if (explicitEmail) {
    const result = await sourceClient.query<SourceUserRecord>(
      `select id, email from "user" where lower(email) = lower($1) limit 1`,
      [explicitEmail],
    );
    return result.rows[0] ?? null;
  }

  const recentSession = await sourceClient.query<SourceUserRecord>(
    `
      select u.id, u.email
      from "session" s
      join "user" u on u.id = s.user_id
      order by s.updated_at desc nulls last, s.created_at desc
      limit 1
    `,
  );
  if (recentSession.rows[0]) {
    return recentSession.rows[0];
  }

  const users = await sourceClient.query<SourceUserRecord>(
    `select id, email from "user" order by updated_at desc, created_at desc`,
  );
  if (users.rows.length === 1) {
    return users.rows[0] ?? null;
  }

  return null;
}

function remapWorkspaceRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
  }));
}

function remapCustomIntegrationRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
  }));
}

function remapWorkspaceMcpServerRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
    updated_by_user_id: targetUserId,
  }));
}

function remapCoworkerRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    owner_id: targetUserId,
    builder_conversation_id: null,
  }));
}

function remapSharedProviderAuthRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    managed_by_user_id:
      row.managed_by_user_id == null || row.managed_by_user_id === targetUserId
        ? row.managed_by_user_id
        : targetUserId,
  }));
}

function writeDerivedEnvFile(metadata: InstanceMetadata): void {
  const envFile = resolveWorktreeEnvFile(metadata.repoRoot);
  if (existsSync(envFile) && !isGeneratedWorktreeEnvFile(envFile)) {
    fail(
      `Refusing to overwrite non-generated env file at ${envFile}. Run worktree commands from an isolated worktree, or move the shared env file and set CMDCLAW_ENV_FILE.`,
    );
  }

  const env = buildWorktreeRuntimeEnv(metadata);
  const shellLines = Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  const commentedLines = Object.entries(buildCommentedWorktreeEnv(metadata)).map(
    ([key, value]) => `# ${key}=${JSON.stringify(value)}`,
  );
  writeFileSync(
    envFile,
    `${GENERATED_WORKTREE_ENV_HEADER}\n${GENERATED_WORKTREE_ENV_NOTICE}\n\n${shellLines.join("\n")}\n\n${commentedLines.join("\n")}\n`,
    "utf8",
  );
}

function loadAgentBrowserAuthState(metadata: InstanceMetadata): void {
  const statePath = agentBrowserStatePath(metadata.instanceRoot);
  if (!existsSync(statePath)) {
    return;
  }

  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    cookies?: Array<{
      name: string;
      value: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Lax" | "Strict" | "None";
    }>;
  };
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length === 0) {
    return;
  }

  const env = buildDerivedEnv(metadata);
  for (const cookie of cookies) {
    const args = [
      "cookies",
      "set",
      cookie.name,
      cookie.value,
      "--url",
      metadata.appUrl,
    ];

    if (cookie.httpOnly) {
      args.push("--httpOnly");
    }
    if (cookie.secure) {
      args.push("--secure");
    }
    if (cookie.sameSite) {
      args.push("--sameSite", cookie.sameSite);
    }
    if (typeof cookie.expires === "number") {
      args.push("--expires", String(cookie.expires));
    }

    const result = spawnSync("agent-browser", args, {
      cwd: metadata.repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      const output = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
      console.warn(
        `[worktree] failed to hydrate agent-browser cookie ${cookie.name}: ${output}`,
      );
      return;
    }
  }

  console.log(
    `[worktree] hydrated agent-browser session ${agentBrowserSessionName(metadata.instanceId)}`,
  );
}

function closeAgentBrowserSession(metadata: InstanceMetadata): void {
  const env = buildDerivedEnv(metadata);
  const result = spawnSync("agent-browser", ["close"], {
    cwd: metadata.repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const output = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    console.warn(`[worktree] failed to close agent-browser session: ${output}`);
  }
}

function createMetadata(
  repoRoot: string,
  appPort: number,
  wsPort: number,
  stackSlot: number,
): InstanceMetadata {
  const instanceId = buildInstanceId(repoRoot);
  const instanceRoot = resolveSharedWorktreeInstanceRoot(resolveSharedWorktreeRootPath(), instanceId);
  const databaseName = buildDatabaseName(instanceId);
  const databaseUser = buildDatabaseUser(instanceId);
  const databasePassword = generateCredentialSecret();
  const redisUser = buildRedisUser(instanceId);
  const redisPassword = generateCredentialSecret();
  const minioBucketName = buildMinioBucketName(instanceId);
  const minioAccessKeyId = buildMinioAccessKeyId(instanceId);
  const minioSecretAccessKey = generateCredentialSecret();
  const now = new Date().toISOString();

  return {
    instanceId,
    repoRoot,
    instanceRoot,
    stackSlot,
    appPort,
    wsPort,
    appUrl: buildAppUrl(appPort),
    databaseName,
    databaseUser,
    databasePassword,
    databaseUrl: buildDatabaseUrlForMetadata({
      databaseName,
      databaseUser,
      databasePassword,
    }),
    redisUser,
    redisPassword,
    queueName: buildQueueName(instanceId),
    redisNamespace: buildRedisNamespace(instanceId),
    minioBucketName,
    minioAccessKeyId,
    minioSecretAccessKey,
    createdAt: now,
    updatedAt: now,
  };
}

function updateMetadataStackSlot(metadata: InstanceMetadata, stackSlot: number): InstanceMetadata {
  const ports = buildAppPorts(stackSlot);
  const updated = hydrateMetadataCredentials({
    ...metadata,
    stackSlot,
    appPort: ports.appPort,
    wsPort: ports.wsPort,
    appUrl: buildAppUrl(ports.appPort),
    updatedAt: new Date().toISOString(),
  });
  saveMetadata(updated);
  writeDerivedEnvFile(updated);
  return updated;
}

async function reallocateMetadataStackSlot(
  metadata: InstanceMetadata,
  reason: string,
  excludedSlots?: Set<number>,
): Promise<InstanceMetadata> {
  const reservation = await reserveStackSlot(metadata.repoRoot, metadata, {
    excludedSlots,
    preferredSlot: null,
  });
  const updated = updateMetadataStackSlot(metadata, reservation.slot);
  if (updated.stackSlot !== metadata.stackSlot) {
    console.warn(
      `[worktree] reallocated stack slot ${formatWorktreeStackSlot(metadata.stackSlot)} -> ${formatWorktreeStackSlot(
        updated.stackSlot,
      )} because ${reason}`,
    );
    removeSlotLease(metadata.stackSlot, {
      instanceId: metadata.instanceId,
      repoRoot: metadata.repoRoot,
    });
  }

  return updated;
}

async function resolveMetadata(): Promise<InstanceMetadata> {
  const repoRoot = resolveRepoRoot();
  const instanceId = buildInstanceId(repoRoot);
  const instanceRoot = migrateLegacyInstanceRoot(repoRoot);
  const existing = loadMetadata(instanceRoot);

  if (existing) {
    const hydratedExisting = hydrateMetadataCredentials(existing);
    const reservation = await reserveStackSlot(repoRoot, hydratedExisting);
    const updated = updateMetadataStackSlot(
      {
        ...hydratedExisting,
        repoRoot,
        instanceRoot,
      },
      reservation.slot,
    );
    if (reservation.previousSlot !== null && reservation.previousSlot !== reservation.slot) {
      console.warn(
        `[worktree] reallocated stack slot ${formatWorktreeStackSlot(reservation.previousSlot)} -> ${formatWorktreeStackSlot(
          reservation.slot,
        )}${reservation.reason ? ` because ${reservation.reason}` : ""}`,
      );
      removeSlotLease(reservation.previousSlot, {
        instanceId,
        repoRoot,
      });
    }
    return updated;
  }

  ensureDir(resolveSharedWorktreeInstancesPath());
  ensureDir(instanceRoot);
  ensureDir(logsDir(instanceRoot));
  ensureDir(runtimeDir(instanceRoot));

  const stackSlot = (await reserveStackSlot(repoRoot, null)).slot;
  const ports = buildAppPorts(stackSlot);
  const metadata = createMetadata(repoRoot, ports.appPort, ports.wsPort, stackSlot);
  saveMetadata(metadata);
  writeDerivedEnvFile(metadata);
  return metadata;
}

function spawnWithEnv(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, mode: "foreground" | "background", name: ProcessName, instanceRoot: string) {
  const processEnv = {
    ...process.env,
    ...env,
  };

  if (mode === "foreground") {
    return spawn(command, args, {
      cwd,
      env: processEnv,
      stdio: "inherit",
    });
  }

  ensureDir(logsDir(instanceRoot));
  const logPath = join(logsDir(instanceRoot), `${name}.log`);
  const fd = openSync(logPath, "a");

  return spawn(command, args, {
    cwd,
    env: processEnv,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
}

function buildProcessCommand(
  metadata: InstanceMetadata,
  name: ProcessName,
  options?: { watch?: boolean },
): { command: string; args: string[]; cwd: string } {
  const envFile = resolveWorktreeEnvFile(metadata.repoRoot);

  switch (name) {
    case "web":
      return {
        command: "bun",
        args: [
          "--env-file",
          envFile,
          "next",
          "dev",
          "--webpack",
          "--port",
          String(metadata.appPort),
        ],
        cwd: join(metadata.repoRoot, "apps/web"),
      };
    case "worker":
      return {
        command: "bun",
        args: [
          ...(options?.watch ? ["--watch"] : []),
          "--env-file",
          envFile,
          "index.ts",
        ],
        cwd: join(metadata.repoRoot, "apps/worker"),
      };
    case "ws":
      return {
        command: "bun",
        args: [
          ...(options?.watch ? ["--watch"] : []),
          "--env-file",
          envFile,
          "index.ts",
        ],
        cwd: join(metadata.repoRoot, "apps/ws"),
      };
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Poll until ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`Timed out waiting for ${url}`);
}

async function waitForDatabaseReady(connectionString: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch {
      try {
        await client.end();
      } catch {
        // Ignore shutdown errors while polling for readiness.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`Timed out waiting for database at ${redactConnectionString(connectionString)}`);
}

async function runDbPush(metadata: InstanceMetadata): Promise<void> {
  const result = spawnSync("bun", ["run", "--shell", "system", "--cwd", "apps/web", "db:push"], {
    cwd: metadata.repoRoot,
    env: {
      ...process.env,
      ...buildWorktreeRuntimeEnv(metadata),
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`db:push failed for ${metadata.databaseName}`);
  }
}

async function bootstrapDeveloperUser(metadata: InstanceMetadata): Promise<void> {
  const sourceDatabaseUrl = resolveSourceDatabaseUrl(metadata.repoRoot);
  const targetDatabaseUrl = buildDatabaseUrlForMetadata(metadata);
  if (!sourceDatabaseUrl || sourceDatabaseUrl === targetDatabaseUrl) {
    return;
  }

  try {
    await withClient(sourceDatabaseUrl, async (sourceClient) => {
      const sourceUser = await resolveBootstrapSourceUser(sourceClient);
      if (!sourceUser) {
        fail(
          "Unable to resolve a source developer user. Set CMDCLAW_WORKTREE_DEV_USER_EMAIL or make sure the source worktree has a recent session.",
        );
      }

      await withClient(targetDatabaseUrl, async (targetClient) => {
        const userRows = await selectRows(sourceClient, "user", "id = $1", [sourceUser.id]);
        if (userRows.length === 0) {
          fail(`Source user ${sourceUser.email} was not found in the source database.`);
        }

      const workspaceRows = await sourceClient.query<Record<string, unknown>>(
        `
          select distinct w.*
          from workspace_member wm
          join workspace w on w.id = wm.workspace_id
          where wm.user_id = $1
             or w.id = (select active_workspace_id from "user" where id = $1)
        `,
        [sourceUser.id],
      );
      const workspaceIds = workspaceRows.rows
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string");

      const workspaceMemberRows =
        workspaceIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from workspace_member where user_id = $1 and workspace_id = any($2::text[])`,
              [sourceUser.id, workspaceIds],
            )
          : { rows: [] };

      const accountRows = await selectRows(sourceClient, "account", "user_id = $1", [sourceUser.id]);
      const connectedIdentityRows = await selectRows(sourceClient, "connected_identity", "user_id = $1", [
        sourceUser.id,
      ]);
      const integrationRows = await selectRows(sourceClient, "integration", "user_id = $1", [sourceUser.id]);
      const integrationIds = integrationRows
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string");

      const integrationTokenRows =
        integrationIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from integration_token where integration_id = any($1::text[])`,
              [integrationIds],
            )
          : { rows: [] };

      const providerAuthRows = await selectRows(sourceClient, "provider_auth", "user_id = $1", [sourceUser.id]);
      const cloudAccountLinkRows = await selectRows(sourceClient, "cloud_account_link", "user_id = $1", [sourceUser.id]);
      const customIntegrationCredentialRows = await selectRows(
        sourceClient,
        "custom_integration_credential",
        "user_id = $1",
        [sourceUser.id],
      );
      const customIntegrationIds = customIntegrationCredentialRows
        .map((row) => row.custom_integration_id)
        .filter((value): value is string => typeof value === "string");

      const customIntegrationRows =
        customIntegrationIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from custom_integration where id = any($1::text[])`,
              [customIntegrationIds],
            )
          : { rows: [] };

      const executorSourceCredentialRows = await selectRows(
        sourceClient,
        "workspace_mcp_authorization",
        "user_id = $1",
        [sourceUser.id],
      );
      const executorSourceIds = executorSourceCredentialRows
        .map((row) => row.workspace_mcp_server_id)
        .filter((value): value is string => typeof value === "string");

      const executorSourceRows =
        executorSourceIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from workspace_mcp_server where id = any($1::text[])`,
              [executorSourceIds],
            )
          : { rows: [] };

      const coworkerRows =
        workspaceIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker where owner_id = $1 and workspace_id = any($2::text[])`,
              [sourceUser.id, workspaceIds],
            )
          : { rows: [] };
      const coworkerIds = coworkerRows.rows
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string");

      const coworkerDocumentRows =
        coworkerIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker_document where coworker_id = any($1::text[])`,
              [coworkerIds],
            )
          : { rows: [] };

      const coworkerEmailAliasRows =
        coworkerIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker_email_alias where coworker_id = any($1::text[])`,
              [coworkerIds],
            )
          : { rows: [] };

      const coworkerTagAssignmentRows =
        coworkerIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker_tag_assignment where coworker_id = any($1::text[])`,
              [coworkerIds],
            )
          : { rows: [] };
      const coworkerTagIds = coworkerTagAssignmentRows.rows
        .map((row) => row.tag_id)
        .filter((value): value is string => typeof value === "string");

      const coworkerTagRows =
        coworkerTagIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker_tag where id = any($1::text[])`,
              [coworkerTagIds],
            )
          : { rows: [] };

      const orgChartNodeRows =
        workspaceIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `
                select *
                from org_chart_node
                where workspace_id = any($1::text[])
                  and (coworker_id is null or coworker_id = any($2::text[]))
              `,
              [workspaceIds, coworkerIds],
            )
          : { rows: [] };

      const coworkerViewRows =
        workspaceIds.length > 0
          ? await sourceClient.query<Record<string, unknown>>(
              `select * from coworker_view where workspace_id = any($1::text[])`,
              [workspaceIds],
            )
          : { rows: [] };

      const sharedProviderAuthRows = (
        await sourceClient.query<Record<string, unknown>>(`select * from shared_provider_auth`)
      ).rows;

      await targetClient.query("begin");
      try {
        await upsertRows(targetClient, "user", userRows, ["id"]);
        await upsertRows(
          targetClient,
          "workspace",
          remapWorkspaceRows(workspaceRows.rows, sourceUser.id),
          ["id"],
        );
        await upsertRows(targetClient, "workspace_member", workspaceMemberRows.rows, ["id"]);
        await upsertRows(targetClient, "account", accountRows, ["id"]);
        await upsertRows(targetClient, "connected_identity", connectedIdentityRows, ["id"]);
        await upsertRows(targetClient, "integration", integrationRows, ["id"]);
        await upsertRows(targetClient, "integration_token", integrationTokenRows.rows, ["id"]);
        await upsertRows(targetClient, "provider_auth", providerAuthRows, ["id"]);
        await upsertRows(
          targetClient,
          "shared_provider_auth",
          remapSharedProviderAuthRows(sharedProviderAuthRows, sourceUser.id),
          ["id"],
        );
        await upsertRows(targetClient, "cloud_account_link", cloudAccountLinkRows, ["id"]);
        await upsertRows(
          targetClient,
          "custom_integration",
          remapCustomIntegrationRows(customIntegrationRows.rows, sourceUser.id),
          ["id"],
        );
        await upsertRows(
          targetClient,
          "custom_integration_credential",
          customIntegrationCredentialRows,
          ["id"],
        );
        await upsertRows(
          targetClient,
          "workspace_mcp_server",
          remapWorkspaceMcpServerRows(executorSourceRows.rows, sourceUser.id),
          ["id"],
        );
        await upsertRows(
          targetClient,
          "workspace_mcp_authorization",
          executorSourceCredentialRows,
          ["id"],
        );
        await upsertRows(
          targetClient,
          "coworker",
          remapCoworkerRows(coworkerRows.rows, sourceUser.id),
          ["id"],
        );
        await upsertRows(targetClient, "coworker_document", coworkerDocumentRows.rows, ["id"]);
        await upsertRows(targetClient, "coworker_email_alias", coworkerEmailAliasRows.rows, ["id"]);
        await upsertRows(targetClient, "coworker_tag", coworkerTagRows.rows, ["id"]);
        await upsertRows(
          targetClient,
          "coworker_tag_assignment",
          coworkerTagAssignmentRows.rows,
          ["id"],
        );
        await upsertRows(targetClient, "org_chart_node", orgChartNodeRows.rows, ["id"]);
        await upsertRows(targetClient, "coworker_view", coworkerViewRows.rows, ["id"]);

        const sessionToken = randomBytes(48).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await upsertRows(
          targetClient,
          "session",
          [
            {
              id: randomUUID(),
              expires_at: expiresAt,
              token: sessionToken,
              created_at: new Date(),
              updated_at: new Date(),
              ip_address: "127.0.0.1",
              user_agent: "cmdclaw-worktree-bootstrap",
              user_id: sourceUser.id,
              impersonated_by: null,
            },
          ],
          ["id"],
        );

        await targetClient.query("commit");

        const secret = process.env.BETTER_AUTH_SECRET;
        if (!secret) {
          fail("BETTER_AUTH_SECRET is required to generate a developer session cookie.");
        }
        const signedCookie = (await serializeSignedCookie("", sessionToken, secret)).replace(
          "=",
          "",
        );

        ensureDir(authArtifactsDir(metadata.instanceRoot));
        const storageStatePath = agentBrowserStatePath(metadata.instanceRoot);
        const sessionInfoPath = join(authArtifactsDir(metadata.instanceRoot), "dev-user.session.json");

        writeFileSync(
          storageStatePath,
          buildJsonStorageState({
            appUrl: metadata.appUrl,
            signedSessionToken: signedCookie,
            expiresAtEpochSeconds: Math.floor(expiresAt.getTime() / 1000),
          }),
          "utf8",
        );
        writeFileSync(
          sessionInfoPath,
          `${JSON.stringify(
            {
              appUrl: metadata.appUrl,
              email: sourceUser.email,
              userId: sourceUser.id,
              cookieHeader: `better-auth.session_token=${signedCookie}`,
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        console.log(`[worktree] bootstrapped developer user ${sourceUser.email}`);
        console.log(`[worktree] imported coworkers ${coworkerRows.rows.length}`);
        console.log(`[worktree] auth storage ${storageStatePath}`);
        loadAgentBrowserAuthState(metadata);
      } catch (error) {
        await targetClient.query("rollback");
        throw error;
      }
      });
    });
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      fail(
        `there was an issue during worktree setup: the source database is unavailable at ${redactConnectionString(sourceDatabaseUrl)}. The main docker stack is likely not up, so developer data could not be copied. Report this state and wait for instructions before continuing.`,
      );
    }
    throw error;
  }
}

async function createInstance(): Promise<InstanceMetadata> {
  const metadata = await resolveMetadata();
  ensureDir(logsDir(metadata.instanceRoot));
  ensureDir(runtimeDir(metadata.instanceRoot));
  await ensureDatabase(metadata);
  await ensureDatabaseExtensions(metadata);
  await ensureDatabaseRole(metadata);
  await ensureRedisAclUser(metadata);
  await ensureMinioTenant(metadata);
  await runDbPush(metadata);
  await bootstrapDeveloperUser(metadata);
  if (!(await syncCliProfileFromLocalSession(metadata))) {
    console.warn("[worktree] no local session available to seed CLI auth");
  }
  saveMetadata({ ...metadata, updatedAt: new Date().toISOString() });
  writeDerivedEnvFile(metadata);
  console.log(`[worktree] instance ${metadata.instanceId}`);
  console.log(`[worktree] stack slot ${formatWorktreeStackSlot(metadata.stackSlot)}`);
  console.log(`[worktree] app ${metadata.appUrl}`);
  console.log(`[worktree] db ${metadata.databaseName}`);
  console.log(`[worktree] agent-browser session ${agentBrowserSessionName(metadata.instanceId)}`);
  return metadata;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already gone.
    }
  }
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already gone.
  }
}

async function waitForProcessesToExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidRunning(pid))) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return pids.filter((pid) => isPidRunning(pid));
}

function getProcessEntries(metadata: InstanceMetadata): Array<{ name: ProcessName; pid: number }> {
  const stored = loadProcesses(metadata.instanceRoot);
  return PROCESS_NAMES.flatMap((name) => {
    const pid = stored[name];
    return typeof pid === "number" ? [{ name, pid }] : [];
  });
}

async function stopInstance(metadata: InstanceMetadata): Promise<void> {
  const entries = getProcessEntries(metadata);
  if (entries.length === 0) {
    closeAgentBrowserSession(metadata);
    console.log("[worktree] no running background processes");
    return;
  }

  for (const entry of entries) {
    if (isPidRunning(entry.pid)) {
      killProcessGroup(entry.pid);
    }
  }

  await waitForProcessesToExit(entries.map((entry) => entry.pid), 20_000);

  removeProcessesFile(metadata.instanceRoot);
  closeAgentBrowserSession(metadata);
  console.log("[worktree] stopped background processes");
}

async function startInstance(): Promise<void> {
  const metadata = await resolveMetadata();
  assertWorktreeWebStartAllowed(metadata);
  await stopInstance(metadata);
  const createdMetadata = await createInstance();
  const env = buildWorktreeRuntimeEnv(createdMetadata);
  const webCommand = buildProcessCommand(createdMetadata, "web");
  const web = spawnWithEnv(
    webCommand.command,
    webCommand.args,
    webCommand.cwd,
    env,
    "background",
    "web",
    createdMetadata.instanceRoot,
  );
  web.unref();
  const workerCommand = buildProcessCommand(createdMetadata, "worker");
  const worker = spawnWithEnv(
    workerCommand.command,
    workerCommand.args,
    workerCommand.cwd,
    env,
    "background",
    "worker",
    createdMetadata.instanceRoot,
  );
  worker.unref();
  const wsCommand = buildProcessCommand(createdMetadata, "ws");
  const ws = spawnWithEnv(
    wsCommand.command,
    wsCommand.args,
    wsCommand.cwd,
    env,
    "background",
    "ws",
    createdMetadata.instanceRoot,
  );
  ws.unref();

  saveProcesses(createdMetadata.instanceRoot, {
    web: web.pid,
    worker: worker.pid,
    ws: ws.pid,
  });

  await waitForHttp(buildHealthCheckUrl(createdMetadata.appUrl), DEV_START_TIMEOUT_MS);
  console.log(`[worktree] started ${createdMetadata.appUrl}`);
  console.log(`[worktree] logs ${logsDir(createdMetadata.instanceRoot)}`);
}

async function setupInstance(): Promise<void> {
  const metadata = await resolveMetadata();
  ensureDockerDaemonAvailable();
  ensureSharedInfraRunning(metadata.repoRoot);
  console.log("[worktree] shared docker stack ready");
  printStatusEndpoints(metadata);
  await waitForDatabaseReady(buildPostgresAdminUrl(metadata), DEV_START_TIMEOUT_MS);
  await startInstance();
}

async function devInstance(): Promise<void> {
  const metadata = await createInstance();
  const env = buildWorktreeRuntimeEnv(metadata);

  const children = [
    (() => {
      const command = buildProcessCommand(metadata, "web");
      return spawnWithEnv(
        command.command,
        command.args,
        command.cwd,
        env,
        "foreground",
        "web",
        metadata.instanceRoot,
      );
    })(),
    (() => {
      const command = buildProcessCommand(metadata, "worker", { watch: true });
      return spawnWithEnv(
        command.command,
        command.args,
        command.cwd,
        env,
        "foreground",
        "worker",
        metadata.instanceRoot,
      );
    })(),
    (() => {
      const command = buildProcessCommand(metadata, "ws", { watch: true });
      return spawnWithEnv(
        command.command,
        command.args,
        command.cwd,
        env,
        "foreground",
        "ws",
        metadata.instanceRoot,
      );
    })(),
  ];

  const shutdown = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await waitForHttp(buildHealthCheckUrl(metadata.appUrl), DEV_START_TIMEOUT_MS);
  console.log(`[worktree] dev ready at ${metadata.appUrl}`);

  await Promise.race(
    children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("exit", (code, signal) => {
            if (code === 0 || signal === "SIGTERM") {
              resolve();
              return;
            }
            reject(new Error(`process exited code=${code ?? "null"} signal=${signal ?? "null"}`));
          });
        }),
    ),
  );
}

async function destroyInstance(): Promise<void> {
  const metadata = await resolveMetadata();
  await stopInstance(metadata);

  try {
    await dropDatabase(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[worktree] failed to drop database ${metadata.databaseName}: ${message}`);
  }

  try {
    await dropDatabaseRole(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[worktree] failed to drop postgres role ${metadata.databaseUser}: ${message}`);
  }

  try {
    await dropRedisAclUser(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[worktree] failed to drop redis ACL user ${metadata.redisUser}: ${message}`);
  }

  try {
    await dropMinioTenant(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[worktree] failed to remove minio tenant ${metadata.minioBucketName}: ${message}`);
  }

  teardownDockerResources(metadata);
  removeSlotLease(metadata.stackSlot, {
    instanceId: metadata.instanceId,
    repoRoot: metadata.repoRoot,
  });
  rmSync(metadata.instanceRoot, { recursive: true, force: true });
  console.log("[worktree] removed local state");
}

async function showStatus(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  if (!isRecognizedWorktreeRepo(repoRoot)) {
    console.log("[worktree] you are not in a worktree");
    return;
  }

  const metadata = await resolveMetadata();
  const entries = getProcessEntries(metadata);
  console.log(`[worktree] worktree ${metadata.repoRoot}`);
  console.log(`[worktree] instance ${metadata.instanceId}`);
  console.log(`[worktree] stack slot ${formatWorktreeStackSlot(metadata.stackSlot)}`);
  console.log(`[worktree] port ${metadata.appPort}`);
  console.log(`[worktree] db ${metadata.databaseName}`);
  console.log(`[worktree] root ${metadata.instanceRoot}`);
  console.log(`[worktree] agent-browser session ${agentBrowserSessionName(metadata.instanceId)}`);
  printStatusEndpoints(metadata);

  const dockerContainers = listDockerProjectContainers(metadata);
  if (dockerContainers.length === 0) {
    console.log("[worktree] docker none");
  } else {
    for (const container of dockerContainers) {
      console.log(`[worktree] docker ${container}`);
    }
  }

  const slotConflicts = await resolveSlotConflicts(metadata.stackSlot);
  if (slotConflicts.length === 0) {
    console.log("[worktree] slot health free");
  } else if (isSlotActivelyOwnedByInstance(metadata)) {
    console.log("[worktree] slot health active");
    for (const conflict of slotConflicts) {
      console.log(`[worktree] slot ${formatSlotConflict(conflict)}`);
    }
  } else {
    console.log("[worktree] slot health conflict");
    for (const conflict of slotConflicts) {
      console.log(`[worktree] slot ${formatSlotConflict(conflict)}`);
    }
  }

  if (entries.length === 0) {
    console.log("[worktree] processes none");
    return;
  }

  for (const entry of entries) {
    console.log(
      `[worktree] ${entry.name} pid=${entry.pid} running=${isPidRunning(entry.pid) ? "yes" : "no"}`,
    );
  }
}

function matchesProcessTarget(metadata: InstanceMetadata, target: string): boolean {
  const normalizedTarget = normalizePath(target);
  const slot = String(metadata.stackSlot);
  const paddedSlot = formatWorktreeStackSlot(metadata.stackSlot);

  return (
    metadata.instanceId === target ||
    slot === target ||
    paddedSlot === target ||
    String(metadata.appPort) === target ||
    normalizePath(metadata.repoRoot) === normalizedTarget
  );
}

function resolveProcessTarget(metadataList: InstanceMetadata[], target: string): InstanceMetadata {
  const matches = metadataList.filter((metadata) =>
    matchesProcessTarget(metadata, target),
  );

  if (matches.length === 0) {
    fail(
      `No worktree matched "${target}". Use "bun run worktree:processes" to list instance ids, slots, ports, and repo paths.`,
    );
  }

  if (matches.length > 1) {
    fail(`Multiple worktrees matched "${target}". Use the full instance id or repo path.`);
  }

  return matches[0];
}

async function stopProcessTargets(targets: string[]): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const metadataList = listKnownWorktreeMetadata(repoRoot);
  const seenInstanceIds = new Set<string>();
  const selectedMetadata: InstanceMetadata[] = [];

  for (const target of targets) {
    const metadata = resolveProcessTarget(metadataList, target);
    if (seenInstanceIds.has(metadata.instanceId)) {
      continue;
    }

    seenInstanceIds.add(metadata.instanceId);
    selectedMetadata.push(metadata);
  }

  for (const metadata of selectedMetadata) {
    console.log(
      `[worktree] stopping ${metadata.instanceId} (slot ${formatWorktreeStackSlot(
        metadata.stackSlot,
      )}, port ${metadata.appPort})`,
    );
    await stopInstance(metadata);
  }
}

async function stopAllProcessTargets(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const metadataList = listKnownWorktreeMetadata(repoRoot);
  const systemProcesses = listSystemProcesses();
  const activeMetadata = metadataList.filter((metadata) => {
    const entries = getProcessEntries(metadata);
    const hasRunningTrackedProcess = entries.some((entry) => isPidRunning(entry.pid));
    const hasRunningNextProcess =
      listNextProcessesForWorktree(metadata, systemProcesses).length > 0;
    return hasRunningTrackedProcess || hasRunningNextProcess;
  });

  if (activeMetadata.length === 0) {
    console.log("[worktree] processes none");
    return;
  }

  console.log(`[worktree] stopping ${activeMetadata.length} worktree(s)`);
  for (const metadata of activeMetadata) {
    console.log(`[worktree] stopping ${metadata.instanceId}`);
    await stopInstance(metadata);
  }

  const remainingNextPids = activeMetadata
    .flatMap((metadata) => listNextProcessesForWorktree(metadata, listSystemProcesses()))
    .map((processEntry) => processEntry.pid);
  const uniqueRemainingNextPids = Array.from(new Set(remainingNextPids)).sort((left, right) =>
    right - left,
  );

  if (uniqueRemainingNextPids.length > 0) {
    console.log(
      `[worktree] stopping ${uniqueRemainingNextPids.length} remaining Next.js process(es): ${formatPidList(uniqueRemainingNextPids)}`,
    );
    for (const pid of uniqueRemainingNextPids) {
      terminateProcess(pid);
    }

    const stillRunning = await waitForProcessesToExit(uniqueRemainingNextPids, 10_000);
    if (stillRunning.length > 0) {
      console.warn(`[worktree] still running after SIGTERM: ${formatPidList(stillRunning)}`);
    }
  }

  await cleanupWorktreeServiceProcesses([]);
  console.log("[worktree] stopped all worktree processes");
}

function resolveProcessCleanupRoots(metadataList: InstanceMetadata[]): string[] {
  const roots = new Set<string>();
  for (const root of resolveRecognizedWorktreeRoots()) {
    roots.add(root);
  }

  const home = process.env.HOME;
  if (home) {
    roots.add(join(home, ".codex", "worktrees"));
    roots.add(join(home, ".claude", "worktrees"));
  }

  for (const metadata of metadataList) {
    if (isRecognizedWorktreeRepo(metadata.repoRoot)) {
      roots.add(metadata.repoRoot);
    }
  }

  return [...roots].sort((left, right) => left.localeCompare(right));
}

function listProtectedProcessRootPids(metadataList: InstanceMetadata[]): number[] {
  return metadataList.flatMap((metadata) => {
    const processes = loadProcesses(metadata.instanceRoot);
    return PROCESS_NAMES.flatMap((name) => {
      const pid = processes[name];
      return typeof pid === "number" && isPidRunning(pid) ? [pid] : [];
    });
  });
}

function formatCleanupCandidate(candidate: WorktreeProcessCleanupCandidate): string {
  return `pid ${candidate.pid} ppid ${candidate.ppid}  ${formatProcessCommand(candidate.command)}`;
}

async function cleanupWorktreeServiceProcesses(args: string[]): Promise<void> {
  const includeTracked = args.includes("--all") || args.includes("--include-tracked");
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const unknownArgs = args.filter(
    (arg) => !["--all", "--include-tracked", "--dry-run", "--verbose", "-v"].includes(arg),
  );

  if (unknownArgs.length > 0) {
    fail(
      `Unknown cleanup option "${unknownArgs[0]}". Usage: bun run worktree:processes cleanup [--dry-run] [--all] [--verbose]`,
    );
  }

  const repoRoot = resolveRepoRoot();
  const metadataList = listKnownWorktreeMetadata(repoRoot);
  const systemProcesses = listSystemProcesses();
  const roots = resolveProcessCleanupRoots(metadataList);
  const candidates = collectWorktreeProcessCleanupCandidates({
    processes: systemProcesses,
    worktreeRoots: roots,
    protectedRootPids: includeTracked ? [] : listProtectedProcessRootPids(metadataList),
  });

  if (candidates.length === 0) {
    console.log("[worktree] cleanup no orphaned worktree service processes");
    return;
  }

  const pids = candidates.map((candidate) => candidate.pid);
  const mode = dryRun ? "would stop" : "stopping";
  console.log(
    `[worktree] cleanup ${mode} ${pids.length} worktree service process(es): ${formatPidList(pids)}`,
  );

  if (verbose || dryRun) {
    for (const candidate of candidates) {
      console.log(`  ${formatCleanupCandidate(candidate)}`);
    }
  }

  if (dryRun) {
    return;
  }

  for (const pid of pids.sort((left, right) => right - left)) {
    terminateProcess(pid);
  }

  const stillRunning = await waitForProcessesToExit(pids, 10_000);
  if (stillRunning.length > 0) {
    console.warn(`[worktree] cleanup still running after SIGTERM: ${formatPidList(stillRunning)}`);
  } else {
    console.log("[worktree] cleanup stopped orphaned worktree service processes");
  }
}

async function showProcesses(args: string[]): Promise<void> {
  const command = args[0] === "list" ? "list" : args[0];
  const commandArgs = args[0] === "list" ? args.slice(1) : args.slice(1);
  if (command === "stop") {
    const targets = commandArgs[0] === "slot" ? commandArgs.slice(1) : commandArgs;
    if (targets.length === 0) {
      fail(
        'Usage: bun run worktree:processes stop <all|slot|instance-id|app-port|repo-root> [...]',
      );
    }

    if (targets.includes("all")) {
      if (targets.length > 1) {
        fail('Usage: "all" must be the only target: bun run worktree:processes stop all');
      }

      await stopAllProcessTargets();
      return;
    }

    await stopProcessTargets(targets);
    return;
  }

  if (command === "cleanup") {
    await cleanupWorktreeServiceProcesses(commandArgs);
    return;
  }

  const listArgs = command === "list" ? commandArgs : args;
  const verbose = listArgs.includes("--verbose") || listArgs.includes("-v");

  const repoRoot = resolveRepoRoot();
  const metadataList = listKnownWorktreeMetadata(repoRoot);
  const systemProcesses = listSystemProcesses();
  const snapshots = buildWorktreeWebProcessSnapshots(repoRoot);
  const summary = summarizeRunningWorktreeWebProcesses({
    currentRepoRoot: repoRoot,
    snapshots,
  });

  console.log(
    `[worktree] running web servers: ${summary.totalRunning}/${MAX_RUNNING_WORKTREE_WEB_PROCESSES}`,
  );
  console.log("  stop all: bun run worktree:processes stop all");

  if (metadataList.length === 0) {
    console.log("[worktree] processes none");
    return;
  }

  let printedAnyRunningWorktree = false;
  for (const metadata of metadataList) {
    const entries = getProcessEntries(metadata);
    const nextProcesses = listNextProcessesForWorktree(metadata, systemProcesses);
    const hasRunningTrackedProcess = entries.some((entry) => isPidRunning(entry.pid));
    const hasRunningNextProcess = nextProcesses.length > 0;

    if (!hasRunningTrackedProcess && !hasRunningNextProcess) {
      continue;
    }

    printedAnyRunningWorktree = true;
    console.log(
      `\n${metadata.instanceId} (slot ${formatWorktreeStackSlot(metadata.stackSlot)}, port ${metadata.appPort})`,
    );
    console.log(`  app:  ${metadata.appUrl}`);
    console.log(`  repo: ${metadata.repoRoot}`);
    console.log(
      `  stop: bun run worktree:processes stop ${formatWorktreeStackSlot(metadata.stackSlot)}`,
    );

    if (entries.length === 0) {
      console.log("  services: none tracked");
    } else {
      console.log("  services:");
      for (const entry of entries) {
        console.log(
          `    ${formatServiceName(entry.name)} pid ${entry.pid}  ${isPidRunning(entry.pid) ? "running" : "stopped"}`,
        );
      }
    }

    if (nextProcesses.length === 0) {
      console.log("  next: none");
    } else {
      console.log(`  next (${nextProcesses.length} processes):`);
      for (const group of groupNextProcesses(nextProcesses)) {
        console.log(`    ${group.label}: ${formatPidList(group.pids)}`);
      }

      if (verbose) {
        console.log("  commands:");
        for (const processEntry of nextProcesses) {
          console.log(
            `    pid ${processEntry.pid} ppid ${processEntry.ppid}  ${formatProcessCommand(processEntry.command)}`,
          );
        }
      }
    }
  }

  if (!printedAnyRunningWorktree) {
    console.log("[worktree] processes none");
  }
}

async function showEnv(): Promise<void> {
  const metadata = await resolveMetadata();
  const env = buildWorktreeRuntimeEnv(metadata);
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${JSON.stringify(value)}`);
  }
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  ensureDir(resolveSharedWorktreeInstancesPath());
  ensureDir(resolveSharedWorktreeLocksPath());
  loadSharedEnv(repoRoot);

  const command = (process.argv[2] as CommandName | undefined) ?? "dev";

  switch (command) {
    case "create":
      await createInstance();
      return;
    case "setup":
      await setupInstance();
      return;
    case "start":
      await startInstance();
      return;
    case "docker-up":
      await dockerUpInstance();
      return;
    case "docker-down":
      await dockerDownInstance();
      return;
    case "stop": {
      const metadata = await resolveMetadata();
      await stopInstance(metadata);
      return;
    }
    case "destroy":
      await destroyInstance();
      return;
    case "dev":
      await devInstance();
      return;
    case "status":
      await showStatus();
      return;
    case "processes":
      await showProcesses(process.argv.slice(3));
      return;
    case "cleanup":
      await cleanupWorktreeServiceProcesses(process.argv.slice(3));
      return;
    case "env":
      await showEnv();
      return;
    case "bootstrap-user": {
      const metadata = await resolveMetadata();
      await ensureDatabase(metadata);
      await ensureDatabaseExtensions(metadata);
      await ensureDatabaseRole(metadata);
      await runDbPush(metadata);
      await bootstrapDeveloperUser(metadata);
      if (!(await syncCliProfileFromLocalSession(metadata))) {
        console.warn("[worktree] no local session available to seed CLI auth");
      }
      return;
    }
    default:
      printHelp();
      fail(`Unknown command "${command}"`);
  }
}

await main();
