import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateSandboxForCloudProvider } from "./opencode-session";

const { conversationRuntimeFindFirstMock, dbUpdateMock, daytonaGetMock } = vi.hoisted(() => ({
  conversationRuntimeFindFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  daytonaGetMock: vi.fn(),
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
      get: daytonaGetMock,
    };
  }),
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    fetchMock.mockResolvedValueOnce({ ok: false });
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
