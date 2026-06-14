import { describe, expect, it, vi } from "vitest";
import { normalizeOpenCodeActionableEvent, sendOpenCodeRuntimeDecision } from "./opencode-runtime-actions";

function createApprovalClient() {
  return {
    replyPermission: vi.fn(async () => ({ data: true, error: undefined })),
    replyQuestion: vi.fn(async () => ({ data: true, error: undefined })),
    rejectQuestion: vi.fn(async () => ({ data: true, error: undefined })),
  };
}

describe("OpenCode runtime action normalization", () => {
  it("auto-approves permission requests when conversation auto-approve is enabled", async () => {
    const client = createApprovalClient();

    await expect(
      normalizeOpenCodeActionableEvent({
        autoApprove: true,
        client,
        event: {
          type: "permission.asked",
          properties: {
            id: "permission-request-auto",
            permission: "external_directory",
            patterns: ["/tmp/non-allowlisted-path"],
          },
        },
      }),
    ).resolves.toEqual({ type: "none" });

    expect(client.replyPermission).toHaveBeenCalledWith({
      requestID: "permission-request-auto",
      reply: "always",
    });
  });

  it("auto-approves allowlisted external directory permissions", async () => {
    const client = createApprovalClient();

    await expect(
      normalizeOpenCodeActionableEvent({
        autoApprove: false,
        client,
        event: {
          type: "permission.asked",
          properties: {
            id: "permission-request-allowlisted",
            permission: "external_directory",
            patterns: ["/tmp/hello.txt", "/app/output/report.txt"],
          },
        },
      }),
    ).resolves.toEqual({ type: "none" });

    expect(client.replyPermission).toHaveBeenCalledWith({
      requestID: "permission-request-allowlisted",
      reply: "always",
    });
  });

  it("surfaces OpenCode questions instead of answering them when auto-approve is enabled", async () => {
    const client = createApprovalClient();
    const question = {
      id: "question-request-manual",
      sessionID: "session-1",
      questions: [
        {
          header: "Destination",
          question: "Where should this run?",
          options: [{ label: "Slack", description: "Slack workspace" }],
        },
      ],
      tool: {
        messageID: "msg-1",
        callID: "call-1",
      },
    };

    await expect(
      normalizeOpenCodeActionableEvent({
        autoApprove: true,
        client,
        event: {
          type: "question.asked",
          properties: question,
        },
      }),
    ).resolves.toEqual({
      type: "question",
      request: {
        id: "question-request-manual",
        sessionId: "session-1",
        questions: [
          {
            header: "Destination",
            question: "Where should this run?",
            options: [{ label: "Slack", description: "Slack workspace" }],
            multiple: undefined,
            custom: undefined,
          },
        ],
        tool: {
          messageId: "msg-1",
          callId: "call-1",
        },
      },
    });
    expect(client.replyQuestion).not.toHaveBeenCalled();
    expect(client.rejectQuestion).not.toHaveBeenCalled();
  });

  it("sends rejected OpenCode question decisions through the runtime client", async () => {
    const client = createApprovalClient();

    await sendOpenCodeRuntimeDecision(client, {
      kind: "question",
      requestId: "question-request-manual",
      reject: true,
    });

    expect(client.rejectQuestion).toHaveBeenCalledWith({
      requestID: "question-request-manual",
    });
    expect(client.replyQuestion).not.toHaveBeenCalled();
  });
});
