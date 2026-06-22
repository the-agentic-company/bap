// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getActiveGenerationMock, startGenerationMock, enqueueConversationMessageMock } = vi.hoisted(
  () => ({
    getActiveGenerationMock: vi.fn<VitestProcedure>(),
    startGenerationMock: vi.fn<VitestProcedure>(),
    enqueueConversationMessageMock: vi.fn<VitestProcedure>(),
  }),
);

vi.mock("@/lib/generation-stream", () => ({
  runGenerationStream: vi.fn<VitestProcedure>(),
}));

vi.mock("./client", () => ({
  client: {
    generation: {
      getActiveGeneration: getActiveGenerationMock,
      startGeneration: startGenerationMock,
      enqueueConversationMessage: enqueueConversationMessageMock,
    },
  },
}));

import { useSendAgenticAppPrompt } from "./hooks/generation";

function PromptHarness({ conversationId }: { conversationId?: string }) {
  const sendPrompt = useSendAgenticAppPrompt(conversationId);
  const [result, setResult] = React.useState<string>("");

  const handleClick = React.useCallback(() => {
    void sendPrompt("Edit the proposed email").then((sent) => setResult(String(sent)));
  }, [sendPrompt]);

  return (
    <div>
      <button type="button" onClick={handleClick}>
        Send
      </button>
      <div data-testid="result">{result}</div>
    </div>
  );
}

function renderPromptHarness(conversationId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PromptHarness conversationId={conversationId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getActiveGenerationMock.mockReset();
  startGenerationMock.mockReset();
  enqueueConversationMessageMock.mockReset();
  startGenerationMock.mockResolvedValue({
    generationId: "gen-new",
    conversationId: "conv-run",
    traceId: "trace-1",
  });
  enqueueConversationMessageMock.mockResolvedValue({ queuedMessageId: "queue-1" });
});

afterEach(() => {
  cleanup();
});

describe("useSendAgenticAppPrompt", () => {
  it("starts a Generation in the supplied run conversation when idle", async () => {
    getActiveGenerationMock.mockResolvedValue({
      generationId: null,
      startedAt: null,
      errorMessage: null,
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
      status: "idle",
    });

    renderPromptHarness("conv-run-1");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(startGenerationMock).toHaveBeenCalledWith({
        conversationId: "conv-run-1",
        content: "Edit the proposed email",
      });
    });
    expect(getActiveGenerationMock).toHaveBeenCalledWith({ conversationId: "conv-run-1" });
    expect(enqueueConversationMessageMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("result").textContent).toBe("true");
  });

  it("queues the prompt in the supplied run conversation when a Generation is active", async () => {
    getActiveGenerationMock.mockResolvedValue({
      generationId: "gen-active",
      startedAt: "2026-06-22T10:00:00.000Z",
      errorMessage: null,
      pauseReason: null,
      debugRunDeadlineMs: null,
      contentParts: null,
      status: "generating",
    });

    renderPromptHarness("conv-run-2");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(enqueueConversationMessageMock).toHaveBeenCalledWith({
        conversationId: "conv-run-2",
        content: "Edit the proposed email",
        replaceExisting: false,
      });
    });
    expect(getActiveGenerationMock).toHaveBeenCalledWith({ conversationId: "conv-run-2" });
    expect(startGenerationMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("result").textContent).toBe("true");
  });

  it("rejects locally when no run conversation is available", async () => {
    renderPromptHarness(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("false");
    });
    expect(getActiveGenerationMock).not.toHaveBeenCalled();
    expect(startGenerationMock).not.toHaveBeenCalled();
    expect(enqueueConversationMessageMock).not.toHaveBeenCalled();
  });
});
