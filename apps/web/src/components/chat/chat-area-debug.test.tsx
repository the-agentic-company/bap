// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatAreaMocks, renderInChatHeader, resetChatAreaMocks } from "./chat-area.test-support";
import { ChatArea } from "./chat-area";

const { mockStartGeneration, mockAdminState, mockActiveGenerationState } = chatAreaMocks;

describe("ChatArea admin debug recovery presets", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetChatAreaMocks();
  });

  it("arms the approval recovery preset and forwards the approval park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "7" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content: "send a message on slack #experiment-bap-testing saying hi",
          debugApprovalHotWaitMs: 7_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("arms the auth recovery preset and forwards the auth park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "9" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content:
            "Use the Notion integration to list my first 5 Notion databases by name. Do not use any other source.",
          debugApprovalHotWaitMs: 9_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("arms the question recovery preset and forwards the question park override", async () => {
    mockAdminState.isAdmin = true;
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.change(screen.getAllByRole("spinbutton")[2], { target: { value: "11" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Arm" })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content:
            "Use the question tool exactly once with header 'Pick', question 'Choose one', and options 'Alpha' and 'Beta'. After I answer, respond exactly as SELECTED=<answer>.",
          debugApprovalHotWaitMs: 11_000,
        }),
        expect.any(Object),
      );
    });
  });

  it("shows the runtime resume action for paused run-deadline generations", async () => {
    mockAdminState.isAdmin = true;
    mockActiveGenerationState.data = {
      generationId: "gen-paused",
      startedAt: "2026-04-10T10:00:00.000Z",
      errorMessage: null,
      status: "paused",
      pauseReason: "run_deadline",
      debugRunDeadlineMs: 30_000,
      contentParts: null,
    };
    mockStartGeneration.mockResolvedValue(null);

    renderInChatHeader(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: /admin debug controls/i }));
    fireEvent.click(screen.getByRole("button", { name: /resume paused runtime/i }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-1",
          content: "continue",
          resumePausedGenerationId: "gen-paused",
        }),
        expect.any(Object),
      );
    });
  });
});
