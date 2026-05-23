import { describe, expect, it, vi } from "vitest";
import {
  buildSandboxRuntimeEnvFiles,
  resolveSandboxRuntimeAppUrl,
  syncRuntimeEnvToSandbox,
} from "./runtime-env-prep";

describe("runtime-env-prep", () => {
  it("builds curated runtime env files from non-empty values", () => {
    const result = buildSandboxRuntimeEnvFiles({
      GMAIL_ACCESS_TOKEN: "gmail-token",
      APP_URL: "https://cmdclaw.ai",
      EMPTY_VALUE: "",
      NULL_VALUE: null,
      UNDEFINED_VALUE: undefined,
    });

    expect(result.values).toEqual({
      APP_URL: "https://cmdclaw.ai",
      GMAIL_ACCESS_TOKEN: "gmail-token",
    });
    expect(result.json).toBe(
      JSON.stringify(
        {
          APP_URL: "https://cmdclaw.ai",
          GMAIL_ACCESS_TOKEN: "gmail-token",
        },
        null,
        2,
      ),
    );
    expect(result.shell).toBe(
      "export APP_URL='https://cmdclaw.ai'\nexport GMAIL_ACCESS_TOKEN='gmail-token'",
    );
  });

  it("syncs runtime env files atomically through sandbox exec", async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    await syncRuntimeEnvToSandbox({
      sandbox: { exec },
      runtimeEnv: {
        APP_URL: "https://cmdclaw.ai",
        GMAIL_ACCESS_TOKEN: "gmail-token",
      },
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const command = exec.mock.calls[0]?.[0];
    expect(command).toContain("/app/.cmdclaw/runtime-env.json");
    expect(command).toContain("/app/.cmdclaw/runtime-env.sh");
    expect(command).toContain(".next");
    expect(command).toContain("replace(path)");
    expect(command).toContain("chmod 600");
  });

  it("falls back to localcan in development when no callback url is configured", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    expect(resolveSandboxRuntimeAppUrl()).toBe("https://localcan.baptistecolle.com");

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
