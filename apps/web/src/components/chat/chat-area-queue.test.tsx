// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatAreaMocks, resetChatAreaMocks } from "./chat-area.test-support";
import { ChatArea } from "./chat-area";

const {
  mockStartGeneration,
  mockUseHotkeys,
  mockConversationState,
  mockConversationQueuedMessagesState,
  mockEnqueueConversationMessageMutateAsync,
  mockUpdateConversationQueuedMessageMutateAsync,
} = chatAreaMocks;

describe("ChatArea message queue and chrome", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetChatAreaMocks();
  });

  it("queues additional messages without replacing the existing queue entry", async () => {
    mockStartGeneration.mockImplementation(() => new Promise(() => {}));
    mockEnqueueConversationMessageMutateAsync.mockResolvedValue({ queuedMessageId: "queue-2" });

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ content: "hello", conversationId: "conv-1" }),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockEnqueueConversationMessageMutateAsync).toHaveBeenCalledWith({
        conversationId: "conv-1",
        content: "hello",
        selectedPlatformSkillSlugs: [],
        fileAttachments: undefined,
        replaceExisting: false,
      });
    });
  });

  it("renders all queued messages instead of only the first one", () => {
    mockConversationQueuedMessagesState.data = [
      {
        id: "queue-1",
        content: "First queued follow-up",
        status: "queued",
        createdAt: "2026-04-02T03:55:02.000Z",
      },
      {
        id: "queue-2",
        content: "Second queued follow-up",
        status: "queued",
        createdAt: "2026-04-02T03:56:02.000Z",
      },
    ];

    render(<ChatArea conversationId="conv-1" />);

    expect(screen.getByText("2 queued messages")).toBeInTheDocument();
    expect(screen.getByText("1. First queued follow-up")).toBeInTheDocument();
    expect(screen.getByText("2. Second queued follow-up")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Steer" })).toHaveLength(1);
  });

  it("edits a queued message in place instead of enqueueing a new one", async () => {
    mockConversationQueuedMessagesState.data = [
      {
        id: "queue-1",
        content: "Queued follow-up",
        status: "queued",
        selectedPlatformSkillSlugs: ["slack"],
        createdAt: "2026-04-02T03:55:02.000Z",
      },
    ];
    mockUpdateConversationQueuedMessageMutateAsync.mockResolvedValue({ success: true });

    render(<ChatArea conversationId="conv-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit queued message 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockUpdateConversationQueuedMessageMutateAsync).toHaveBeenCalledWith({
        queuedMessageId: "queue-1",
        conversationId: "conv-1",
        content: "Queued follow-up",
        selectedPlatformSkillSlugs: ["slack"],
        fileAttachments: undefined,
      });
    });
    expect(mockEnqueueConversationMessageMutateAsync).not.toHaveBeenCalled();
    expect(mockStartGeneration).not.toHaveBeenCalled();
  });

  it("keeps the queued-send hotkey out of form fields", () => {
    render(<ChatArea conversationId="conv-1" />);

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      "mod+enter",
      expect.any(Function),
      expect.objectContaining({ enableOnFormTags: false }),
      expect.any(Array),
    );
  });

  it("does not render debug controls for non-admin users", () => {
    render(<ChatArea conversationId="conv-1" />);

    expect(screen.queryByRole("button", { name: /debug/i })).not.toBeInTheDocument();
  });

  it("keeps chat reachable on mobile when the Agentic-App panel is enabled", async () => {
    mockConversationState.data = {
      type: "chat",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Done",
          sandboxFiles: [
            {
              fileId: "file-1",
              path: "/app/output.html",
              filename: "output.html",
              mimeType: "text/html",
              sizeBytes: 42,
            },
          ],
        },
      ],
    };

    render(<ChatArea conversationId="conv-1" enableAgenticApp />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "output.html" })).toBeInTheDocument();
  });
});
