import { afterEach, describe, expect, it } from "vitest";
import {
  formatAccountLabelError,
  resolveConnectedAccountAccessToken,
} from "./connected-account";

describe("connected account sandbox helper", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("falls back to the legacy token env when no runtime resolver is configured", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "legacy-token";
    delete process.env.CMDCLAW_RUNTIME_CREDENTIALS_URL;
    delete process.env.CMDCLAW_USER_ID;

    await expect(
      resolveConnectedAccountAccessToken({
        integrationType: "google_gmail",
        fallbackEnvVar: "GMAIL_ACCESS_TOKEN",
      }),
    ).resolves.toBe("legacy-token");
  });

  it("requires the runtime resolver when --account is provided", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "legacy-token";
    process.env.CMDCLAW_AVAILABLE_ACCOUNT_LABELS = "personal, work";
    delete process.env.CMDCLAW_RUNTIME_CREDENTIALS_URL;
    delete process.env.CMDCLAW_USER_ID;

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
});
