import { afterEach, describe, expect, it, vi } from "vitest";

type SandboxProvider = "e2b" | "daytona" | "docker";

const originalSandboxEnv = {
  SANDBOX_DEFAULT: process.env.SANDBOX_DEFAULT,
};

async function loadPolicyResolverModule() {
  vi.resetModules();
  return import("./policy-resolver");
}

function setSandboxEnv(params: { sandboxDefault: SandboxProvider }) {
  process.env.SANDBOX_DEFAULT = params.sandboxDefault;
}

describe("resolveRuntimeSelection", () => {
  afterEach(() => {
    if (originalSandboxEnv.SANDBOX_DEFAULT === undefined) {
      delete process.env.SANDBOX_DEFAULT;
    } else {
      process.env.SANDBOX_DEFAULT = originalSandboxEnv.SANDBOX_DEFAULT;
    }
  });

  it(
    "maps openai models to the opencode runtime",
    async () => {
      setSandboxEnv({
        sandboxDefault: "e2b",
      });

      const { resolveRuntimeSelection } = await loadPolicyResolverModule();
      expect(resolveRuntimeSelection({ model: "openai/gpt-5.4" })).toEqual({
        sandboxProvider: "e2b",
        runtimeHarness: "opencode",
        runtimeProtocolVersion: "opencode-v2",
      });
    },
    15_000,
  );

  it("maps anthropic models to the sandbox-agent runtime", async () => {
    setSandboxEnv({
      sandboxDefault: "daytona",
    });

    const { resolveRuntimeSelection } = await loadPolicyResolverModule();
    expect(resolveRuntimeSelection({ model: "anthropic/claude-sonnet-4-6" })).toEqual({
      sandboxProvider: "daytona",
      runtimeHarness: "agent-sdk",
      runtimeProtocolVersion: "sandbox-agent-v1",
    });
  });

  it("keeps opencode models on the opencode runtime", async () => {
    setSandboxEnv({
      sandboxDefault: "docker",
    });

    const { resolveRuntimeSelection } = await loadPolicyResolverModule();
    expect(resolveRuntimeSelection({ model: "opencode/glm-5-free" })).toEqual({
      sandboxProvider: "docker",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
    });
  });
});
