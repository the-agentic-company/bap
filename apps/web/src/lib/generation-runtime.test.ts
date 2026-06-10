import { describe, expect, it } from "vitest";
import { createGenerationRuntime } from "./generation-runtime";

describe("GenerationRuntime tool result matching", () => {
  it("matches tool results by toolUseId when repeated tool names exist", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "echo first" },
      toolUseId: "tool-1",
    });
    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "echo second" },
      toolUseId: "tool-2",
    });

    runtime.handleToolResult("bash", "second result", "tool-2");

    const snapshot = runtime.snapshot;
    const toolCalls = snapshot.parts.filter((part) => part.type === "tool_call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({ id: "tool-1" });
    expect(toolCalls[0]).not.toHaveProperty("result");
    expect(toolCalls[1]).toMatchObject({ id: "tool-2", result: "second result" });

    const allItems = snapshot.segments.flatMap((segment) => segment.items);
    const firstTool = allItems.find(
      (item) => item.type === "tool_call" && item.toolUseId === "tool-1",
    );
    const secondTool = allItems.find(
      (item) => item.type === "tool_call" && item.toolUseId === "tool-2",
    );
    expect(firstTool).toMatchObject({ status: "running" });
    expect(secondTool).toMatchObject({ status: "complete", result: "second result" });
  });

  it("falls back to tool name matching when toolUseId is missing", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "search",
      toolInput: { query: "alpha" },
      toolUseId: "tool-search-1",
    });
    runtime.handleToolResult("search", { ok: true });

    const snapshot = runtime.snapshot;
    const toolCall = snapshot.parts.find(
      (part): part is Extract<(typeof snapshot.parts)[number], { type: "tool_call" }> =>
        part.type === "tool_call",
    );
    expect(toolCall).toMatchObject({ id: "tool-search-1", result: { ok: true } });
  });

  it("tracks elapsed time per tool call and aggregates activity stats", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "search",
      toolInput: { query: "activity timer" },
      toolUseId: "tool-search-1",
    });
    runtime.handleToolResult("search", { ok: true }, "tool-search-1");

    const snapshot = runtime.snapshot;
    const toolItem = snapshot.segments
      .flatMap((segment) => segment.items)
      .find((item) => item.type === "tool_call" && item.toolUseId === "tool-search-1");

    expect(toolItem?.elapsedMs).toBeTypeOf("number");
    expect(toolItem?.elapsedMs).toBeGreaterThanOrEqual(0);

    const stats = runtime.getActivityStats();
    expect(stats.totalToolCalls).toBe(1);
    expect(stats.completedToolCalls).toBe(1);
    expect(stats.totalToolDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.perToolUseIdMs["tool-search-1"]).toBeGreaterThanOrEqual(0);
  });

  it("does not duplicate approvals in the built assistant message", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "question",
      toolInput: {
        questions: [{ header: "Next Task", question: "What would you like to work on right now?" }],
      },
      toolUseId: "question-tool-1",
      integration: "cmdclaw",
      operation: "question",
    });
    runtime.handleApproval({
      toolUseId: "question-tool-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Next Task", question: "What would you like to work on right now?" }],
      },
      integration: "cmdclaw",
      operation: "question",
      status: "approved",
      questionAnswers: [["Review code changes"]],
    });
    runtime.handleText("Got it.");

    const assistant = runtime.buildAssistantMessage();
    const approvals = assistant.parts.filter((part) => part.type === "approval");

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      toolUseId: "question-tool-1",
      status: "approved",
      questionAnswers: [["Review code changes"]],
    });
  });

  it("resolves a pending approval by interrupt id when the resolved tool id differs", () => {
    const runtime = createGenerationRuntime();

    runtime.handlePendingApproval({
      interruptId: "interrupt-question-1",
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-pending",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Output format", question: "What should the output look like?" }],
      },
      integration: "cmdclaw",
      operation: "question",
    });

    runtime.handleApproval({
      interruptId: "interrupt-question-1",
      toolUseId: "tool-resolved",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Output format", question: "What should the output look like?" }],
      },
      integration: "cmdclaw",
      operation: "question",
      status: "approved",
      questionAnswers: [["Plain Hi"]],
    });

    const approvalSegments = runtime.snapshot.segments.filter((segment) => segment.approval);

    expect(approvalSegments).toHaveLength(1);
    expect(approvalSegments[0]?.approval).toMatchObject({
      interruptId: "interrupt-question-1",
      toolUseId: "tool-resolved",
      status: "approved",
      questionAnswers: [["Plain Hi"]],
    });
  });

  it("updates a duplicate pending approval instead of appending another segment", () => {
    const runtime = createGenerationRuntime();

    runtime.handlePendingApproval({
      interruptId: "interrupt-question-1",
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-question-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "First", question: "Pick one" }],
      },
      integration: "cmdclaw",
      operation: "question",
    });
    runtime.handlePendingApproval({
      interruptId: "interrupt-question-1",
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-question-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Updated", question: "Pick one" }],
      },
      integration: "cmdclaw",
      operation: "question",
    });

    const approvalSegments = runtime.snapshot.segments.filter((segment) => segment.approval);

    expect(approvalSegments).toHaveLength(1);
    expect(approvalSegments[0]?.approval).toMatchObject({
      interruptId: "interrupt-question-1",
      toolUseId: "tool-question-1",
      status: "pending",
      toolInput: {
        questions: [{ header: "Updated", question: "Pick one" }],
      },
    });
  });

  it("ignores duplicate pending approvals after an approval is resolved", () => {
    const runtime = createGenerationRuntime();

    runtime.handlePendingApproval({
      interruptId: "interrupt-question-1",
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-question-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Choose", question: "Pick one" }],
      },
      integration: "cmdclaw",
      operation: "question",
    });
    runtime.handleApproval({
      interruptId: "interrupt-question-1",
      toolUseId: "tool-question-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Choose", question: "Pick one" }],
      },
      integration: "cmdclaw",
      operation: "question",
      status: "approved",
      questionAnswers: [["Yes"]],
    });
    runtime.handlePendingApproval({
      interruptId: "interrupt-question-1",
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-question-1",
      toolName: "Question",
      toolInput: {
        questions: [{ header: "Choose", question: "Pick one" }],
      },
      integration: "cmdclaw",
      operation: "question",
    });

    const approvalSegments = runtime.snapshot.segments.filter((segment) => segment.approval);

    expect(approvalSegments).toHaveLength(1);
    expect(approvalSegments[0]?.approval).toMatchObject({
      interruptId: "interrupt-question-1",
      toolUseId: "tool-question-1",
      status: "approved",
      questionAnswers: [["Yes"]],
    });
  });
});
