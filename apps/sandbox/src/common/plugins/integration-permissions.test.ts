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

  it("does not request auth when Gmail token exists in synced runtime env", async () => {
    const readFileSync = vi.fn().mockReturnValue(
      JSON.stringify({
        GMAIL_ACCESS_TOKEN: "gmail-token",
        APP_URL: "https://cmdclaw.ai",
      }),
    );
    vi.doMock("node:fs", () => ({ readFileSync }));

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash" },
        { args: { command: "google-gmail list -l 1" } },
      ),
    ).resolves.toBeUndefined();

    expect(process.env.GMAIL_ACCESS_TOKEN).toBe("gmail-token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a stable providerRequestId when requesting write approval", async () => {
    process.env.SLACK_ACCESS_TOKEN = "slack-token";
    process.env.APP_URL = "https://cmdclaw.ai";
    vi.doMock("../lib/runtime-context", () => ({
      readRuntimeContext: vi.fn().mockResolvedValue({
        runtimeId: "runtime-1",
        turnSeq: 2,
        callbackToken: "callback-token",
      }),
    }));
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 200 }),
    );

    const { IntegrationPermissionsPlugin } = await import("./integration-permissions");
    const plugin = await IntegrationPermissionsPlugin();

    await expect(
      plugin["tool.execute.before"](
        { tool: "bash", toolCallID: "call-123" },
        { args: { command: "slack send -c C123 -t hi --as user" } },
      ),
    ).resolves.toBeUndefined();

    const createBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(createBody).toEqual(
      expect.objectContaining({
        kind: "plugin_write",
        runtimeId: "runtime-1",
        turnSeq: 2,
        integration: "slack",
        operation: "send",
        providerRequestId: "plugin-write:runtime-1:2:opencode:call-123",
      }),
    );
  });
});
