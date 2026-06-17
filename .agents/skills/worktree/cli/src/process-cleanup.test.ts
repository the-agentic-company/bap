import { describe, expect, test } from "vitest";

import {
  collectWorktreeProcessCleanupCandidates,
  type SystemProcess,
} from "./process-cleanup";

describe("worktree process cleanup", () => {
  test("collects an untracked web dev process tree under a recognized worktree root", () => {
    const processes: SystemProcess[] = [
      {
        pid: 10,
        ppid: 1,
        command:
          "bun --env-file /Users/dev/.codex/worktrees/abcd/bap/.env vite dev --host 0.0.0.0 --port 3718",
      },
      {
        pid: 11,
        ppid: 10,
        command:
          "node /Users/dev/.codex/worktrees/abcd/bap/apps/web/node_modules/.bin/vite dev --host 0.0.0.0 --port 3718",
      },
      {
        pid: 12,
        ppid: 11,
        command:
          "node /Users/dev/.codex/worktrees/abcd/bap/apps/web/node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3718",
      },
    ];

    expect(
      collectWorktreeProcessCleanupCandidates({
        processes,
        worktreeRoots: ["/Users/dev/.codex/worktrees"],
      }).map((processEntry) => processEntry.pid),
    ).toEqual([10, 11, 12]);
  });

  test("protects tracked background web process descendants", () => {
    const processes: SystemProcess[] = [
      {
        pid: 20,
        ppid: 1,
        command:
          "bun --env-file /Users/dev/.codex/worktrees/tracked/bap/.env vite dev --host 0.0.0.0 --port 3701",
      },
      {
        pid: 21,
        ppid: 20,
        command:
          "node /Users/dev/.codex/worktrees/tracked/bap/apps/web/node_modules/.bin/vite dev --host 0.0.0.0 --port 3701",
      },
      {
        pid: 22,
        ppid: 21,
        command:
          "node /Users/dev/.codex/worktrees/tracked/bap/apps/web/node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3701",
      },
      {
        pid: 30,
        ppid: 1,
        command:
          "bun --env-file /Users/dev/.codex/worktrees/orphan/bap/.env vite dev --host 0.0.0.0 --port 3702",
      },
    ];

    expect(
      collectWorktreeProcessCleanupCandidates({
        processes,
        worktreeRoots: ["/Users/dev/.codex/worktrees"],
        protectedRootPids: [20],
      }).map((processEntry) => processEntry.pid),
    ).toEqual([30]);
  });

  test("ignores web dev processes outside recognized worktree roots", () => {
    const processes: SystemProcess[] = [
      {
        pid: 40,
        ppid: 1,
        command:
          "bun --env-file /Users/dev/Git/bap/.env vite dev --host 0.0.0.0 --port 3000",
      },
      {
        pid: 41,
        ppid: 40,
        command:
          "node /Users/dev/Git/bap/apps/web/node_modules/.bin/vite dev --host 0.0.0.0 --port 3000",
      },
    ];

    expect(
      collectWorktreeProcessCleanupCandidates({
        processes,
        worktreeRoots: ["/Users/dev/.codex/worktrees"],
      }),
    ).toEqual([]);
  });

  test("collects orphaned worktree worker and websocket services", () => {
    const processes: SystemProcess[] = [
      {
        pid: 50,
        ppid: 1,
        command: "bun --env-file /Users/dev/.codex/worktrees/old/bap/.env index.ts",
      },
      {
        pid: 51,
        ppid: 1,
        command: "bun --env-file /Users/dev/.codex/worktrees/old/bap/.env index.ts",
      },
      {
        pid: 60,
        ppid: 1,
        command: "bun --env-file /Users/dev/Git/bap/.env index.ts",
      },
    ];

    expect(
      collectWorktreeProcessCleanupCandidates({
        processes,
        worktreeRoots: ["/Users/dev/.codex/worktrees"],
      }).map((processEntry) => processEntry.pid),
    ).toEqual([50, 51]);
  });
});
