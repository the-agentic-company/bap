import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("IntegrationPermissionsPlugin", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function mockRuntimeContext() {
    vi.doMock("../lib/runtime-context", () => ({
      readRuntimeContext: vi.fn().mockResolvedValue({
        runtimeId: "runtime-1",
        turnSeq: 2,
        callbackToken: "callback-token",
      }),
    }));
  }

  function mockPolicyAndApproval(decision: "auto_approved" | "requires_approval") {
    vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { kind?: string };
      return body.kind === "policy_check"
        ? Response.json({ decision, source: "parent_policy" })
        : Response.json({ status: "accepted" });
    });
  }

  it("runs a policy Auto-approved write without creating an approval interrupt", async () => {
    process.env.SLACK_ACCESS_TOKEN = "slack-token";
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();
    mockPolicyAndApproval("auto_approved");

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-auto" },
        { args: { command: "slack send -c C123 -t hi --as user" } },
      ),
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(body.kind).toBe("policy_check");
  });

  it("returns a stable denial before auth or approval", async () => {
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();
    vi.mocked(global.fetch).mockResolvedValue(
      Response.json({ decision: "denied", source: "parent_policy" }),
    );

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-denied" },
        { args: { command: "salesforce create Lead '{}'" } },
      ),
    ).rejects.toThrow("WORKSPACE_POLICY_DENIED: salesforce.create");
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("rejects multiple managed operations before policy, auth, or side effects", async () => {
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-compound" },
        { args: { command: "google-gmail send --to a@example.com; google-gmail list" } },
      ),
    ).rejects.toThrow("WORKSPACE_POLICY_COMPOUND_COMMAND_DENIED");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("detects a raw skill entrypoint invocation before credentials or side effects", async () => {
    process.env.SLACK_ACCESS_TOKEN = "slack-token";
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();
    vi.mocked(global.fetch).mockResolvedValue(
      Response.json({ decision: "denied", source: "parent_policy" }),
    );

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-policy-change" },
        {
          args: {
            command: "tsx /app/.claude/skills/slack/src/slack.ts send -c C123 -t hi --as user",
          },
        },
      ),
    ).rejects.toThrow("WORKSPACE_POLICY_DENIED: slack.send");
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("does not request auth when Gmail token exists in synced runtime env", async () => {
    const readFileSync = vi.fn().mockReturnValue(
      JSON.stringify({
        GMAIL_ACCESS_TOKEN: "gmail-token",
        APP_URL: "https://heybap.com",
      }),
    );
    vi.doMock("node:fs", () => ({ readFileSync }));
    mockRuntimeContext();
    mockPolicyAndApproval("auto_approved");

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash" },
        { args: { command: "google-gmail list -l 1" } },
      ),
    ).resolves.toBeUndefined();

    expect(process.env.GMAIL_ACCESS_TOKEN).toBe("gmail-token");
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("delegates managed Requires approval to the credentialed CLI entrypoint", async () => {
    process.env.SLACK_ACCESS_TOKEN = "slack-token";
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();
    mockPolicyAndApproval("requires_approval");

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-123" },
        { args: { command: "slack send -c C123 -t hi --as user" } },
      ),
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(body.kind).toBe("policy_check");
  });

  it("requests write approval when a Slack account option precedes send", async () => {
    process.env.SLACK_ACCESS_TOKEN = "slack-token";
    process.env.APP_URL = "https://heybap.com";
    mockRuntimeContext();
    mockPolicyAndApproval("requires_approval");

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-456" },
        {
          args: {
            command: 'slack --account baptiste-2 send -c C123 -t "hi" --as bot',
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledOnce();
  });
});
