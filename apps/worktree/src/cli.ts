import { rmSync } from "node:fs";
import { join } from "node:path";

import { formatWorktreeStackSlot } from "./stack";
import {
  MAX_RUNNING_WORKTREE_WEB_PROCESSES,
  summarizeRunningWorktreeWebProcesses,
} from "./start-guard";
import {
  collectWorktreeProcessCleanupCandidates,
  type WorktreeProcessCleanupCandidate,
} from "./process-cleanup";
import {
  agentBrowserSessionName,
  buildHealthCheckUrl,
  DEV_START_TIMEOUT_MS,
  ensureDir,
  fail,
  loadSharedEnv,
  logsDir,
  normalizePath,
  PROCESS_NAMES,
  printHelp,
  resolveRepoRoot,
  resolveSharedWorktreeInstancesPath,
  resolveSharedWorktreeLocksPath,
  type CommandName,
  type InstanceMetadata,
} from "./cli-runtime";
import {
  buildPostgresAdminUrl,
  buildWorktreeRuntimeEnv,
  dropDatabase,
  dropDatabaseRole,
  dropMinioTenant,
  dropRedisAclUser,
  ensureDatabase,
  ensureDatabaseExtensions,
  ensureDatabaseRole,
  ensureMinioTenant,
  ensureRedisAclUser,
} from "./cli-resources";
import {
  assertWorktreeWebStartAllowed,
  buildWorktreeWebProcessSnapshots,
  ensureDockerDaemonAvailable,
  ensureSharedInfraRunning,
  formatPidList,
  formatProcessCommand,
  formatServiceName,
  groupWebDevProcesses,
  listKnownWorktreeMetadata,
  listSystemProcesses,
  listWebDevProcessesForWorktree,
  printStatusEndpoints,
  teardownDockerResources,
} from "./cli-docker";
import {
  getProcessEntries,
  isPidRunning,
  killProcessGroup,
  terminateProcess,
  waitForProcessesToExit,
} from "./cli-process";
import {
  formatSlotConflict,
  isRecognizedWorktreeRepo,
  isSlotActivelyOwnedByInstance,
  listDockerProjectContainers,
  loadProcesses,
  removeProcessesFile,
  removeSlotLease,
  resolveRecognizedWorktreeRoots,
  resolveSlotConflicts,
  saveProcesses,
} from "./cli-state";
import {
  bootstrapDeveloperUser,
  buildProcessCommand,
  closeAgentBrowserSession,
  createInstance,
  resolveMetadata,
  runDbPush,
  spawnWithEnv,
  syncCliProfileFromLocalSession,
  waitForDatabaseReady,
  waitForHttp,
} from "./cli-bootstrap";

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
    const hasRunningWebDevProcess =
      listWebDevProcessesForWorktree(metadata, systemProcesses).length > 0;
    return hasRunningTrackedProcess || hasRunningWebDevProcess;
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

  const remainingWebDevPids = activeMetadata
    .flatMap((metadata) => listWebDevProcessesForWorktree(metadata, listSystemProcesses()))
    .map((processEntry) => processEntry.pid);
  const uniqueRemainingWebDevPids = Array.from(new Set(remainingWebDevPids)).sort((left, right) =>
    right - left,
  );

  if (uniqueRemainingWebDevPids.length > 0) {
    console.log(
      `[worktree] stopping ${uniqueRemainingWebDevPids.length} remaining web dev process(es): ${formatPidList(uniqueRemainingWebDevPids)}`,
    );
    for (const pid of uniqueRemainingWebDevPids) {
      terminateProcess(pid);
    }

    const stillRunning = await waitForProcessesToExit(uniqueRemainingWebDevPids, 10_000);
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
    const webDevProcesses = listWebDevProcessesForWorktree(metadata, systemProcesses);
    const hasRunningTrackedProcess = entries.some((entry) => isPidRunning(entry.pid));
    const hasRunningWebDevProcess = webDevProcesses.length > 0;

    if (!hasRunningTrackedProcess && !hasRunningWebDevProcess) {
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

    if (webDevProcesses.length === 0) {
      console.log("  web: none");
    } else {
      console.log(`  web (${webDevProcesses.length} processes):`);
      for (const group of groupWebDevProcesses(webDevProcesses)) {
        console.log(`    ${group.label}: ${formatPidList(group.pids)}`);
      }

      if (verbose) {
        console.log("  commands:");
        for (const processEntry of webDevProcesses) {
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
