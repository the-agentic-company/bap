import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generationFindFirstMock,
  messageFindFirstMock,
  conversationFindFirstMock,
  emitCanonicalServiceEventMock,
  recordCounterMock,
  recordHistogramMock,
} = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  conversationFindFirstMock: vi.fn(),
  emitCanonicalServiceEventMock: vi.fn(),
  recordCounterMock: vi.fn(),
  recordHistogramMock: vi.fn(),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      generation: { findFirst: generationFindFirstMock },
      message: { findFirst: messageFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
    },
  },
}));

vi.mock("../../../utils/observability", () => ({
  emitCanonicalServiceEvent: emitCanonicalServiceEventMock,
  recordCounter: recordCounterMock,
  recordHistogram: recordHistogramMock,
}));

import { emitGenerationTerminalCanonicalEvent } from "./canonical-generation-events";

describe("Generation terminal canonical event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationFindFirstMock.mockResolvedValue(null);
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      conversationId: "conv-1",
      conversation: {
        id: "conv-1",
        userId: "user-1",
        workspaceId: "ws-1",
        model: "openai/gpt-5",
        authSource: "user",
        autoApprove: true,
        lastSandboxProvider: "daytona",
      },
      messageId: "msg-1",
      status: "completed",
      completionReason: "completed",
      errorMessage: null,
      sandboxProvider: "daytona",
      executionPolicy: {
        autoApprove: false,
        selectedPlatformSkillSlugs: ["gmail"],
        queuedFileAttachments: [{ name: "a.txt", mimeType: "text/plain", dataUrl: "data:" }],
      },
      sandboxId: "sandbox-1",
      runtimeId: "runtime-1",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
      traceId: "0123456789abcdef0123456789abcdef",
      startedAt: new Date("2026-05-22T10:00:00.000Z"),
      completedAt: new Date("2026-05-22T10:00:05.000Z"),
      inputTokens: 11,
      outputTokens: 13,
      contentParts: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "gmail.read_latest",
          input: { query: "private" },
          integration: "gmail",
          operation: "read_latest",
        },
        {
          type: "approval",
          tool_use_id: "tool-2",
          tool_name: "gmail.send",
          tool_input: { body: "private" },
          integration: "gmail",
          operation: "send",
          status: "approved",
        },
      ],
    });
    messageFindFirstMock.mockResolvedValue({
      timing: {
        generationDurationMs: 5000,
        sandboxStartupDurationMs: 1000,
        sandboxStartupMode: "created",
        phaseDurationsMs: {
          agentInitMs: 900,
          prePromptSetupMs: 700,
          modelStreamMs: 2200,
          postProcessingMs: 100,
        },
      },
    });
  });

  it("emits the documented terminal Generation namespaces", async () => {
    await emitGenerationTerminalCanonicalEvent("gen-1");

    expect(emitCanonicalServiceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "cmdclaw.generation.terminal",
        eventId: "generation:gen-1:terminal",
        outcome: "completed",
        context: expect.objectContaining({
          traceId: "0123456789abcdef0123456789abcdef",
          generationId: "gen-1",
          conversationId: "conv-1",
          userId: "user-1",
        }),
        attributes: expect.objectContaining({
          "cmdclaw.model.provider": "openai",
          "cmdclaw.model.name": "openai/gpt-5",
          "cmdclaw.auth.source": "user",
          "cmdclaw.auto_approve.enabled": false,
          "cmdclaw.skills.selected_count": 1,
          "cmdclaw.attachments.count": 1,
          "cmdclaw.phase.agent_init_ms": 900,
          "cmdclaw.phase.model_stream_ms": 2200,
          "cmdclaw.tool.call_count": 1,
          "cmdclaw.tool.write_count": 1,
          "cmdclaw.approval.count": 1,
          "cmdclaw.auth_interrupt.count": 0,
          "cmdclaw.usage.input_tokens": 11,
          "cmdclaw.usage.output_tokens": 13,
          "cmdclaw.usage.total_tokens": 24,
          "cmdclaw.failure.phase": "none",
        }),
      }),
    );
    const attributes = emitCanonicalServiceEventMock.mock.calls[0]?.[0]?.attributes;
    expect(attributes).not.toHaveProperty("cmdclaw.generation.input_tokens");
    expect(attributes).not.toHaveProperty("cmdclaw.generation.tool_call_count");
    expect(attributes).not.toHaveProperty("cmdclaw.generation.phase_durations_ms");
    expect(attributes["cmdclaw.tool.summary_json"]).toContain("gmail.read_latest");
    expect(JSON.parse(attributes["cmdclaw.tool.summary_json"])).toEqual([
      {
        integration_type: "gmail",
        tool_name: "gmail.read_latest",
        operation: "read_latest",
        access: "read",
      },
      {
        integration_type: "gmail",
        tool_name: "gmail.send",
        operation: "send",
        access: "write",
      },
    ]);
    const terminalMetricLabels = {
      outcome: "completed",
      model_provider: "openai",
      sandbox_provider: "daytona",
      failure_phase: "none",
      normalized_error_code: "none",
    };
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "cmdclaw_generation_terminal_duration_ms",
      5000,
      terminalMetricLabels,
      "Terminal Generation duration in milliseconds.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "cmdclaw_generation_terminal_input_tokens",
      11,
      terminalMetricLabels,
      "Input token usage per terminal Generation.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "cmdclaw_generation_terminal_output_tokens",
      13,
      terminalMetricLabels,
      "Output token usage per terminal Generation.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "cmdclaw_generation_terminal_total_tokens",
      24,
      terminalMetricLabels,
      "Total token usage per terminal Generation.",
    );
  });
});
