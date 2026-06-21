import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateSandboxForCloudProvider } from "./opencode-session";

const {
  conversationRuntimeFindFirstMock,
  dbUpdateMock,
  daytonaCreateMock,
  daytonaGetMock,
  injectProviderAuthMock,
} = vi.hoisted(() => ({
  conversationRuntimeFindFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  daytonaCreateMock: vi.fn(),
  daytonaGetMock: vi.fn(),
  injectProviderAuthMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      conversationRuntime: {
        findFirst: conversationRuntimeFindFirstMock,
      },
    },
    update: dbUpdateMock,
  },
}));

vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn(function Daytona() {
    return {
      create: daytonaCreateMock,
      get: daytonaGetMock,
    };
  }),
}));

vi.mock("./provider-auth-injection", () => ({
  injectProviderAuth: injectProviderAuthMock,
}));

vi.mock("./runtime/factory", () => ({
  createSandboxRuntimeClientByRuntime: vi.fn().mockResolvedValue({}),
  createSandboxSessionBridgeByRuntime: vi.fn().mockResolvedValue({}),
}));

describe("getOrCreateSandboxForCloudProvider", () => {
  beforeEach(() => {
    conversationRuntimeFindFirstMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    daytonaGetMock.mockReset();
    daytonaCreateMock.mockReset();
    injectProviderAuthMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restarts a reused Daytona runtime when readiness fails before waiting again", async () => {
    const executeCommandMock = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const sandbox = {
      id: "sandbox-1",
      state: "started",
      getPreviewLink: vi.fn().mockResolvedValue({
        url: "https://4096-sandbox-1.daytona.example",
        token: "preview-token",
      }),
      process: {
        executeCommand: executeCommandMock,
      },
      fs: {
        uploadFile: vi.fn(),
        downloadFile: vi.fn(),
      },
    };

    conversationRuntimeFindFirstMock.mockResolvedValue({
      id: "runtime-1",
      sandboxId: "sandbox-1",
      sessionId: null,
    });
    daytonaGetMock.mockResolvedValue(sandbox);
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          providers: [{ id: "openai", models: { "gpt-5.4": {} } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const lifecycle = vi.fn();
    const init = await getOrCreateSandboxForCloudProvider(
      "daytona",
      {
        conversationId: "conversation-1",
        model: "openai/gpt-5.4",
        anthropicApiKey: "anthropic-key",
      },
      {
        onLifecycle: lifecycle,
      },
    );

    await init.connectAgent({ onLifecycle: lifecycle });

    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    expect(executeCommandMock.mock.calls[0]?.[0]).toContain("opencode serve --port 4096");
    expect(executeCommandMock.mock.calls[0]?.[0]).toContain("opencode models openai --refresh");
    expect(executeCommandMock.mock.calls[0]?.[0]).toContain("SANDBOX_ID=sandbox-1");
    expect(executeCommandMock.mock.calls[0]?.[0]).toContain(
      "OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true",
    );
    expect(lifecycle).toHaveBeenCalledWith(
      "opencode_starting",
      expect.objectContaining({
        conversationId: "conversation-1",
        sandboxId: "sandbox-1",
        port: 4096,
      }),
    );
    expect(lifecycle).toHaveBeenCalledWith(
      "opencode_waiting_ready",
      expect.objectContaining({
        conversationId: "conversation-1",
        sandboxId: "sandbox-1",
        serverUrl: "https://4096-sandbox-1.daytona.example",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("injects provider auth before checking the model catalog for a fresh Daytona runtime", async () => {
    const events: string[] = [];
    const sandbox = {
      id: "sandbox-fresh",
      state: "started",
      getPreviewLink: vi.fn().mockResolvedValue({
        url: "https://4096-sandbox-fresh.daytona.example",
        token: "preview-token",
      }),
      process: {
        executeCommand: vi.fn(),
      },
      fs: {
        uploadFile: vi.fn(),
        downloadFile: vi.fn(),
      },
    };

    conversationRuntimeFindFirstMock.mockResolvedValue(null);
    daytonaCreateMock.mockResolvedValue(sandbox);
    injectProviderAuthMock.mockImplementation(async () => {
      events.push("auth");
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      events.push(url.includes("/config/providers") ? "providers" : "health");
      return url.includes("/config/providers")
        ? {
            ok: true,
            json: async () => ({
              providers: [{ id: "openai", models: { "gpt-5.4": {} } }],
            }),
          }
        : { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);

    const lifecycle = vi.fn();
    const init = await getOrCreateSandboxForCloudProvider(
      "daytona",
      {
        conversationId: "conversation-1",
        model: "openai/gpt-5.4",
        anthropicApiKey: "anthropic-key",
        userId: "user-1",
        openAIAuthSource: "shared",
      },
      {
        onLifecycle: lifecycle,
      },
    );

    await init.connectAgent({ onLifecycle: lifecycle });

    expect(events).toEqual(["health", "auth", "providers"]);
    expect(injectProviderAuthMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
      openAIAuthSource: "shared",
      logPrefix: "[Daytona]",
    });
    expect(lifecycle).toHaveBeenCalledWith(
      "opencode_ready",
      expect.objectContaining({
        conversationId: "conversation-1",
        sandboxId: "sandbox-fresh",
        serverUrl: "https://4096-sandbox-fresh.daytona.example",
      }),
    );
  });
});
