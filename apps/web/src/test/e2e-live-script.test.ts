import { describe, expect, test } from "vitest";
import { buildRecordModeEnv } from "../../scripts/e2e-live";

describe("buildRecordModeEnv", () => {
  test("uses the running worktree server by default", () => {
    const env = buildRecordModeEnv(
      {
        NODE_ENV: "test",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3419",
      },
      { hasWorktreeEnv: true },
    );

    expect(env.E2E_LIVE).toBe("1");
    expect(env.PLAYWRIGHT_REUSE_SERVER).toBe("1");
    expect(env.PLAYWRIGHT_VIDEO).toBe("on");
    expect(env.PLAYWRIGHT_SKIP_WEBSERVER).toBe("1");
    expect(env.APP_SERVER_URL).toBe("http://127.0.0.1:3419");
  });

  test("preserves explicit server settings", () => {
    const env = buildRecordModeEnv(
      {
        NODE_ENV: "test",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3419",
        PLAYWRIGHT_SKIP_WEBSERVER: "0",
        APP_SERVER_URL: "http://127.0.0.1:9999",
      },
      { hasWorktreeEnv: true },
    );

    expect(env.PLAYWRIGHT_SKIP_WEBSERVER).toBe("0");
    expect(env.APP_SERVER_URL).toBe("http://127.0.0.1:9999");
  });

  test("keeps non-worktree runs unchanged", () => {
    const env = buildRecordModeEnv({ NODE_ENV: "test" }, { hasWorktreeEnv: false });

    expect(env.PLAYWRIGHT_SKIP_WEBSERVER).toBeUndefined();
    expect(env.APP_SERVER_URL).toBeUndefined();
  });
});
