import { hostname } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import { formatWorktreeStackSlot } from "./stack";

const DEFAULT_SHARED_WORKTREE_ROOT = ".cmdclaw/worktrees";
export const SLOT_LEASE_STALE_GRACE_MS = 60_000;

export type WorktreeSlotLease = {
  version: 1;
  slot: number;
  instanceId: string;
  repoRoot: string;
  tool: string;
  hostname: string;
  pid: number;
  createdAt: string;
  updatedAt: string;
};

export function resolveSharedWorktreeRoot(homeDir: string): string {
  if (!homeDir) {
    throw new Error("HOME is not set, unable to resolve the shared worktree root.");
  }

  return join(homeDir, DEFAULT_SHARED_WORKTREE_ROOT);
}

export function resolveConfiguredSharedWorktreeRoot(params: {
  cwd: string;
  homeDir?: string;
  explicitRoot?: string | null;
}): string {
  const explicitRoot = params.explicitRoot?.trim();
  if (explicitRoot) {
    if (explicitRoot.startsWith("~/")) {
      if (!params.homeDir) {
        throw new Error(`Unable to expand ${explicitRoot}: HOME is not set.`);
      }

      return join(params.homeDir, explicitRoot.slice(2));
    }

    if (isAbsolute(explicitRoot)) {
      return explicitRoot;
    }

    return resolvePath(params.cwd, explicitRoot);
  }

  return resolveSharedWorktreeRoot(params.homeDir ?? "");
}

export function resolveSharedWorktreeLocksDir(sharedRoot: string): string {
  return join(sharedRoot, "locks");
}

export function resolveSharedWorktreeInstancesDir(sharedRoot: string): string {
  return join(sharedRoot, "instances");
}

export function resolveSharedWorktreeInstanceRoot(sharedRoot: string, instanceId: string): string {
  return join(resolveSharedWorktreeInstancesDir(sharedRoot), instanceId);
}

export function resolveSharedWorktreeSlotLeasePath(sharedRoot: string, slot: number): string {
  return join(resolveSharedWorktreeLocksDir(sharedRoot), `slot-${formatWorktreeStackSlot(slot)}.json`);
}

export function buildWorktreeSlotLease(params: {
  slot: number;
  instanceId: string;
  repoRoot: string;
  tool?: string;
  pid?: number;
  now?: Date;
}): WorktreeSlotLease {
  const now = params.now ?? new Date();
  const timestamp = now.toISOString();

  return {
    version: 1,
    slot: params.slot,
    instanceId: params.instanceId,
    repoRoot: params.repoRoot,
    tool: params.tool?.trim() || "cmdclaw-worktree",
    hostname: hostname(),
    pid: params.pid ?? process.pid,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function refreshWorktreeSlotLease(
  lease: WorktreeSlotLease,
  now: Date = new Date(),
): WorktreeSlotLease {
  return {
    ...lease,
    updatedAt: now.toISOString(),
  };
}

export function isWorktreeSlotLeaseOwnedByInstance(
  lease: Pick<WorktreeSlotLease, "instanceId" | "repoRoot">,
  owner: { instanceId: string; repoRoot: string },
): boolean {
  return lease.instanceId === owner.instanceId && lease.repoRoot === owner.repoRoot;
}

export function isWorktreeSlotLeaseFresh(
  lease: Pick<WorktreeSlotLease, "updatedAt">,
  now: Date = new Date(),
  graceMs: number = SLOT_LEASE_STALE_GRACE_MS,
): boolean {
  const updatedAt = Date.parse(lease.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  return now.getTime() - updatedAt < graceMs;
}
