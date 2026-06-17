import { describe, expect, test } from "vitest";

import {
  buildWorktreeSlotLease,
  isWorktreeSlotLeaseFresh,
  isWorktreeSlotLeaseOwnedByInstance,
  refreshWorktreeSlotLease,
  resolveConfiguredSharedWorktreeRoot,
  resolveSharedWorktreeInstanceRoot,
  resolveSharedWorktreeInstancesDir,
  resolveSharedWorktreeRoot,
  resolveSharedWorktreeSlotLeasePath,
  SLOT_LEASE_STALE_GRACE_MS,
} from "./coordination";

describe("worktree coordination helpers", () => {
  test("resolves the shared coordination root under ~/.bap/worktrees", () => {
    expect(resolveSharedWorktreeRoot("/Users/example")).toBe("/Users/example/.bap/worktrees");
  });

  test("derives deterministic slot lease paths", () => {
    expect(resolveSharedWorktreeSlotLeasePath("/Users/example/.bap/worktrees", 2)).toBe(
      "/Users/example/.bap/worktrees/locks/slot-02.json",
    );
  });

  test("derives deterministic shared instance paths", () => {
    expect(resolveSharedWorktreeInstancesDir("/Users/example/.bap/worktrees")).toBe(
      "/Users/example/.bap/worktrees/instances",
    );
    expect(
      resolveSharedWorktreeInstanceRoot(
        "/Users/example/.bap/worktrees",
        "bap-1234abcd",
      ),
    ).toBe("/Users/example/.bap/worktrees/instances/bap-1234abcd");
  });

  test("resolves configured shared worktree roots from explicit or default values", () => {
    expect(
      resolveConfiguredSharedWorktreeRoot({
        cwd: "/repo",
        homeDir: "/Users/example",
        explicitRoot: null,
      }),
    ).toBe("/Users/example/.bap/worktrees");

    expect(
      resolveConfiguredSharedWorktreeRoot({
        cwd: "/repo",
        homeDir: "/Users/example",
        explicitRoot: "~/custom-worktrees",
      }),
    ).toBe("/Users/example/custom-worktrees");

    expect(
      resolveConfiguredSharedWorktreeRoot({
        cwd: "/repo",
        homeDir: "/Users/example",
        explicitRoot: "tmp/worktrees",
      }),
    ).toBe("/repo/tmp/worktrees");
  });

  test("builds and refreshes slot lease records", () => {
    const lease = buildWorktreeSlotLease({
      slot: 2,
      instanceId: "bap-1234abcd",
      repoRoot: "/tmp/worktree",
      pid: 42,
      now: new Date("2026-04-25T07:30:00.000Z"),
    });

    expect(lease).toMatchObject({
      version: 1,
      slot: 2,
      instanceId: "bap-1234abcd",
      repoRoot: "/tmp/worktree",
      pid: 42,
      createdAt: "2026-04-25T07:30:00.000Z",
      updatedAt: "2026-04-25T07:30:00.000Z",
    });

    expect(
      refreshWorktreeSlotLease(lease, new Date("2026-04-25T07:31:00.000Z")).updatedAt,
    ).toBe("2026-04-25T07:31:00.000Z");
  });

  test("matches lease ownership by repo root and instance id", () => {
    const lease = buildWorktreeSlotLease({
      slot: 2,
      instanceId: "bap-1234abcd",
      repoRoot: "/tmp/worktree",
      pid: 42,
      now: new Date("2026-04-25T07:30:00.000Z"),
    });

    expect(
      isWorktreeSlotLeaseOwnedByInstance(lease, {
        instanceId: "bap-1234abcd",
        repoRoot: "/tmp/worktree",
      }),
    ).toBe(true);

    expect(
      isWorktreeSlotLeaseOwnedByInstance(lease, {
        instanceId: "bap-1234abcd",
        repoRoot: "/tmp/other",
      }),
    ).toBe(false);
  });

  test("treats recent leases as fresh and malformed timestamps as stale", () => {
    expect(
      isWorktreeSlotLeaseFresh(
        { updatedAt: "2026-04-25T07:30:30.000Z" },
        new Date("2026-04-25T07:31:00.000Z"),
        SLOT_LEASE_STALE_GRACE_MS,
      ),
    ).toBe(true);

    expect(
      isWorktreeSlotLeaseFresh(
        { updatedAt: "not-a-date" },
        new Date("2026-04-25T07:31:00.000Z"),
        SLOT_LEASE_STALE_GRACE_MS,
      ),
    ).toBe(false);
  });
});
