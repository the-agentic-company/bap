// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingCoworkerPrompt,
  writePendingCoworkerPrompt,
} from "@/components/landing/pending-coworker-prompt";
import NewCoworkerPage from "./page";

void jestDomVitest;

const {
  mockRouterReplace,
  mockCreateCoworkerMutateAsync,
  mockGetOrCreateBuilderConversation,
  mockStartGeneration,
  assignMock,
} = vi.hoisted(() => ({
  mockRouterReplace: vi.fn(),
  mockCreateCoworkerMutateAsync: vi.fn(),
  mockGetOrCreateBuilderConversation: vi.fn(),
  mockStartGeneration: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

vi.mock("@/orpc/hooks", () => ({
  useCreateCoworker: () => ({ mutateAsync: mockCreateCoworkerMutateAsync }),
}));

vi.mock("@/orpc/client", () => ({
  client: {
    coworker: {
      getOrCreateBuilderConversation: mockGetOrCreateBuilderConversation,
    },
    generation: {
      startGeneration: mockStartGeneration,
    },
  },
}));

describe("NewCoworkerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingCoworkerPrompt();
    mockCreateCoworkerMutateAsync.mockResolvedValue({ id: "cw-1" });
    mockGetOrCreateBuilderConversation.mockResolvedValue({ conversationId: "conv-1" });
    mockStartGeneration.mockResolvedValue({ generationId: "gen-1" });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("forwards persisted attachments into the initial builder generation", async () => {
    writePendingCoworkerPrompt({
      initialMessage: "Use this screenshot to recreate the flow",
      attachments: [
        {
          name: "flow.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,ZmFrZQ==",
        },
      ],
    });

    render(<NewCoworkerPage />);

    await waitFor(() => {
      expect(mockCreateCoworkerMutateAsync).toHaveBeenCalledWith({
        name: "",
        triggerType: "manual",
        prompt: "",
        model: "openai/gpt-5.4",
        authSource: "shared",
        allowedIntegrations: expect.any(Array),
      });
    });

    await waitFor(() => {
      expect(mockStartGeneration).toHaveBeenCalledWith({
        conversationId: "conv-1",
        content: "Use this screenshot to recreate the flow",
        model: "openai/gpt-5.4",
        authSource: "shared",
        autoApprove: true,
        fileAttachments: [
          {
            name: "flow.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,ZmFrZQ==",
          },
        ],
      });
      expect(assignMock).toHaveBeenCalledWith("/agents/cw-1");
    });
  });
});
