import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("MemoryPlugin", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, items: [] }),
      text: async () => "",
    }) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("loads APP_URL and CONVERSATION_ID from synced runtime env at execution time", async () => {
    const readFileSync = vi.fn().mockReturnValue(
      JSON.stringify({
        APP_URL: "https://cmdclaw.ai",
        CONVERSATION_ID: "conv-123",
        CMDCLAW_SERVER_SECRET: "secret-123",
      }),
    );
    vi.doMock("node:fs", () => ({ readFileSync }));

    const { MemoryPlugin } = await import("./memory");
    const plugin = await MemoryPlugin();
    const memorySearch = plugin.tools.find((tool: { name: string }) => tool.name === "memory_search");

    expect(memorySearch).toBeTruthy();
    await expect(memorySearch!.execute({ query: "gmail" })).resolves.toMatchObject({
      success: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://cmdclaw.ai/api/internal/memory",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          conversationId: "conv-123",
          operation: "search",
          payload: { query: "gmail" },
          authHeader: "Bearer secret-123",
        }),
      }),
    );
  });
});
