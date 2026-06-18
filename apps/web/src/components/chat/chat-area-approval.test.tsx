// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatAreaMocks, resetChatAreaMocks } from "./chat-area.test-support";
import { ChatArea } from "./chat-area";

const {
  mockStartGeneration,
  mockSubscribeToGeneration,
  mockSubmitApprovalMutateAsync,
  mockActiveGenerationState,
} = chatAreaMocks;

describe("ChatArea approval and runtime-deadline recovery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetChatAreaMocks();
  });

  it("shows a continue question card when a run parks on the runtime deadline", async () => {
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-deadline", "conv-1");
      callbacks.onToolUse?.({
        toolName: "Bash",
        toolInput: { command: "google-gmail list -l 30" },
        toolUseId: "tool-1",
        integration: "google_gmail",
        operation: "list",
      });
      callbacks.onStatusChange?.("run_deadline_parked", {
        sandboxId: "sandbox-old",
        releasedSandboxId: "sandbox-old",
      });
      return null;
    });
    mockStartGeneration.mockResolvedValueOnce(null);

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Runtime limit reached")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/This run hit the 15m .* max runtime and stopped\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stopped after max runtime of 15m .*./i)).toBeInTheDocument();
    expect(screen.getAllByText("Activity Feed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          conversationId: "conv-1",
          content: "continue",
          resumePausedGenerationId: "gen-deadline",
        }),
        expect.any(Object),
      );
    });
    expect(mockStartGeneration.mock.calls[1]?.[0]).not.toHaveProperty("debugRunDeadlineMs");
    expect(screen.getByText(/Resumed below\./i)).toBeInTheDocument();
    expect(screen.getByText("continue")).toBeInTheDocument();

    const originalMessage = screen.getByText("hello");
    const historicalBlock = screen.getByText(
      /Stopped after max runtime of 15m .* Resumed below\./i,
    );
    const continueMessage = screen.getByText("continue");

    expect(
      originalMessage.compareDocumentPosition(historicalBlock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      historicalBlock.compareDocumentPosition(continueMessage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("rehydrates paused runtime activity from persisted active-generation content parts", async () => {
    mockActiveGenerationState.data = {
      generationId: "gen-paused",
      startedAt: "2026-04-10T10:00:00.000Z",
      errorMessage: null,
      status: "paused",
      pauseReason: "run_deadline",
      debugRunDeadlineMs: 30_000,
      contentParts: [
        {
          type: "thinking",
          id: "thinking-1",
          content: "Reviewing recent emails",
        },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "google-gmail list -l 30" },
          integration: "google_gmail",
          operation: "list",
        },
      ],
    };

    render(<ChatArea conversationId="conv-1" />);

    expect(screen.getByText("Runtime limit reached")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This run hit the 30.0s max runtime and stopped. Do you want to continue from where it left off?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stopped after max runtime of 30\.0s/i)).toBeInTheDocument();
    expect(screen.getAllByText("Activity Feed").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("removes a parked approval card immediately and reconnects the stream on approve", async () => {
    mockActiveGenerationState.data = null;
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-approval", "conv-1");
      callbacks.onPendingApproval?.({
        interruptId: "interrupt-approval-1",
        generationId: "gen-approval",
        conversationId: "conv-1",
        toolUseId: "tool-approval",
        toolName: "ask_question",
        toolInput: {
          questions: [
            {
              header: "Continue",
              question: "Proceed?",
              options: [{ label: "Yes" }],
            },
          ],
        },
        integration: "bap",
        operation: "question",
      });
      callbacks.onStatusChange?.("approval_parked");
      return null;
    });

    const { rerender } = render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Continue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      expect(mockSubmitApprovalMutateAsync).toHaveBeenCalledWith({
        interruptId: "interrupt-approval-1",
        decision: "approve",
        questionAnswers: [["Yes"]],
      });
    });

    mockActiveGenerationState.data = {
      generationId: "gen-approval",
      startedAt: "2026-04-10T12:00:00.000Z",
      errorMessage: null,
      status: "awaiting_approval",
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
    };
    rerender(<ChatArea conversationId="conv-1" />);

    await waitFor(() => {
      expect(screen.getByText("Tool Approval approved")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockSubscribeToGeneration).toHaveBeenCalledWith("gen-approval", expect.any(Object));
    });
  });

  it("optimistically shows submitted question answers before approval RPC resolves", async () => {
    mockActiveGenerationState.data = null;
    mockSubmitApprovalMutateAsync.mockImplementationOnce(() => new Promise(() => {}));
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-question", "conv-1");
      callbacks.onPendingApproval?.({
        interruptId: "interrupt-question-1",
        generationId: "gen-question",
        conversationId: "conv-1",
        toolUseId: "tool-question",
        toolName: "question",
        toolInput: {
          questions: [
            {
              header: "Choose",
              question: "Pick one",
              options: [{ label: "Yes" }],
            },
          ],
        },
        integration: "bap",
        operation: "question",
      });
      callbacks.onStatusChange?.("approval_parked");
      return null;
    });

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Choose")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => {
      expect(mockSubmitApprovalMutateAsync).toHaveBeenCalledWith({
        interruptId: "interrupt-question-1",
        decision: "approve",
        questionAnswers: [["Yes"]],
      });
    });
    expect(screen.getByText("Tool Approval approved")).toBeInTheDocument();
    expect(screen.getByText("Answer Yes")).toBeInTheDocument();
  });
});
