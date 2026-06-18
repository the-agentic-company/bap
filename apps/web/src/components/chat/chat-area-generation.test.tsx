// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatAreaMocks, resetChatAreaMocks } from "./chat-area.test-support";
import { ChatArea } from "./chat-area";

const {
  mockStartGeneration,
  mockSubscribeToGeneration,
  mockAbort,
  mockPosthogCapture,
  mockInvalidateQueries,
  mockSetQueryData,
  mockCancelGenerationMutateAsync,
  mockActiveGenerationState,
} = chatAreaMocks;

describe("ChatArea generation lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetChatAreaMocks();
  });

  it("shows an inline error and exits Preparing agent when startGeneration fails before onStarted", async () => {
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      await Promise.resolve();
      callbacks.onError?.({
        code: "model_access_denied",
        message:
          "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
        phase: "start_rpc",
        transportCode: "BAD_REQUEST",
      });
      return null;
    });

    render(<ChatArea />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Preparing agent...")).not.toBeInTheDocument();
  });

  it("cancels the durable active generation when stopping before a local stream id is attached", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mockActiveGenerationState.data = {
      generationId: "gen-active",
      startedAt: new Date("2026-05-22T10:00:00.000Z").toISOString(),
      errorMessage: null,
      status: "generating",
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
    };

    render(<ChatArea conversationId="conv-1" />);

    await waitFor(() => {
      expect(mockSubscribeToGeneration).toHaveBeenCalledWith("gen-active", expect.any(Object));
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(mockCancelGenerationMutateAsync).toHaveBeenCalledWith("gen-active");
    });
    expect(mockAbort).toHaveBeenCalled();
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["generation", "active", "conv-1"],
      expect.objectContaining({
        generationId: null,
        status: null,
      }),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("endReason=user_stopped"),
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining("endReason=user_stopped"));
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining("generationId=gen-active"));
    expect(mockPosthogCapture).toHaveBeenCalledWith(
      "agent_init_missing",
      expect.objectContaining({
        endReason: "user_stopped",
        generationId: "gen-active",
      }),
    );
  });

  it("resolves submit immediately without waiting for the full stream to finish", async () => {
    mockStartGeneration.mockImplementation(() => new Promise(() => {}));

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByTestId("submit-status")).toHaveTextContent("resolved");
    });
    expect(mockStartGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello", conversationId: "conv-1" }),
      expect.any(Object),
    );
  });

  it("does not revive live activity from stale active-generation data after done", async () => {
    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-done", "conv-1");
      callbacks.onToolUse?.({
        toolName: "Bash",
        toolInput: { command: "echo hi" },
        toolUseId: "tool-1",
        integration: "bap",
        operation: "bash",
      });
      callbacks.onDone?.("gen-done", "conv-1", "assistant-1", undefined, {
        timing: {
          generationDurationMs: 1200,
        },
      });
      return null;
    });

    const { rerender } = render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["generation", "active", "conv-1"],
        expect.objectContaining({
          generationId: null,
          status: null,
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Activity Feed")).not.toBeInTheDocument();
    });

    mockSubscribeToGeneration.mockClear();
    mockActiveGenerationState.data = {
      generationId: "gen-done",
      startedAt: "2026-04-10T12:00:00.000Z",
      errorMessage: null,
      status: "generating",
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
    };

    rerender(<ChatArea conversationId="conv-1" />);

    await waitFor(() => {
      expect(screen.queryByText("Activity Feed")).not.toBeInTheDocument();
    });
    expect(mockSubscribeToGeneration).not.toHaveBeenCalled();
  });

  it("syncs coworker queries when a coworker edit tool completes", async () => {
    const onCoworkerSync = vi.fn<(payload: unknown) => void>();

    mockStartGeneration.mockImplementationOnce(async (_input, callbacks) => {
      callbacks.onStarted?.("gen-1", "conv-1");
      mockInvalidateQueries.mockClear();
      callbacks.onToolUse?.({
        toolName: "Bash",
        toolInput: {
          command: "coworker edit cw-1 --changes-file /tmp/coworker.json --json",
        },
        toolUseId: "tool-1",
        integration: "coworker",
        operation: "edit",
      });
      callbacks.onToolResult?.(
        "Bash",
        {
          kind: "coworker_edit_apply",
          status: "applied",
          coworkerId: "cw-1",
        },
        "tool-1",
      );
      return null;
    });

    render(
      <ChatArea conversationId="conv-1" forceCoworkerQuerySync onCoworkerSync={onCoworkerSync} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ["coworker"],
      });
      expect(mockInvalidateQueries).toHaveBeenNthCalledWith(2, {
        queryKey: ["coworker", "get", "cw-1"],
      });
    });
    expect(onCoworkerSync).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      prompt: undefined,
      updatedAt: undefined,
    });
  });
});
