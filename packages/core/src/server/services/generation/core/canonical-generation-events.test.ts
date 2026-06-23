import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generationFindFirstMock,
  generationUpdateReturningMock,
  generationUpdateWhereMock,
  generationUpdateSetMock,
  dbUpdateMock,
  messageFindFirstMock,
  conversationFindFirstMock,
  coworkerFindFirstMock,
  coworkerRunFindFirstMock,
  emitCanonicalServiceEventMock,
  recordCounterMock,
  recordHistogramMock,
} = vi.hoisted(() => ({
  generationFindFirstMock: vi.fn(),
  generationUpdateReturningMock: vi.fn(),
  generationUpdateWhereMock: vi.fn(),
  generationUpdateSetMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  conversationFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  coworkerRunFindFirstMock: vi.fn(),
  emitCanonicalServiceEventMock: vi.fn(),
  recordCounterMock: vi.fn(),
  recordHistogramMock: vi.fn(),
}));

vi.mock("@bap/db/client", () => ({
  db: {
    update: dbUpdateMock,
    query: {
      generation: { findFirst: generationFindFirstMock },
      message: { findFirst: messageFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
      coworker: { findFirst: coworkerFindFirstMock },
      coworkerRun: { findFirst: coworkerRunFindFirstMock },
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
    dbUpdateMock.mockReturnValue({ set: generationUpdateSetMock });
    generationUpdateSetMock.mockReturnValue({ where: generationUpdateWhereMock });
    generationUpdateWhereMock.mockReturnValue({ returning: generationUpdateReturningMock });
    generationUpdateReturningMock.mockResolvedValue([{ id: "gen-1" }]);
    conversationFindFirstMock.mockResolvedValue(null);
    coworkerFindFirstMock.mockResolvedValue(null);
    coworkerRunFindFirstMock.mockResolvedValue(null);
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
        type: "chat",
        syntheticKind: null,
      },
      messageId: "msg-1",
      status: "completed",
      completionReason: "completed",
      errorMessage: null,
      sandboxProvider: "daytona",
      executionPolicy: {
        autoApprove: false,
        selectedPlatformSkillSlugs: ["gmail"],
        queuedFileAttachments: [
          {
            fileAssetId: "asset-a",
            name: "a.txt",
            mimeType: "text/plain",
            sizeBytes: 1,
          },
        ],
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
          type: "tool_use",
          id: "tool-2",
          name: "gmail.send",
          input: { body: "private" },
          integration: "gmail",
          operation: "send",
        },
        {
          type: "approval",
          tool_use_id: "tool-3",
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
    await expect(emitGenerationTerminalCanonicalEvent("gen-1")).resolves.toBe(true);

    expect(emitCanonicalServiceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "bap.generation.terminal",
        eventId: "generation:gen-1:terminal",
        outcome: "completed",
        context: expect.objectContaining({
          traceId: "0123456789abcdef0123456789abcdef",
          generationId: "gen-1",
          conversationId: "conv-1",
          userId: "user-1",
        }),
        attributes: expect.objectContaining({
          "bap.model.provider": "openai",
          "bap.model.name": "openai/gpt-5",
          "bap.auth.source": "user",
          "bap.auto_approve.enabled": false,
          "bap.skills.selected_count": 1,
          "bap.attachments.count": 1,
          "app.phase.agent_init_ms": 900,
          "app.phase.model_stream_ms": 2200,
          "bap.tool.call_count": 2,
          "bap.tool.write_count": 2,
          "bap.approval.count": 1,
          "bap.auth_interrupt.count": 0,
          "bap.usage.input_tokens": 11,
          "bap.usage.output_tokens": 13,
          "bap.usage.total_tokens": 24,
          "bap.failure.phase": "none",
        }),
      }),
    );
    const attributes = emitCanonicalServiceEventMock.mock.calls[0]?.[0]?.attributes;
    expect(attributes).not.toHaveProperty("bap.generation.input_tokens");
    expect(attributes).not.toHaveProperty("bap.generation.tool_call_count");
    expect(attributes).not.toHaveProperty("bap.generation.phase_durations_ms");
    expect(attributes["bap.tool.summary_json"]).toContain("gmail.read_latest");
    expect(JSON.parse(attributes["bap.tool.summary_json"])).toEqual([
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
      "bap_generation_terminal_duration_ms",
      5000,
      terminalMetricLabels,
      "Terminal Generation duration in milliseconds.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "bap_generation_terminal_input_tokens",
      11,
      terminalMetricLabels,
      "Input token usage per terminal Generation.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "bap_generation_terminal_output_tokens",
      13,
      terminalMetricLabels,
      "Output token usage per terminal Generation.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "bap_generation_terminal_total_tokens",
      24,
      terminalMetricLabels,
      "Total token usage per terminal Generation.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "bap_generation_terminal_tool_calls",
      1,
      {
        ...terminalMetricLabels,
        integration_type: "gmail",
        operation: "read_latest",
        access: "read",
      },
      "Tool call count per terminal Generation, grouped by bounded tool dimensions.",
    );
    expect(recordHistogramMock).toHaveBeenCalledWith(
      "bap_generation_terminal_tool_calls",
      1,
      {
        ...terminalMetricLabels,
        integration_type: "gmail",
        operation: "send",
        access: "write",
      },
      "Tool call count per terminal Generation, grouped by bounded tool dimensions.",
    );
    expect(recordHistogramMock).not.toHaveBeenCalledWith(
      "bap_generation_terminal_tool_calls",
      2,
      terminalMetricLabels,
      "Tool call count per terminal Generation.",
    );
  });

  it("does not emit logs or metrics when the terminal event was already claimed", async () => {
    generationUpdateReturningMock.mockResolvedValueOnce([]);

    await expect(emitGenerationTerminalCanonicalEvent("gen-1")).resolves.toBe(false);

    expect(generationFindFirstMock).not.toHaveBeenCalled();
    expect(emitCanonicalServiceEventMock).not.toHaveBeenCalled();
    expect(recordCounterMock).not.toHaveBeenCalled();
    expect(recordHistogramMock).not.toHaveBeenCalled();
  });

  it("classifies runtime progress stalls as timed-out runtime failures", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      conversationId: "conv-1",
      conversation: {
        id: "conv-1",
        userId: "user-1",
        workspaceId: "ws-1",
        model: "openai/gpt-5",
        authSource: "user",
        autoApprove: false,
        lastSandboxProvider: "daytona",
        type: "chat",
        syntheticKind: null,
      },
      messageId: "msg-1",
      status: "error",
      completionReason: "runtime_progress_stalled",
      errorMessage: "The runtime stopped making progress. Please retry.",
      sandboxProvider: "daytona",
      executionPolicy: {},
      sandboxId: "sandbox-1",
      runtimeId: "runtime-1",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
      traceId: "0123456789abcdef0123456789abcdef",
      startedAt: new Date("2026-05-22T10:00:00.000Z"),
      completedAt: new Date("2026-05-22T10:02:00.000Z"),
      inputTokens: 0,
      outputTokens: 0,
      contentParts: [],
      debugInfo: {
        runtimeDiagnosticSnapshot: {
          id: "snapshot-1",
          storageKey: "runtime-diagnostic-snapshots/gen-1/snapshot-1.json",
          uploadSucceeded: true,
          timeoutMs: 90_000,
          stalledMs: 91_000,
          lastRuntimeProgressAt: "2026-05-22T10:00:29.000Z",
          lastRuntimeProgressKind: "tool_result",
        },
      },
    });

    await expect(emitGenerationTerminalCanonicalEvent("gen-1")).resolves.toBe(true);

    expect(emitCanonicalServiceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "timed_out",
        attributes: expect.objectContaining({
          "bap.generation.completion_reason": "runtime_progress_stalled",
          "bap.failure.phase": "runtime",
          "bap.error.normalized_code": "runtime_progress_stalled",
          "bap.runtime.progress_stall.stalled_ms": 91_000,
          "bap.runtime.progress_stall.last_progress_at":
            "2026-05-22T10:00:29.000Z",
          "bap.runtime.progress_stall.last_progress_kind": "tool_result",
        }),
      }),
    );
    expect(recordCounterMock).toHaveBeenCalledWith(
      "bap_generation_terminal_total",
      1,
      expect.objectContaining({
        outcome: "timed_out",
        failure_phase: "runtime",
        normalized_error_code: "runtime_progress_stalled",
      }),
      expect.any(String),
    );
  });
});
