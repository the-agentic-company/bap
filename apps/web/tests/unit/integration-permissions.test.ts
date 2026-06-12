import { getCallbackBaseUrls } from "@cmdclaw/sandbox/plugins/integration-permissions";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getCallbackBaseUrls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers public URLs and excludes localcan in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv(
      "E2B_CALLBACK_BASE_URL",
      "https://localcan.baptistecolle.com/__worktrees/cmdclaw-5fd291f4",
    );
    vi.stubEnv("VITE_APP_URL", "https://cmdclaw.ai");

    expect(getCallbackBaseUrls()).toEqual([
      "https://localcan.baptistecolle.com/__worktrees/cmdclaw-5fd291f4",
      "https://cmdclaw.ai",
    ]);
  });

  it("uses localcan fallback only in non-production localhost setups", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("VITE_APP_URL", "");
    vi.stubEnv("E2B_CALLBACK_BASE_URL", "");

    expect(getCallbackBaseUrls()).toEqual([
      "http://localhost:3000",
      "https://localcan.baptistecolle.com",
    ]);
  });
});
