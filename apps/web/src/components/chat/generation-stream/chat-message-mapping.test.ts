import { describe, expect, it } from "vitest";
import {
  mapPersistedMessageToChatMessage,
  withActivityDurations,
  withEndToEndDuration,
  type PersistedConversationMessage,
} from "./chat-message-mapping";

describe("mapPersistedMessageToChatMessage", () => {
  it("maps persisted content parts, files, and timing into chat message shape", () => {
    const persisted: PersistedConversationMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "done",
      contentParts: [
        { type: "text", text: "hello" },
        { type: "thinking", id: "think-1", content: "planning" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
          integration: "github",
          operation: "run",
        },
        { type: "tool_result", tool_use_id: "tool-1", content: { ok: true } },
        {
          type: "approval",
          tool_use_id: "tool-2",
          tool_name: "question",
          tool_input: { question: "Proceed?" },
          integration: "bap",
          operation: "question",
          status: "approved",
          question_answers: [["yes"]],
        },
        {
          type: "coworker_invocation",
          coworker_id: "coworker-1",
          username: "daily-digest",
          name: "Daily Digest",
          run_id: "run-1",
          conversation_id: "conversation-1",
          generation_id: "generation-1",
          status: "completed",
          attachment_names: ["report.md"],
          message: "done",
        },
      ],
      attachments: [
        {
          id: "attachment-1",
          filename: "input.txt",
          mimeType: "text/plain",
          sizeBytes: 12,
        },
      ],
      sandboxFiles: [
        {
          fileId: "file-1",
          path: "/tmp/result.txt",
          filename: "result.txt",
          mimeType: "text/plain",
          sizeBytes: 42,
        },
      ],
      timing: { endToEndDurationMs: 1000 },
    };

    const message = mapPersistedMessageToChatMessage(persisted);

    expect(message).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "done",
      attachments: [{ id: "attachment-1", name: "input.txt", mimeType: "text/plain" }],
      sandboxFiles: [{ fileId: "file-1", path: "/tmp/result.txt", filename: "result.txt" }],
      timing: { endToEndDurationMs: 1000 },
    });
    expect(message.parts).toEqual([
      { type: "text", content: "hello" },
      { type: "thinking", id: "think-1", content: "planning" },
      {
        type: "tool_call",
        id: "tool-1",
        name: "bash",
        input: { command: "echo hi" },
        result: { ok: true },
        integration: "github",
        operation: "run",
      },
      {
        type: "approval",
        toolUseId: "tool-2",
        toolName: "question",
        toolInput: { question: "Proceed?" },
        integration: "bap",
        operation: "question",
        status: "approved",
        questionAnswers: [["yes"]],
      },
      {
        type: "coworker_invocation",
        coworkerId: "coworker-1",
        username: "daily-digest",
        name: "Daily Digest",
        runId: "run-1",
        conversationId: "conversation-1",
        generationId: "generation-1",
        status: "completed",
        attachmentNames: ["report.md"],
        message: "done",
      },
    ]);
  });
});

describe("timing helpers", () => {
  it("adds end-to-end and activity duration metadata without dropping existing timing", () => {
    const withEndToEnd = withEndToEndDuration({ generationDurationMs: 20 }, 1000, 1750);

    expect(withEndToEnd).toEqual({
      generationDurationMs: 20,
      endToEndDurationMs: 750,
    });

    expect(
      withActivityDurations(withEndToEnd, {
        totalToolCalls: 2,
        completedToolCalls: 1,
        totalToolDurationMs: 300,
        maxToolDurationMs: 250,
        perToolUseIdMs: { "tool-1": 250, "tool-2": 50 },
      }),
    ).toEqual({
      generationDurationMs: 20,
      endToEndDurationMs: 750,
      activityDurationsMs: {
        totalToolCalls: 2,
        completedToolCalls: 1,
        totalToolDurationMs: 300,
        maxToolDurationMs: 250,
        perToolUseIdMs: { "tool-1": 250, "tool-2": 50 },
      },
    });
  });
});
