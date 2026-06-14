import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import {
  buildWorktreeSlotLease,
  isWorktreeSlotLeaseFresh,
  isWorktreeSlotLeaseOwnedByInstance,
  refreshWorktreeSlotLease,
  resolveSharedWorktreeInstanceRoot,
  type WorktreeSlotLease,
} from "./coordination";
import { buildWorktreeHostPorts, type WorktreeHostPort } from "./stack";
import {
  buildDatabaseUrlForMetadata,
  buildInstanceId,
  buildMinioAccessKeyId,
  buildMinioBucketName,
  buildRedisUser,
  buildDatabaseUser,
  ensureDir,
  expandPath,
  fail,
  generateCredentialSecret,
  metadataPath,
  normalizePath,
  parseStackSlot,
  processPath,
  resolveSharedWorktreeInstancesPath,
  resolveSharedWorktreeLocksPath,
  resolveSharedWorktreeRootPath,
  resolveSlotLeasePath,
  type InstanceMetadata,
  type InstanceProcesses,
} from "./cli-runtime";
import { hasRunningTrackedProcesses } from "./cli-process";
import { loadMetadataForRepoRoot } from "./cli-docker";

export type SlotPortState = WorktreeHostPort & {
  available: boolean;
  owner: string | null;
};

export function resolveLegacyStateRoot(repoRoot: string): string {
  return join(repoRoot, ".worktrees");
}

export function resolveLegacyInstanceRoot(repoRoot: string, instanceId: string): string {
  return join(resolveLegacyStateRoot(repoRoot), instanceId);
}

export function resolveInstanceRootForRepoRoot(repoRoot: string): string {
  return resolveSharedWorktreeInstanceRoot(resolveSharedWorktreeRootPath(), buildInstanceId(repoRoot));
}

export function pruneLegacyStateRootIfEmpty(repoRoot: string): void {
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

export function migrateLegacyInstanceRoot(repoRoot: string): string {
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

export function resolveRecognizedWorktreeRoots(): string[] {
  const configured = process.env.BAP_WORKTREE_STATUS_PATHS?.trim();
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

export function hasRecognizedWorktreePathSegment(repoRoot: string): boolean {
  const normalizedRepoRoot = normalizePath(repoRoot);
  return ["/.claude/worktrees/", "/.codex/worktrees/"].some((segment) =>
    normalizedRepoRoot.includes(segment),
  );
}

export function isRecognizedWorktreeRepo(repoRoot: string): boolean {
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

export function loadMetadata(instanceRoot: string): InstanceMetadata | null {
  const path = metadataPath(instanceRoot);
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8")) as InstanceMetadata;
}

export function saveMetadata(metadata: InstanceMetadata): void {
  ensureDir(metadata.instanceRoot);
  writeFileSync(metadataPath(metadata.instanceRoot), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function loadProcesses(instanceRoot: string): InstanceProcesses {
  const path = processPath(instanceRoot);
  if (!existsSync(path)) {
    return {};
  }

  return JSON.parse(readFileSync(path, "utf8")) as InstanceProcesses;
}

export function saveProcesses(instanceRoot: string, processes: InstanceProcesses): void {
  ensureDir(instanceRoot);
  writeFileSync(processPath(instanceRoot), `${JSON.stringify(processes, null, 2)}\n`, "utf8");
}

export function removeProcessesFile(instanceRoot: string): void {
  const path = processPath(instanceRoot);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function loadSlotLease(slot: number): WorktreeSlotLease | null {
  const path = resolveSlotLeasePath(slot);
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8")) as WorktreeSlotLease;
}

export function writeSlotLease(lease: WorktreeSlotLease, mode: "create" | "update"): boolean {
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

export function removeSlotLease(
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

export function hydrateMetadataCredentials(metadata: InstanceMetadata): InstanceMetadata {
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

export function buildAppPorts(stackSlot: number): { appPort: number; wsPort: number } {
  return {
    appPort: 3700 + stackSlot,
    wsPort: 4700 + stackSlot,
  };
}

export async function isPortAvailable(port: number): Promise<boolean> {
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

export function describePortOwner(port: number): string | null {
  return describeDockerPortOwner(port) ?? describeListeningPortOwner(port);
}

export async function resolveSlotPortState(slot: number): Promise<SlotPortState[]> {
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

export async function resolveSlotConflicts(slot: number): Promise<SlotPortState[]> {
  return (await resolveSlotPortState(slot)).filter((entry) => !entry.available);
}

export function formatSlotConflict(conflict: SlotPortState): string {
  return `${conflict.name}:${conflict.port}${conflict.owner ? ` (${conflict.owner})` : ""}`;
}

export function listDockerProjectContainers(metadata: InstanceMetadata): string[] {
  void metadata;
  return [];
}

export function isSlotActivelyOwnedByInstance(metadata: InstanceMetadata): boolean {
  return hasRunningTrackedProcesses(metadata) || listDockerProjectContainers(metadata).length > 0;
}

export function isSlotLeaseStale(lease: WorktreeSlotLease): boolean {
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

export async function canUseReservedSlot(slot: number, existing: InstanceMetadata | null): Promise<boolean> {
  const conflicts = await resolveSlotConflicts(slot);
  if (conflicts.length === 0) {
    return true;
  }

  return existing?.stackSlot === slot && isSlotActivelyOwnedByInstance(existing);
}

export type SlotReservationAttempt =
  | { status: "reserved" }
  | { status: "busy"; reason: string };

export async function tryReserveStackSlot(
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

export async function reserveStackSlot(
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
