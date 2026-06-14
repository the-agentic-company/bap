import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client as PgClient } from "pg";

import {
  buildSharedStackConfig,
  formatWorktreeStackSlot,
} from "./stack";
import {
  MAX_RUNNING_WORKTREE_WEB_PROCESSES,
  shouldBlockStartingWorktreeWeb,
  summarizeRunningWorktreeWebProcesses,
  type WorktreeWebProcessSnapshot,
} from "./start-guard";
import {
  buildDescendantPidSet,
  isWebDevProcessCommand,
  type SystemProcess,
} from "./process-cleanup";
import {
  buildHealthCheckUrl,
  buildInstanceId,
  buildLoopbackUrl,
  buildDatabaseUrlForMetadata,
  clearSharedStackRuntimeCache,
  fail,
  GENERATED_WORKTREE_ENV_HEADER,
  GENERATED_WORKTREE_ENV_NOTICE,
  isGeneratedWorktreeEnvFile,
  normalizePath,
  quoteIdentifier,
  resolveRuntimeSharedStackConfig,
  resolveSharedWorktreeInstancesPath,
  resolveSharedEnvFile,
  resolveWorktreeEnvFile,
  runCommand,
  WORKTREE_START_LIMIT_ERROR,
  type InstanceMetadata,
  type InstanceProcesses,
  type ProcessName,
} from "./cli-runtime";
import {
  buildCommentedWorktreeEnv,
  buildSharedComposeEnv,
  buildWorktreeRuntimeEnv,
} from "./cli-resources";
import {
  isRecognizedWorktreeRepo,
  loadMetadata,
  loadProcesses,
  migrateLegacyInstanceRoot,
  resolveInstanceRootForRepoRoot,
  resolveLegacyInstanceRoot,
} from "./cli-state";
import { isPidRunning } from "./cli-process";

export function runInheritedCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit ${result.status ?? 1}`);
  }
}

export function ensureDockerDaemonAvailable(): void {
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

export function isDockerInstalled(): boolean {
  const result = spawnSync("docker", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0;
}

export function isDockerDaemonReachable(): boolean {
  const result = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0;
}

export function printStatusEndpoints(metadata: InstanceMetadata): void {
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

export function isDockerPortAllocationFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("port is already allocated") || normalized.includes("bind for 0.0.0.0:");
}

export async function ensureWorktreeDockerStackUp(metadata: InstanceMetadata): Promise<InstanceMetadata> {
  return metadata;
}

export function runSharedServiceCommand(
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
      env.BAP_COMPOSE_PROJECT ?? buildSharedStackConfig().composeProjectName,
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

export function isDockerComposeServiceRunning(projectName: string, service: string): boolean {
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

export function ensureSharedInfraRunning(repoRoot: string): void {
  const env = buildSharedComposeEnv(repoRoot);
  const projectName = env.BAP_COMPOSE_PROJECT ?? buildSharedStackConfig().composeProjectName;
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

export function listDockerProjectContainerIds(metadata: InstanceMetadata): string[] {
  void metadata;
  return [];
}

export function teardownDockerResources(metadata: InstanceMetadata): void {
  void metadata;
}

export function resolveSourceRepoRoot(targetRepoRoot: string): string | null {
  const explicit =
    process.env.BAP_WORKTREE_SOURCE_TREE_PATH?.trim() || process.env.CODEX_SOURCE_TREE_PATH?.trim();
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

export function loadMetadataForRepoRoot(repoRoot: string): InstanceMetadata | null {
  const instanceRoot = resolveInstanceRootForRepoRoot(repoRoot);
  const legacyInstanceRoot = resolveLegacyInstanceRoot(repoRoot, buildInstanceId(repoRoot));
  if (!existsSync(instanceRoot) && existsSync(legacyInstanceRoot)) {
    migrateLegacyInstanceRoot(repoRoot);
  }
  return loadMetadata(instanceRoot);
}

export function loadProcessesForRepoRoot(repoRoot: string): InstanceProcesses {
  const instanceRoot = resolveInstanceRootForRepoRoot(repoRoot);
  const legacyInstanceRoot = resolveLegacyInstanceRoot(repoRoot, buildInstanceId(repoRoot));
  if (!existsSync(instanceRoot) && existsSync(legacyInstanceRoot)) {
    migrateLegacyInstanceRoot(repoRoot);
  }
  return loadProcesses(instanceRoot);
}

export function listLinkedRepoRoots(repoRoot: string): string[] {
  const worktreeList = runCommand("git", ["worktree", "list", "--porcelain"], repoRoot);
  const repoRoots = worktreeList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => normalizePath(line.slice("worktree ".length)));

  return Array.from(new Set(repoRoots));
}

export function buildWorktreeWebProcessSnapshots(currentRepoRoot: string): WorktreeWebProcessSnapshot[] {
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

export function listSharedInstanceMetadata(): InstanceMetadata[] {
  const instancesRoot = resolveSharedWorktreeInstancesPath();
  if (!existsSync(instancesRoot)) {
    return [];
  }

  return readdirSync(instancesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadMetadata(join(instancesRoot, entry.name)))
    .filter((metadata): metadata is InstanceMetadata => metadata !== null);
}

export function listKnownWorktreeMetadata(repoRoot: string): InstanceMetadata[] {
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

export function listSystemProcesses(): SystemProcess[] {
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

export function listWebDevProcessesForWorktree(
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
        isWebDevProcessCommand(processEntry.command)
      );
    })
    .sort((left, right) => left.pid - right.pid);
}

export function formatProcessCommand(command: string): string {
  const maxLength = 160;
  if (command.length <= maxLength) {
    return command;
  }

  return `${command.slice(0, maxLength - 3)}...`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatPidList(pids: number[]): string {
  if (pids.length === 0) {
    return "-";
  }

  if (pids.length === 1) {
    return String(pids[0]);
  }

  return pids.join(", ");
}

export function classifyWebDevProcess(command: string): string {
  if (/\bvite\s+dev\b/.test(command) && command.startsWith("bun ")) {
    return "dev command";
  }

  if (command.includes("/node_modules/.bin/vite ")) {
    return "vite cli";
  }

  if (command.includes("/node_modules/vite/bin/")) {
    return "vite server";
  }

  const fileMatch = command.match(/\/([^/]+\.js)(?:\s|$)/);
  if (fileMatch) {
    return fileMatch[1];
  }

  const basename = command.split(/\s+/)[0]?.split("/").pop();
  return basename && basename !== "(node)" ? basename : "node helper";
}

export function groupWebDevProcesses(processes: SystemProcess[]): Array<{ label: string; pids: number[] }> {
  const groups = new Map<string, number[]>();
  for (const processEntry of processes) {
    const label = classifyWebDevProcess(processEntry.command);
    const pids = groups.get(label) ?? [];
    pids.push(processEntry.pid);
    groups.set(label, pids);
  }

  return [...groups.entries()]
    .map(([label, pids]) => ({ label, pids: pids.sort((left, right) => left - right) }))
    .sort((left, right) => {
      const priority = ["dev command", "vite cli", "vite server"];
      const leftPriority = priority.indexOf(left.label);
      const rightPriority = priority.indexOf(right.label);
      if (leftPriority !== -1 || rightPriority !== -1) {
        return (leftPriority === -1 ? priority.length : leftPriority) -
          (rightPriority === -1 ? priority.length : rightPriority);
      }

      return left.label.localeCompare(right.label);
    });
}

export function formatServiceName(name: ProcessName): string {
  return name.padEnd(6, " ");
}

export function assertWorktreeWebStartAllowed(metadata: InstanceMetadata): void {
  const summary = summarizeRunningWorktreeWebProcesses({
    currentRepoRoot: metadata.repoRoot,
    snapshots: buildWorktreeWebProcessSnapshots(metadata.repoRoot),
  });

  if (shouldBlockStartingWorktreeWeb(summary, MAX_RUNNING_WORKTREE_WEB_PROCESSES)) {
    fail(WORKTREE_START_LIMIT_ERROR);
  }
}

export function resolveSourceDatabaseUrl(targetRepoRoot: string): string | null {
  const explicit = process.env.BAP_WORKTREE_SOURCE_DATABASE_URL?.trim();
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

export function buildJsonStorageState(params: {
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

export function toIdentifierList(columns: string[]): string {
  return columns.map((column) => quoteIdentifier(column)).join(", ");
}

const tableColumnCache = new Map<string, Set<string>>();

export async function getTableColumnSet(client: PgClient, tableName: string): Promise<Set<string>> {
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

export async function upsertRows(
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

export async function selectRows(
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

export function writeDerivedEnvFile(metadata: InstanceMetadata): void {
  const envFile = resolveWorktreeEnvFile(metadata.repoRoot);
  if (existsSync(envFile) && !isGeneratedWorktreeEnvFile(envFile)) {
    fail(
      `Refusing to overwrite non-generated env file at ${envFile}. Run worktree commands from an isolated worktree, or move the shared env file and set BAP_ENV_FILE.`,
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
