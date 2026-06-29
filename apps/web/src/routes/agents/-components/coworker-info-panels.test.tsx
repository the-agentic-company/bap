// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENTIC_APP_PROMPT_RESULT_TYPE,
  AGENTIC_APP_PROMPT_TYPE,
} from "@/components/chat/agentic-app-protocol";

const {
  mockUseAgenticAppHtml,
  mockDownloadSandboxFile,
  mockUseSendAgenticAppPrompt,
  mockSendAgenticAppPrompt,
  mockUseConversation,
  mockShareConversation,
  mockUnshareConversation,
} = vi.hoisted(() => ({
  mockUseAgenticAppHtml: vi.fn<() => unknown>(),
  mockDownloadSandboxFile: vi.fn<() => Promise<unknown>>(),
  mockUseSendAgenticAppPrompt:
    vi.fn<(conversationId: string | undefined) => (prompt: string) => Promise<unknown>>(),
  mockSendAgenticAppPrompt: vi.fn<(prompt: string) => Promise<unknown>>(),
  mockUseConversation: vi.fn<() => unknown>(),
  mockShareConversation: vi.fn<() => Promise<unknown>>(),
  mockUnshareConversation: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/components/chat/chat-area", () => ({
  ChatArea: () => <div data-testid="chat-area" />,
}));

vi.mock("@/components/chat/message-bubble", () => ({
  MessageBubble: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/orpc/hooks/conversation", () => ({
  useAgenticAppHtml: mockUseAgenticAppHtml,
  useDownloadSandboxFile: () => ({ mutateAsync: mockDownloadSandboxFile, isPending: false }),
  useConversation: mockUseConversation,
  useShareConversation: () => ({ mutateAsync: mockShareConversation, isPending: false }),
  useUnshareConversation: () => ({ mutateAsync: mockUnshareConversation, isPending: false }),
}));

vi.mock("@/orpc/hooks/generation", () => ({
  useSendAgenticAppPrompt: mockUseSendAgenticAppPrompt,
}));

vi.mock("gt-react", () => ({
  msg: (text: string) => text,
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (text: string) => text,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn<() => void>() }),
}));

import { formatLiveDuration, OutputPanel, RunDetailsPanel } from "./coworker-info-panels";

const outputFile = {
  fileId: "file-1",
  path: "/app/output.html",
  filename: "output.html",
  mimeType: "text/html",
  sizeBytes: 128,
};

let now = 10_000_000;

function focusIframe(iframe: HTMLIFrameElement) {
  vi.spyOn(document, "activeElement", "get").mockReturnValue(iframe);
}

function engageViaClick(iframe: HTMLIFrameElement) {
  fireEvent.pointerDown(iframe);
  focusIframe(iframe);
  fireEvent.blur(window);
}

function dispatchPrompt(source: Window | null, prompt = "Edit the proposed email") {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: AGENTIC_APP_PROMPT_TYPE, version: 1, prompt },
      source,
    }),
  );
}

beforeEach(() => {
  now = 10_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  mockUseAgenticAppHtml.mockReturnValue({
    data: { html: "<button>Edit</button>", filename: "output.html", sizeBytes: 128 },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn<() => void>(),
  });
  mockSendAgenticAppPrompt.mockResolvedValue(true);
  mockUseSendAgenticAppPrompt.mockReturnValue(mockSendAgenticAppPrompt);
  mockUseConversation.mockReturnValue({ data: { isShared: false, shareToken: null } });
  mockShareConversation.mockResolvedValue({ shareToken: "share-token" });
  mockUnshareConversation.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OutputPanel Agentic-App prompts", () => {
  it("sends inline iframe prompts through the selected run conversation", async () => {
    render(
      <OutputPanel
        outputFile={outputFile}
        conversationId="conv-run-1"
        runStatus="completed"
      />,
    );

    const iframe = screen.getByTitle("output.html Agentic-App") as HTMLIFrameElement;
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");

    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "sent" },
        "*",
      );
    });
    expect(mockUseSendAgenticAppPrompt).toHaveBeenCalledWith("conv-run-1");
    expect(mockSendAgenticAppPrompt).toHaveBeenCalledExactlyOnceWith("Edit the proposed email");
  });

  it("sends fullscreen iframe prompts through the selected run conversation", async () => {
    render(
      <OutputPanel
        outputFile={outputFile}
        conversationId="conv-run-2"
        runStatus="completed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Agentic-App fullscreen" }));
    const iframe = (await screen.findByTitle(
      "output.html Agentic-App fullscreen",
    )) as HTMLIFrameElement;
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");

    now += 1001;
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "sent" },
        "*",
      );
    });
    expect(mockUseSendAgenticAppPrompt).toHaveBeenCalledWith("conv-run-2");
    expect(mockSendAgenticAppPrompt).toHaveBeenCalledExactlyOnceWith("Edit the proposed email");
  });
});

describe("RunDetailsPanel layout", () => {
  it("keeps the chat panel shrinkable inside the split workspace", () => {
    const { container } = render(<RunDetailsPanel conversationId="conv-run-1" />);

    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(screen.getByTestId("chat-area").parentElement?.className).toContain("min-w-0");
  });
});

describe("formatLiveDuration", () => {
  it("keeps seconds visible for running durations", () => {
    expect(formatLiveDuration(new Date(1_000_000), new Date(1_002_000))).toBe("2s");
    expect(formatLiveDuration(new Date(1_000_000), new Date(1_065_000))).toBe("1m 5s");
    expect(formatLiveDuration(new Date(1_000_000), new Date(4_723_000))).toBe("1h 2m 3s");
  });
});

describe("OutputPanel empty states", () => {
  it("renders the output file without the coworker-page header actions", () => {
    render(
      <OutputPanel
        outputFile={outputFile}
        conversationId="conv-run-header"
        runStatus="completed"
      />,
    );

    expect(screen.getByTitle("output.html Agentic-App")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download output" })).toBeNull();
  });
  it("shows a loading message while the run is generating output", () => {
    render(<OutputPanel conversationId="conv-run-3" runStatus="running" />);

    expect(screen.getByText("Generating output ...")).toBeTruthy();
  });

  it("shows run errors with a red error state message", () => {
    render(
      <OutputPanel
        conversationId="conv-run-4"
        runStatus="error"
        runErrorMessage="This ChatGPT model requires the shared workspace connection."
      />,
    );

    expect(screen.getByText("Error")).toBeTruthy();
    expect(
      screen.getByText(
        "Error : This ChatGPT model requires the shared workspace connection.",
      ),
    ).toBeTruthy();
  });

  it("shows a generic failure message when an error run has no stored error message", () => {
    render(<OutputPanel conversationId="conv-run-5" runStatus="error" />);

    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Error : Run failed.")).toBeTruthy();
  });

  it("shows a generic cancelled message when a cancelled run has no stored error message", () => {
    render(<OutputPanel conversationId="conv-run-6" runStatus="cancelled" />);

    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Error : Run cancelled.")).toBeTruthy();
  });

  it("keeps the output error visible even if the latest chat message matches it", () => {
    render(
      <OutputPanel
        conversationId="conv-run-7"
        runStatus="error"
        runErrorMessage="The sandbox stopped while this run was still active. Retry the task to continue."
        latestCoworkerMessage="The sandbox stopped while this run was still active. Retry the task to continue."
      />,
    );

    expect(screen.getByText("Error")).toBeTruthy();
    expect(
      screen.getByText(
        "Error : The sandbox stopped while this run was still active. Retry the task to continue.",
      ),
    ).toBeTruthy();
  });
});
