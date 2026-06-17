export const MAX_RUNNING_WORKTREE_WEB_PROCESSES = 10;

export type WorktreeWebProcessSnapshot = {
  repoRoot: string;
  recognized: boolean;
  webPid: number | null;
  webRunning: boolean;
};

export type WorktreeWebProcessSummary = {
  totalRunning: number;
  currentWorktreeOwnsRunningWeb: boolean;
  runningRepoRoots: string[];
};

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function summarizeRunningWorktreeWebProcesses(params: {
  currentRepoRoot: string;
  snapshots: WorktreeWebProcessSnapshot[];
}): WorktreeWebProcessSummary {
  const normalizedCurrentRepoRoot = normalizePath(params.currentRepoRoot);
  const runningRepoRoots = params.snapshots
    .filter((snapshot) => snapshot.recognized && snapshot.webPid !== null && snapshot.webRunning)
    .map((snapshot) => normalizePath(snapshot.repoRoot));

  return {
    totalRunning: runningRepoRoots.length,
    currentWorktreeOwnsRunningWeb: runningRepoRoots.includes(normalizedCurrentRepoRoot),
    runningRepoRoots,
  };
}

export function shouldBlockStartingWorktreeWeb(
  summary: WorktreeWebProcessSummary,
  maxRunning: number = MAX_RUNNING_WORKTREE_WEB_PROCESSES,
): boolean {
  return !summary.currentWorktreeOwnsRunningWeb && summary.totalRunning >= maxRunning;
}
