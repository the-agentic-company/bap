import { describe, expect, it } from "vitest";
import { buildDefaultQuestionAnswers, buildQuestionCommand } from "./runtime-driver";

describe("runtime driver question helpers", () => {
  it("formats Bap question approvals from question payloads", () => {
    const request = {
      id: "que-1",
      sessionId: "ses-1",
      questions: [
        {
          header: "Goal",
          question: "What do you want me to ask you about?",
          options: [
            { label: "Project task (Recommended)", description: "Use the project task." },
            { label: "Preferences", description: "Ask about preferences." },
          ],
        },
        {
          header: "Format",
          question: "How should I phrase it?",
          options: [{ label: "Direct", description: "Use direct language." }],
        },
      ],
      tool: {
        messageId: "msg-1",
        callId: "call-1",
      },
    };

    expect(buildQuestionCommand(request)).toBe(
      "Question: What do you want me to ask you about? [Project task (Recommended) | Preferences] (+1 more)",
    );
    expect(buildDefaultQuestionAnswers(request)).toEqual([
      ["Project task (Recommended)"],
      ["Direct"],
    ]);
  });
});
