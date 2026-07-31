import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteReturning: vi.fn<() => Promise<Array<{ id: string }>>>(),
  sessionFindFirst: vi.fn<() => Promise<{ lastActivityAt: Date } | null>>(),
  workspaceMemberFindFirst:
    vi.fn<() => Promise<{ workspace: { sessionIdleTimeoutMinutes: number | null } } | null>>(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      session: { findFirst: mocks.sessionFindFirst },
      workspaceMember: { findFirst: mocks.workspaceMemberFindFirst },
    },
    delete: () => ({
      where: () => ({ returning: mocks.deleteReturning }),
    }),
  },
}));

import {
  enforceWorkspaceSessionIdleTimeout,
  isSessionIdleExpired,
} from "./workspace-session-timeout";

describe("isSessionIdleExpired", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");

  it("expires a session at the configured inactivity boundary", () => {
    expect(
      isSessionIdleExpired(
        {
          createdAt: new Date("2026-07-31T10:00:00.000Z"),
          lastActivityAt: new Date("2026-07-31T11:45:00.000Z"),
        },
        15,
        now,
      ),
    ).toBe(true);
  });

  it("keeps a recently active session", () => {
    expect(
      isSessionIdleExpired(
        {
          createdAt: new Date("2026-07-31T10:00:00.000Z"),
          lastActivityAt: new Date("2026-07-31T11:46:00.000Z"),
        },
        15,
        now,
      ),
    ).toBe(false);
  });

  it("falls back to session creation for sessions without an activity timestamp", () => {
    expect(
      isSessionIdleExpired(
        { createdAt: new Date("2026-07-31T11:00:00.000Z"), lastActivityAt: null },
        30,
        now,
      ),
    ).toBe(true);
  });
});

describe("enforceWorkspaceSessionIdleTimeout", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceMemberFindFirst.mockResolvedValue({
      workspace: { sessionIdleTimeoutMinutes: 15 },
    });
    mocks.deleteReturning.mockResolvedValue([{ id: "session-1" }]);
    mocks.sessionFindFirst.mockResolvedValue(null);
  });

  it("enforces the default Workspace when the session has no active Workspace id", async () => {
    await expect(
      enforceWorkspaceSessionIdleTimeout(
        {
          id: "session-1",
          token: "token",
          userId: "user-1",
          createdAt: new Date("2026-07-31T10:00:00.000Z"),
          updatedAt: new Date("2026-07-31T10:00:00.000Z"),
          expiresAt: new Date("2026-08-01T12:00:00.000Z"),
          ipAddress: null,
          userAgent: null,
          activeOrganizationId: null,
          lastActivityAt: new Date("2026-07-31T11:30:00.000Z"),
        },
        now,
      ),
    ).resolves.toBe(false);

    expect(mocks.workspaceMemberFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.deleteReturning).toHaveBeenCalledTimes(1);
  });

  it("does not revoke when the Workspace policy is disabled", async () => {
    mocks.workspaceMemberFindFirst.mockResolvedValue({
      workspace: { sessionIdleTimeoutMinutes: null },
    });

    await expect(
      enforceWorkspaceSessionIdleTimeout(
        {
          id: "session-1",
          token: "token",
          userId: "user-1",
          createdAt: new Date("2026-07-31T10:00:00.000Z"),
          updatedAt: new Date("2026-07-31T10:00:00.000Z"),
          expiresAt: new Date("2026-08-01T12:00:00.000Z"),
          ipAddress: null,
          userAgent: null,
          activeOrganizationId: null,
          lastActivityAt: new Date("2026-07-31T10:00:00.000Z"),
        },
        now,
      ),
    ).resolves.toBe(true);

    expect(mocks.deleteReturning).not.toHaveBeenCalled();
  });
});
