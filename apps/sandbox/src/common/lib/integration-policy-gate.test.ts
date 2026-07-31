import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("integration policy CLI gate", () => {
  const originalArgv = process.argv;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    process.env.APP_URL = "https://heybap.com";
    vi.doMock("./runtime-env", () => ({ loadRuntimeEnv: vi.fn() }));
    vi.doMock("./runtime-context", () => ({
      readRuntimeContext: vi.fn().mockResolvedValue({
        runtimeId: "runtime-1",
        turnSeq: 1,
        callbackToken: "callback-token",
      }),
    }));
  });

  afterEach(() => {
    process.argv = originalArgv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("blocks a denied operation inside the CLI entrypoint even with an absolute path", async () => {
    process.argv = ["bun", "gate", "/usr/local/bin/salesforce", "create", "Lead", "{}"];
    global.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ decision: "denied", source: "parent_policy" }));

    const { enforceWorkspaceIntegrationPolicyForCli } = await import("./integration-policy-gate");

    await expect(enforceWorkspaceIntegrationPolicyForCli()).rejects.toThrow(
      "WORKSPACE_POLICY_DENIED: salesforce.create",
    );
  });

  it("uses a durable, invocation-bound approval and rechecks policy before execution", async () => {
    process.argv = ["bun", "gate", "google-gmail", "send"];
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ decision: "requires_approval", source: "parent_policy" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "accepted",
          interruptId: "interrupt-1",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "accepted",
          interruptId: "interrupt-1",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ decision: "requires_approval", source: "parent_policy" }),
      );

    const { enforceWorkspaceIntegrationPolicyForCli } = await import("./integration-policy-gate");

    await expect(enforceWorkspaceIntegrationPolicyForCli()).resolves.toBeUndefined();
    const approvalBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[1]?.[1]?.body));
    expect(approvalBody).toEqual(
      expect.objectContaining({
        kind: "plugin_write",
        integration: "google_gmail",
        operation: "send",
        providerRequestId: expect.stringMatching(/^cli-policy:runtime-1:1:/),
      }),
    );
  });
});
