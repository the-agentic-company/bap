import { describe, expect, it, vi } from "vitest";
import { resolveOpenCodePromptCompletion } from "./opencode-runtime-driver";

describe("resolveOpenCodePromptCompletion", () => {
  it("surfaces structured transcript fetch errors for empty completions", async () => {
    const runtimeClient = {
      messages: vi.fn().mockResolvedValue({
        data: null,
        error: {
          status: 404,
          data: { message: "session.messages returned 404" },
        },
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { id: "session-1", state: "running" },
        error: null,
      }),
    };
    const sandbox = {
      readFile: vi.fn().mockResolvedValue("booting runtime\nfatal: runner exited unexpectedly\n"),
    };

    await expect(
      resolveOpenCodePromptCompletion({
        promptResultEnvelope: { ok: true, data: { id: "prompt-result-1" } },
        runtimeClient: runtimeClient as never,
        sessionId: "session-1",
        sandbox,
        needsAssistantText: true,
        observedTerminalIdle: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        assistantText: null,
        fallbackMessagesError: "session.messages returned 404",
        fallbackMessagesErrorDetail: expect.stringContaining(
          '"message":"session.messages returned 404"',
        ),
        promptResultDataShape: "object(id)",
        bestTranscriptError: "session.messages returned 404",
        emptyCompletionDiagnostics: expect.objectContaining({
          sessionGetDataShape: "object(id,state)",
          sessionGetDataDetail: expect.stringContaining('"state":"running"'),
          opencodeLogTail: expect.stringContaining("fatal: runner exited unexpectedly"),
        }),
      }),
    );
  });

  it("collects opaque diagnostics when OpenCode resolves without output or transcript", async () => {
    const runtimeClient = {
      messages: vi.fn().mockResolvedValue({ data: [], error: null }),
      getSession: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const sandbox = {
      readFile: vi.fn().mockResolvedValue(""),
    };

    const result = await resolveOpenCodePromptCompletion({
      promptResultEnvelope: { ok: true, data: undefined },
      runtimeClient: runtimeClient as never,
      sessionId: "session-1",
      sandbox,
      needsAssistantText: true,
      observedTerminalIdle: false,
    });

    expect(runtimeClient.messages).toHaveBeenCalledWith({
      sessionID: "session-1",
      limit: 20,
    });
    expect(result).toEqual(
      expect.objectContaining({
        assistantText: null,
        assistantTextSource: null,
        fallbackMessagesPayloadShape: "array(0)",
        promptResultDataShape: null,
        bestTranscriptError: null,
        emptyCompletionDiagnostics: expect.objectContaining({
          sessionGetDataShape: null,
          opencodeLogTail: null,
        }),
      }),
    );
  });
});
