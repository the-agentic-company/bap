import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getResolvedProviderAuthMock } = vi.hoisted(() => ({
  getResolvedProviderAuthMock: vi.fn(),
}));

vi.mock("../control-plane/subscription-providers", () => ({
  getResolvedProviderAuth: getResolvedProviderAuthMock,
}));

const { injectProviderAuth } = await import("./provider-auth-injection");

describe("provider auth injection", () => {
  beforeEach(() => {
    getResolvedProviderAuthMock.mockReset();
    vi.restoreAllMocks();
  });

  it("retries SDK auth.set result errors before reporting success", async () => {
    getResolvedProviderAuthMock.mockImplementation(
      async ({ provider }: { provider: string }) =>
        provider === "openai"
          ? {
              provider: "openai",
              accessToken: "openai-access",
              refreshToken: "openai-refresh",
              expiresAt: Date.now() + 60_000,
              authSource: "shared",
            }
          : null,
    );
    const authSet = vi
      .fn()
      .mockResolvedValueOnce({ error: { _tag: "BadRequest" } })
      .mockResolvedValueOnce({ data: true });
    const client = { auth: { set: authSet } } as unknown as OpencodeClient;

    await injectProviderAuth(client, "user-1", { openAIAuthSource: "shared" });

    expect(authSet).toHaveBeenCalledTimes(2);
    expect(authSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerID: "openai",
      }),
    );
  });

  it("serializes provider auth writes to avoid losing OpenCode auth config updates", async () => {
    getResolvedProviderAuthMock.mockImplementation(
      async ({ provider }: { provider: string }) => {
        if (provider === "openai") {
          return {
            provider: "openai",
            accessToken: "openai-access",
            refreshToken: "openai-refresh",
            expiresAt: Date.now() + 60_000,
            authSource: "shared",
          };
        }
        if (provider === "google") {
          return {
            provider: "google",
            accessToken: "google-key",
            refreshToken: null,
            expiresAt: null,
            authSource: "shared",
          };
        }
        return null;
      },
    );

    const events: string[] = [];
    const authSet = vi.fn().mockImplementation(async ({ providerID }: { providerID: string }) => {
      events.push(`start:${providerID}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push(`end:${providerID}`);
      return { data: true };
    });
    const client = { auth: { set: authSet } } as unknown as OpencodeClient;

    await injectProviderAuth(client, "user-1", { openAIAuthSource: "shared" });

    expect(events).toEqual(["start:openai", "end:openai", "start:google", "end:google"]);
  });
});
