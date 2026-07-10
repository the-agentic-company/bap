// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRunnerDeclaredFailureReason,
  isRunnerDeclaredFailure,
  RunnerDeclaredFailureNote,
} from "./runner-declared-failure";

const runnerDebugInfo = {
  reason: "self_test_requested",
  markedFailedBy: "runner_mcp_tool",
};

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/chat/chat-area", () => ({
  ChatArea: ({ transcriptFooter }: { transcriptFooter?: React.ReactNode }) => (
    <div>{transcriptFooter}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("runner-declared failure presentation", () => {
  it("identifies runner-declared failures by failure kind", () => {
    expect(isRunnerDeclaredFailure("runner_declared_failure")).toBe(true);
    expect(isRunnerDeclaredFailure("internal_error")).toBe(false);
    expect(isRunnerDeclaredFailure(null)).toBe(false);
  });

  it("extracts the runner-provided failure reason from debug info", () => {
    expect(getRunnerDeclaredFailureReason({ reason: " self_test_requested " })).toBe(
      "self_test_requested",
    );
    expect(getRunnerDeclaredFailureReason({ reason: "" })).toBeNull();
    expect(getRunnerDeclaredFailureReason(null)).toBeNull();
  });

  it("renders the terminal failure note without the raw error message", () => {
    render(<RunnerDeclaredFailureNote debugInfo={runnerDebugInfo} />);

    expect(screen.getByText(/The agent marked the run as failed with the reason/)).toBeTruthy();
    expect(screen.getByText("self_test_requested")).toBeTruthy();
    expect(screen.queryByText("Technical details")).toBeNull();
  });
});
