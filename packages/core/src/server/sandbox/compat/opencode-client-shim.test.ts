import { describe, expect, it, vi } from "vitest";
import { createRuntimeHarnessClientFromOpencodeClient } from "./opencode-client-shim";

describe("createRuntimeHarnessClientFromOpencodeClient", () => {
  it("forwards agent to client.session.prompt", async () => {
    const promptMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = {
      event: {
        subscribe: vi.fn(),
      },
      session: {
        prompt: promptMock,
        abort: vi.fn(),
        messages: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
      },
      part: {
        update: vi.fn().mockResolvedValue({ data: { id: "part-1" }, error: null }),
      },
      permission: {
        reply: vi.fn(),
      },
      question: {
        reply: vi.fn(),
        reject: vi.fn(),
      },
    } as Parameters<typeof createRuntimeHarnessClientFromOpencodeClient>[0];

    const harness = createRuntimeHarnessClientFromOpencodeClient(client);
    await harness.prompt({
      sessionID: "session-1",
      agent: "bap-chat",
      parts: [{ type: "text", text: "hello" }],
      system: "runtime system prompt",
    });

    expect(promptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      agent: "bap-chat",
      parts: [{ type: "text", text: "hello" }],
      system: "runtime system prompt",
    });
  });

  it("forwards structured model references through session.prompt without flattening provider and model", async () => {
    const promptMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const promptAsyncMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      event: {
        subscribe: vi.fn(),
      },
      session: {
        promptAsync: promptAsyncMock,
        prompt: promptMock,
        abort: vi.fn(),
        messages: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
      },
      part: {
        update: vi.fn(),
      },
      permission: {
        reply: vi.fn(),
      },
      question: {
        reply: vi.fn(),
        reject: vi.fn(),
      },
    } as Parameters<typeof createRuntimeHarnessClientFromOpencodeClient>[0];

    const harness = createRuntimeHarnessClientFromOpencodeClient(client);
    await harness.prompt({
      sessionID: "session-1",
      parts: [{ type: "text", text: "hello" }],
      model: {
        providerID: "openai",
        modelID: "gpt-5.4-mini",
      },
    });

    expect(promptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      parts: [{ type: "text", text: "hello" }],
      model: {
        providerID: "openai",
        modelID: "gpt-5.4-mini",
      },
    });
    expect(promptAsyncMock).not.toHaveBeenCalled();
  });

  it("forwards updatePart to client.part.update", async () => {
    const updateMock = vi.fn().mockResolvedValue({ data: { id: "part-1" }, error: null });
    const client = {
      event: { subscribe: vi.fn() },
      session: {
        prompt: vi.fn(),
        abort: vi.fn(),
        messages: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
      },
      part: { update: updateMock },
      permission: { reply: vi.fn() },
      question: { reply: vi.fn(), reject: vi.fn() },
    } as Parameters<typeof createRuntimeHarnessClientFromOpencodeClient>[0];

    const harness = createRuntimeHarnessClientFromOpencodeClient(client);
    await harness.updatePart({
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      part: { type: "tool", id: "part-1" },
    });

    expect(updateMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      part: { type: "tool", id: "part-1" },
    });
  });

  it("forwards status to client.session.status", async () => {
    const statusMock = vi.fn().mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });
    const client = {
      event: { subscribe: vi.fn() },
      session: {
        prompt: vi.fn(),
        abort: vi.fn(),
        messages: vi.fn(),
        status: statusMock,
        get: vi.fn(),
        create: vi.fn(),
      },
      part: { update: vi.fn() },
      permission: { reply: vi.fn() },
      question: { reply: vi.fn(), reject: vi.fn() },
    } as Parameters<typeof createRuntimeHarnessClientFromOpencodeClient>[0];

    const harness = createRuntimeHarnessClientFromOpencodeClient(client);
    const result = await harness.status?.();

    expect(statusMock).toHaveBeenCalledWith({});
    expect(result).toEqual({
      data: { "session-1": { type: "busy" } },
      error: null,
    });
  });
});
