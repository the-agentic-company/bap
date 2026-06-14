import { describe, expect, it } from "vitest";
import { classifyRuntimeFailure } from "../../services/lifecycle-policy";
import { extractRuntimeExportState } from "./opencode-reattach";

describe("extractRuntimeExportState", () => {
  it("classifies terminal, waiting, and recoverable exported runtime states", () => {
    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [{ type: "step-finish", reason: "complete" }],
          },
        ],
      }),
    ).toBe("terminal_completed");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [{ type: "step-finish", reason: "error" }],
          },
        ],
      }),
    ).toBe("terminal_failed");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              { type: "tool", tool: "question", state: { status: "running" } },
              { type: "step-finish", reason: "stop" },
            ],
          },
        ],
      }),
    ).toBe("waiting_approval");

    expect(
      extractRuntimeExportState({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "auth",
                state: {
                  status: "running",
                  input: { integrations: ["slack"] },
                },
              },
              { type: "step-finish", reason: "stop" },
            ],
          },
        ],
      }),
    ).toBe("waiting_auth");

    const pendingToolExport = extractRuntimeExportState({
      messages: [
        {
          info: { role: "assistant" },
          parts: [{ type: "tool", tool: "bash", state: { status: "pending" } }],
        },
      ],
    });
    expect(pendingToolExport).toBe("non_terminal");
    expect(
      classifyRuntimeFailure({
        exportState: pendingToolExport,
        sandboxState: "live",
        canRecover: true,
      }),
    ).toBe("recoverable_live_runtime");
    expect(
      classifyRuntimeFailure({
        exportState: pendingToolExport,
        sandboxState: "live",
        canRecover: false,
      }),
    ).toBe("broken_runtime_state");
  });
});
