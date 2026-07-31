import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAccountLabelError, resolveConnectedAccountAccessToken } from "./connected-account";

describe("connected account sandbox helper", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("falls back to the legacy token env when no runtime resolver is configured", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "legacy-token";
    delete process.env.BAP_RUNTIME_CREDENTIALS_URL;
    delete process.env.BAP_USER_ID;

    await expect(
      resolveConnectedAccountAccessToken({
        integrationType: "google_gmail",
        fallbackEnvVar: "GMAIL_ACCESS_TOKEN",
      }),
    ).resolves.toBe("legacy-token");
  });

  it("requires the runtime resolver when --account is provided", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "legacy-token";
    process.env.BAP_AVAILABLE_ACCOUNT_LABELS = "personal, work";
    delete process.env.BAP_RUNTIME_CREDENTIALS_URL;
    delete process.env.BAP_USER_ID;

    await expect(
      resolveConnectedAccountAccessToken({
        integrationType: "google_gmail",
        fallbackEnvVar: "GMAIL_ACCESS_TOKEN",
        accountLabel: "work",
      }),
    ).rejects.toThrow("Available account labels: personal, work");
  });

  it("appends available Account Labels to resolver errors", () => {
    expect(formatAccountLabelError("Choose an Account Label.", ["personal", "work"])).toBe(
      "Choose an Account Label. Available account labels: personal, work.",
    );
  });

  it("forwards remote integration source to the runtime resolver", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          credential: {
            accessToken: "remote-outlook-token",
            accountLabel: null,
            connectedAccountId: "remote-user-1",
            connectedIdentityId: null,
            integrationType: "outlook",
            availableAccountLabels: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    process.env.BAP_RUNTIME_CREDENTIALS_URL =
      "https://app.example.com/api/internal/mcp/runtime-credentials";
    process.env.BAP_USER_ID = "local-user-1";
    process.env.CONVERSATION_ID = "conversation-1";
    process.env.BAP_SERVER_SECRET = "test-secret";
    process.env.BAP_REMOTE_INTEGRATION_SOURCE = JSON.stringify({
      targetEnv: "prod",
      remoteUserId: "remote-user-1",
      requestedByUserId: "admin-1",
      requestedByEmail: "admin@example.com",
    });

    await expect(
      resolveConnectedAccountAccessToken({
        integrationType: "outlook",
        fallbackEnvVar: "OUTLOOK_ACCESS_TOKEN",
      }),
    ).resolves.toBe("remote-outlook-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/api/internal/mcp/runtime-credentials",
      expect.objectContaining({
        body: JSON.stringify({
          userId: "local-user-1",
          conversationId: "conversation-1",
          remoteIntegrationSource: {
            targetEnv: "prod",
            remoteUserId: "remote-user-1",
            requestedByUserId: "admin-1",
            requestedByEmail: "admin@example.com",
          },
          resolve: {
            integrationType: "outlook",
            accountLabel: null,
            allowedIntegrationTypes: ["outlook"],
          },
        }),
      }),
    );
  });
});
