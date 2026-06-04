// @vitest-environment jsdom

import {
  GENERATION_ERROR_PHASES,
  START_GENERATION_ERROR_CODES,
} from "@cmdclaw/core/lib/generation-errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

void jestDomVitest;

const { runGenerationStreamMock, invalidateQueriesMock } = vi.hoisted(() => ({
  runGenerationStreamMock: vi.fn<VitestProcedure>(),
  invalidateQueriesMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/generation-stream", () => ({
  runGenerationStream: runGenerationStreamMock,
}));

vi.mock("./client", () => ({
  client: {},
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
  };
});

import { useGeneration } from "./hooks/generation";

function HookHarness() {
  const { startGeneration } = useGeneration();
  const [message, setMessage] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const handleStart = React.useCallback(() => {
    void startGeneration(
      {
        content: "hello",
        model: "openai/gpt-5.4-mini",
      },
      {
        onError: (error) => {
          setMessage(error.message);
          setPhase(error.phase);
          setCode(error.code);
        },
      },
    );
  }, [startGeneration]);

  return (
    <div>
      <button type="button" onClick={handleStart}>
        Start
      </button>
      <div data-testid="message">{message}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="code">{code}</div>
    </div>
  );
}

function ForwardingHarness() {
  const { startGeneration } = useGeneration();
  const handleStart = React.useCallback(() => {
    void startGeneration(
      {
        conversationId: "conv-1",
        content: "continue",
        model: "openai/gpt-5.4-mini",
        resumePausedGenerationId: "gen-paused",
        debugRunDeadlineMs: 60_000,
        debugApprovalHotWaitMs: 5_000,
      },
      {},
    );
  }, [startGeneration]);

  return (
    <button type="button" onClick={handleStart}>
      Forward
    </button>
  );
}

describe("useGeneration", () => {
  beforeEach(() => {
    runGenerationStreamMock.mockReset();
    invalidateQueriesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("normalizes pre-start RPC failures before onStarted", async () => {
    runGenerationStreamMock.mockRejectedValueOnce({
      code: "BAD_REQUEST",
      message:
        "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
      data: {
        generationErrorCode: START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
        phase: GENERATION_ERROR_PHASES.START_RPC,
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <HookHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(screen.getByTestId("message")).toHaveTextContent(
        "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
      );
      expect(screen.getByTestId("phase")).toHaveTextContent(GENERATION_ERROR_PHASES.START_RPC);
      expect(screen.getByTestId("code")).toHaveTextContent(
        START_GENERATION_ERROR_CODES.MODEL_ACCESS_DENIED,
      );
    });
  });

  it("forwards debug generation controls unchanged", async () => {
    runGenerationStreamMock.mockResolvedValueOnce(null);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ForwardingHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      expect(runGenerationStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            conversationId: "conv-1",
            content: "continue",
            resumePausedGenerationId: "gen-paused",
            debugRunDeadlineMs: 60_000,
            debugApprovalHotWaitMs: 5_000,
          }),
        }),
      );
    });
  });

  it("refreshes the active conversation when generation starts", async () => {
    runGenerationStreamMock.mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onStarted?.("gen-1", "conv-1");
      return null;
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ForwardingHarness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => {
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ["conversation", "get", "conv-1"],
      });
    });
  });
});
