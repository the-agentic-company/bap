import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProviderModelsMock,
  hasConnectedProviderAuthForUserMock,
  isProviderAuthRefreshErrorMock,
  listOpencodeFreeModelsMock,
  userFindFirstMock,
} = vi.hoisted(() => ({
  getProviderModelsMock: vi.fn(),
  hasConnectedProviderAuthForUserMock: vi.fn(),
  isProviderAuthRefreshErrorMock: vi.fn(),
  listOpencodeFreeModelsMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      user: {
        findFirst: userFindFirstMock,
      },
    },
  },
}));

vi.mock("../../../env", () => ({
  env: {},
}));

vi.mock("../../ai/opencode-models", () => ({
  listOpencodeFreeModels: listOpencodeFreeModelsMock,
}));

vi.mock("../../ai/subscription-providers", () => ({
  getProviderModels: getProviderModelsMock,
}));

vi.mock("../../control-plane/subscription-providers", () => ({
  hasConnectedProviderAuthForUser: hasConnectedProviderAuthForUserMock,
  isProviderAuthRefreshError: isProviderAuthRefreshErrorMock,
}));

import { checkModelAccessForUser } from "./model-access";

describe("checkModelAccessForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    userFindFirstMock.mockResolvedValue({ role: "member" });
    listOpencodeFreeModelsMock.mockResolvedValue([{ id: "opencode/glm-5-free", name: "GLM 5" }]);
    getProviderModelsMock.mockImplementation((provider: string) => {
      if (provider === "openai") {
        return [{ id: "gpt-5.4", name: "GPT-5.4" }];
      }
      if (provider === "google") {
        return [{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" }];
      }
      return [];
    });
    hasConnectedProviderAuthForUserMock.mockResolvedValue(true);
    isProviderAuthRefreshErrorMock.mockReturnValue(false);
  });

  it("rejects OpenAI subscription models without a shared ChatGPT connection", async () => {
    hasConnectedProviderAuthForUserMock.mockResolvedValueOnce(false);

    await expect(
      checkModelAccessForUser({
        userId: "user-1",
        model: "openai/gpt-5.4",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "openai_not_connected",
      userMessage:
        "This ChatGPT model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    });
    expect(hasConnectedProviderAuthForUserMock).toHaveBeenCalledWith(
      "user-1",
      "openai",
      "shared",
    );
  });

  it("surfaces shared ChatGPT token refresh failures as model access errors", async () => {
    const refreshError = new Error("Token refresh failed: 401 refresh token already used");
    hasConnectedProviderAuthForUserMock.mockRejectedValueOnce(refreshError);
    isProviderAuthRefreshErrorMock.mockReturnValueOnce(true);

    await expect(
      checkModelAccessForUser({
        userId: "user-1",
        model: "openai/gpt-5.4",
        authSource: "shared",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "openai_auth_refresh_failed",
      userMessage:
        "The shared ChatGPT connection could not be refreshed: Token refresh failed: 401 refresh token already used. Ask an admin to reconnect it, then retry.",
    });
  });

  it("rejects Gemini subscription models without a shared Gemini connection", async () => {
    hasConnectedProviderAuthForUserMock.mockResolvedValueOnce(false);

    await expect(
      checkModelAccessForUser({
        userId: "user-1",
        model: "google/gemini-3.1-pro-preview",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "google_not_connected",
      userMessage:
        "This Gemini model requires the shared workspace connection. Ask an admin to reconnect it, then retry.",
    });
    expect(hasConnectedProviderAuthForUserMock).toHaveBeenCalledWith(
      "user-1",
      "google",
      "shared",
    );
  });

  it("uses shared auth when explicitly requested for a dual-source provider", async () => {
    hasConnectedProviderAuthForUserMock.mockImplementation(
      async (_userId: string, _provider: string, authSource: string) => authSource === "shared",
    );

    await expect(
      checkModelAccessForUser({
        userId: "user-1",
        model: "openai/gpt-5.4",
        authSource: "shared",
      }),
    ).resolves.toEqual({ allowed: true });
    expect(hasConnectedProviderAuthForUserMock).toHaveBeenCalledTimes(1);
    expect(hasConnectedProviderAuthForUserMock).toHaveBeenCalledWith(
      "user-1",
      "openai",
      "shared",
    );
  });

  it("allows connected shared Gemini models", async () => {
    hasConnectedProviderAuthForUserMock.mockResolvedValueOnce(true);

    await expect(
      checkModelAccessForUser({
        userId: "user-1",
        model: "google/gemini-3.1-pro-preview",
      }),
    ).resolves.toEqual({ allowed: true });
  });
});
