import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { hashMagicLinkToken } from "./magic-link-token-hash";

const {
  deleteWhereMock,
  deleteMock,
  insertValuesMock,
  onConflictDoUpdateMock,
  insertMock,
  findFirstMock,
  updateWhereMock,
  updateSetMock,
  updateMock,
} = vi.hoisted(() => {
  const deleteWhereMock = vi.fn<VitestProcedure>();
  const onConflictDoUpdateMock = vi.fn<VitestProcedure>();
  const insertValuesMock = vi.fn<VitestProcedure>(() => ({
    onConflictDoUpdate: onConflictDoUpdateMock,
  }));
  const deleteMock = vi.fn<VitestProcedure>(() => ({
    where: deleteWhereMock,
  }));
  const insertMock = vi.fn<VitestProcedure>(() => ({
    values: insertValuesMock,
  }));
  const findFirstMock = vi.fn<VitestProcedure>();
  const updateWhereMock = vi.fn<VitestProcedure>();
  const updateSetMock = vi.fn<VitestProcedure>(() => ({
    where: updateWhereMock,
  }));
  const updateMock = vi.fn<VitestProcedure>(() => ({
    set: updateSetMock,
  }));

  return {
    deleteWhereMock,
    deleteMock,
    insertValuesMock,
    onConflictDoUpdateMock,
    insertMock,
    findFirstMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
  };
});

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    delete: deleteMock,
    insert: insertMock,
    update: updateMock,
    query: {
      magicLinkRequestState: {
        findFirst: findFirstMock,
      },
    },
  },
}));

import {
  createMagicLinkRequestState,
  getMagicLinkRequestState,
  MAGIC_LINK_REQUEST_STATE_RETENTION_MS,
  MAGIC_LINK_REQUEST_TTL_MS,
  markMagicLinkRequestConsumed,
  resolveMagicLinkPageState,
} from "./magic-link-request-state";

describe("magic-link-request-state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    vi.clearAllMocks();
    deleteWhereMock.mockResolvedValue(undefined);
    onConflictDoUpdateMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores redirect targets keyed by a token hash", async () => {
    const requestState = await createMagicLinkRequestState({
      token: "abc123",
      email: "pilot@cmdclaw.ai",
      verificationUrl:
        "https://cmdclaw.ai/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fchat&newUserCallbackURL=%2Fwelcome&errorCallbackURL=%2Flogin%3Ferror%3Dmagic-link",
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/welcome",
      errorCallbackUrl: "/login?error=magic-link",
      status: "pending",
      consumedAt: null,
      expiresAt: new Date(Date.now() + MAGIC_LINK_REQUEST_TTL_MS),
    });
    expect(requestState).toMatchObject({
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/welcome",
      errorCallbackUrl: "/login?error=magic-link",
      status: "pending",
      consumedAt: null,
    });
  });

  it("cleans up rows only after the retention window", async () => {
    await createMagicLinkRequestState({
      token: "abc123",
      email: "pilot@cmdclaw.ai",
      verificationUrl: "https://cmdclaw.ai/api/auth/magic-link/verify?token=abc123",
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock.mock.calls[0]).toBeDefined();
    expect(MAGIC_LINK_REQUEST_STATE_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns a stored row for a token", async () => {
    const row = {
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
      status: "pending" as const,
      consumedAt: null,
      expiresAt: new Date("2026-03-20T12:30:00.000Z"),
      createdAt: new Date("2026-03-20T11:30:00.000Z"),
    };
    findFirstMock.mockResolvedValue(row);

    await expect(getMagicLinkRequestState("abc123")).resolves.toEqual(row);
  });

  it("resolves a pending page state", async () => {
    findFirstMock.mockResolvedValue({
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
      status: "pending",
      consumedAt: null,
      expiresAt: new Date("2026-03-20T12:30:00.000Z"),
      createdAt: new Date("2026-03-20T11:00:00.000Z"),
    });

    await expect(resolveMagicLinkPageState("abc123")).resolves.toEqual({
      status: "pending",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });
  });

  it("resolves an expired page state", async () => {
    findFirstMock.mockResolvedValue({
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
      status: "pending",
      consumedAt: null,
      expiresAt: new Date("2026-03-20T11:59:59.000Z"),
      createdAt: new Date("2026-03-20T11:00:00.000Z"),
    });

    await expect(resolveMagicLinkPageState("abc123")).resolves.toEqual({
      status: "expired",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });
  });

  it("resolves a consumed page state", async () => {
    findFirstMock.mockResolvedValue({
      tokenHash: hashMagicLinkToken("abc123"),
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
      status: "consumed",
      consumedAt: new Date("2026-03-20T11:30:00.000Z"),
      expiresAt: new Date("2026-03-20T12:30:00.000Z"),
      createdAt: new Date("2026-03-20T11:00:00.000Z"),
    });

    await expect(resolveMagicLinkPageState("abc123")).resolves.toEqual({
      status: "consumed",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });
  });

  it("resolves an invalid page state when the row is missing", async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(resolveMagicLinkPageState("abc123")).resolves.toEqual({
      status: "invalid",
      email: null,
      callbackUrl: null,
      newUserCallbackUrl: null,
      errorCallbackUrl: null,
    });
  });

  it("marks a pending request as consumed", async () => {
    await markMagicLinkRequestConsumed("abc123");

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
      status: "consumed",
      consumedAt: new Date("2026-03-20T12:00:00.000Z"),
    });
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });
});
