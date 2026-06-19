export type SystemProcess = {
  pid: number;
  ppid: number;
  command: string;
};

export type WorktreeProcessCleanupCandidate = {
  pid: number;
  ppid: number;
  command: string;
};

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function isWebDevProcessCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    normalized.includes("/node_modules/.bin/vite ") ||
    normalized.includes("/node_modules/vite/bin/") ||
    /\bbun\s+--env-file(?:=|\s+)\S+\/\.env\s+vite\s+dev\b/.test(normalized) ||
    /\bvite\s+(?:--host\s+\S+\s+)?dev\b/.test(normalized) ||
    /\bvite\s+dev\b/.test(normalized)
  );
}

export function isWorktreeServiceProcessCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    isWebDevProcessCommand(command) ||
    /\bbun\s+--env-file(?:=|\s+)\S+\/\.env\s+index\.ts\b/.test(normalized) ||
    /\bbun\s+(?:--watch\s+)?--env-file(?:=|\s+)\S+\/\.env\s+src\/proxy\.ts\b/.test(
      normalized,
    ) ||
    /\bbun\s+(?:--watch\s+)?(?:--env-file(?:=|\s+)\S+\/\.env\s+)?scripts\/local-tunnel\.ts\b/.test(
      normalized,
    )
  );
}

export function buildDescendantPidSet(
  processes: SystemProcess[],
  rootPids: number[],
): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const processEntry of processes) {
    const children = childrenByParent.get(processEntry.ppid) ?? [];
    children.push(processEntry.pid);
    childrenByParent.set(processEntry.ppid, children);
  }

  const descendants = new Set<number>();
  const queue = rootPids.filter((pid) => pid > 0);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || descendants.has(pid)) {
      continue;
    }

    descendants.add(pid);
    queue.push(...(childrenByParent.get(pid) ?? []));
  }

  return descendants;
}

function commandMatchesWorktreeRoot(command: string, roots: string[]): boolean {
  const normalizedCommand = normalizePath(command);
  return roots.some((root) => normalizedCommand.includes(normalizePath(root)));
}

export function collectWorktreeProcessCleanupCandidates(params: {
  processes: SystemProcess[];
  worktreeRoots: string[];
  protectedRootPids?: number[];
}): WorktreeProcessCleanupCandidate[] {
  const worktreeRoots = Array.from(new Set(params.worktreeRoots.map(normalizePath))).filter(Boolean);
  if (worktreeRoots.length === 0) {
    return [];
  }

  const protectedPids = buildDescendantPidSet(params.processes, params.protectedRootPids ?? []);
  const rootPids = params.processes
    .filter((processEntry) => {
      if (protectedPids.has(processEntry.pid)) {
        return false;
      }

      return (
        isWorktreeServiceProcessCommand(processEntry.command) &&
        commandMatchesWorktreeRoot(processEntry.command, worktreeRoots)
      );
    })
    .map((processEntry) => processEntry.pid);

  const candidatePids = buildDescendantPidSet(params.processes, rootPids);
  return params.processes
    .filter((processEntry) => candidatePids.has(processEntry.pid) && !protectedPids.has(processEntry.pid))
    .map((processEntry) => ({
      pid: processEntry.pid,
      ppid: processEntry.ppid,
      command: processEntry.command,
    }))
    .sort((left, right) => left.pid - right.pid);
}
