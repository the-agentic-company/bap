import { beforeEach, describe, expect, it, vi } from "vitest";

const providerAuthFindFirstMock = vi.fn();
const sharedProviderAuthFindFirstMock = vi.fn();
const txProviderAuthFindFirstMock = vi.fn();
const txSharedProviderAuthFindFirstMock = vi.fn();
const txExecuteMock = vi.fn();
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));
const fetchMock = vi.fn();

const txMock = {
  execute: txExecuteMock,
  query: {
    providerAuth: {
      findFirst: txProviderAuthFindFirstMock,
    },
    sharedProviderAuth: {
      findFirst: txSharedProviderAuthFindFirstMock,
    },
  },
  update: updateMock,
};

const dbMock = {
  query: {
    providerAuth: {
      findFirst: providerAuthFindFirstMock,
      findMany: vi.fn(),
    },
    sharedProviderAuth: {
      findFirst: sharedProviderAuthFindFirstMock,
      findMany: vi.fn(),
    },
  },
  transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => await callback(txMock)),
};

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("../utils/encryption", () => ({
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn((value: string) => value),
}));

vi.mock("../edition", () => ({
  isSelfHostedEdition: vi.fn(() => false),
}));

vi.mock("./client", () => ({
  getCloudManagedProviderAuthStatus: vi.fn(),
  getDelegatedProviderAuths: vi.fn(),
}));

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/cmdclaw_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SANDBOX_DEFAULT ??= "e2b";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_SERVER_SECRET ??= "test-server-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:4566";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.APP_URL ??= "https://app.example.com";

const { getResolvedProviderAuth } = await import("./subscription-providers");

describe("control-plane subscription provider auth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-13T10:00:00.000Z").getTime());
    globalThis.fetch = fetchMock as typeof fetch;
  });

  it("returns still-valid shared OpenAI auth without refreshing", async () => {
    sharedProviderAuthFindFirstMock.mockResolvedValue({
      id: "shared-auth-1",
      provider: "openai",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-04-13T11:00:00.000Z"),
    });

    const auth = await getResolvedProviderAuth({
      userId: "user-1",
      provider: "openai",
      authSource: "shared",
    });

    expect(auth).toEqual({
      provider: "openai",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-04-13T11:00:00.000Z").getTime(),
      authSource: "shared",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes expired shared OpenAI auth under a DB lock and persists rotated tokens", async () => {
    const expiredAuth = {
      id: "shared-auth-1",
      provider: "openai",
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: new Date("2026-04-13T09:00:00.000Z"),
    };

    sharedProviderAuthFindFirstMock.mockResolvedValue(expiredAuth);
    txSharedProviderAuthFindFirstMock.mockResolvedValue(expiredAuth);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const auth = await getResolvedProviderAuth({
      userId: "user-1",
      provider: "openai",
      authSource: "shared",
    });

    expect(txExecuteMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresAt: new Date("2026-04-13T11:00:00.000Z"),
        updatedAt: expect.any(Date),
      }),
    );
    expect(auth).toEqual({
      provider: "openai",
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresAt: new Date("2026-04-13T11:00:00.000Z").getTime(),
      authSource: "shared",
    });
  });

  it("surfaces provider refresh error messages from JSON responses", async () => {
    const expiredAuth = {
      id: "shared-auth-1",
      provider: "openai",
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: new Date("2026-04-13T09:00:00.000Z"),
    };

    sharedProviderAuthFindFirstMock.mockResolvedValue(expiredAuth);
    txSharedProviderAuthFindFirstMock.mockResolvedValue(expiredAuth);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              "Your refresh token has already been used to generate a new access token. Please try signing in again.",
          },
        }),
        { status: 401 },
      ),
    );

    await expect(
      getResolvedProviderAuth({
        userId: "user-1",
        provider: "openai",
        authSource: "shared",
      }),
    ).rejects.toThrow(
      "Token refresh failed: 401 Your refresh token has already been used to generate a new access token. Please try signing in again.",
    );
  });
});
