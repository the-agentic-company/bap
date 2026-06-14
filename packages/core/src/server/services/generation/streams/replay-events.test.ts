import { describe, expect, it, vi } from "vitest";

const { parseBashCommandMock } = vi.hoisted(() => ({
  parseBashCommandMock: vi.fn(),
}));

vi.mock("../../../ai/permission-checker", () => ({
  parseBashCommand: parseBashCommandMock,
}));

import { buildGenerationReplayPartEvent } from "./replay-events";

describe("buildGenerationReplayPartEvent", () => {
  it("replays content parts as stream events with tool metadata", () => {
    parseBashCommandMock.mockReturnValueOnce({
      integration: "github",
      operation: "write",
      isWrite: true,
    });

    const parts = [
      { type: "text", text: "hi" },
      { type: "tool_use", id: "tool-1", name: "bash", input: { command: "gh pr list" } },
      { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
      { type: "thinking", id: "think-1", content: "checking" },
      {
        type: "approval",
        tool_use_id: "tool-1",
        tool_name: "bash",
        tool_input: { command: "gh pr list" },
        integration: "github",
        operation: "write",
        command: "gh pr list",
        status: "approved",
      },
    ] as any[];

    expect(
      parts.map((part) =>
        buildGenerationReplayPartEvent({
          generationId: "gen-1",
          runtimeId: "runtime-1",
          conversationId: "conv-1",
          turnSeq: 1,
          part,
          parts,
        }),
      ),
    ).toEqual([
      { type: "text", content: "hi" },
      {
        type: "tool_use",
        toolName: "bash",
        toolInput: { command: "gh pr list" },
        toolUseId: "tool-1",
        integration: "github",
        operation: "write",
        isWrite: true,
      },
      {
        type: "tool_result",
        toolName: "bash",
        result: "ok",
        toolUseId: "tool-1",
      },
      { type: "thinking", content: "checking", thinkingId: "think-1" },
      {
        type: "interrupt_resolved",
        interruptId: "approval-part:gen-1:tool-1",
        generationId: "gen-1",
        runtimeId: "runtime-1",
        conversationId: "conv-1",
        turnSeq: 1,
        kind: "plugin_write",
        status: "accepted",
        providerToolUseId: "tool-1",
        display: {
          title: "bash",
          integration: "github",
          operation: "write",
          command: "gh pr list",
          toolInput: { command: "gh pr list" },
        },
        responsePayload: undefined,
      },
    ]);
  });
});
