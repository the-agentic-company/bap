import { beforeEach, describe, expect, it, vi } from "vitest";

const { getValidTokensForUserMock, getValidCustomTokensMock, findIntegrationMock, findCustomCredsMock } =
  vi.hoisted(() => ({
  getValidTokensForUserMock: vi.fn(),
  getValidCustomTokensMock: vi.fn(),
  findIntegrationMock: vi.fn(),
  findCustomCredsMock: vi.fn(),
  }));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      integration: {
        findFirst: findIntegrationMock,
      },
      customIntegrationCredential: {
        findMany: findCustomCredsMock,
      },
    },
  },
}));

vi.mock("./token-refresh", () => ({
  getValidTokensForUser: getValidTokensForUserMock,
  getValidCustomTokens: getValidCustomTokensMock,
}));

vi.mock("./backfill-connected-identities", () => ({
  backfillConnectedIdentities: vi.fn(),
}));

import { getTokensForIntegrations } from "./cli-env";

describe("getTokensForIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getValidTokensForUserMock.mockResolvedValue(new Map());
    getValidCustomTokensMock.mockResolvedValue(new Map());
    findIntegrationMock.mockResolvedValue(null);
    findCustomCredsMock.mockResolvedValue([]);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2B_CALLBACK_BASE_URL", "");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("APP_SERVER_SECRET", "server-secret");
    vi.stubEnv("SLACK_BOT_RELAY_SECRET", "");
  });

  it("loads only requested token integrations", async () => {
    getValidTokensForUserMock.mockResolvedValue(
      new Map([
        ["airtable", "airtable-token"],
        ["outlook", "outlook-token"],
        ["github", "github-token"],
      ]),
    );

    const tokens = await getTokensForIntegrations("user-1", ["airtable", "outlook"]);

    expect(getValidTokensForUserMock).toHaveBeenCalledWith("user-1", ["airtable", "outlook"]);
    expect(tokens).toEqual({
      AIRTABLE_ACCESS_TOKEN: "airtable-token",
      OUTLOOK_ACCESS_TOKEN: "outlook-token",
    });
  });

  it("prefers the callback base for Slack relay urls", async () => {
    vi.resetModules();
    vi.stubEnv(
      "E2B_CALLBACK_BASE_URL",
      "https://localcan.baptistecolle.com/__worktrees/cmdclaw-a07527aa",
    );
    const { getCliEnvForUser } = await import("./cli-env");

    const env = await getCliEnvForUser("user-1");

    expect(env.SLACK_BOT_RELAY_URL).toBe(
      "https://localcan.baptistecolle.com/__worktrees/cmdclaw-a07527aa/api/internal/slack/post-as-bot",
    );
  });
});
