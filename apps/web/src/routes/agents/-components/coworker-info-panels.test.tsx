// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENTIC_APP_PROMPT_RESULT_TYPE,
  AGENTIC_APP_PROMPT_TYPE,
} from "@/components/chat/agentic-app-protocol";
import type { Message } from "@/components/chat/message-list";

const {
  mockUseAgenticAppHtml,
  mockDownloadSandboxFile,
  mockUseSendAgenticAppPrompt,
  mockSendAgenticAppPrompt,
} = vi.hoisted(() => ({
  mockUseAgenticAppHtml: vi.fn<() => unknown>(),
  mockDownloadSandboxFile: vi.fn<() => Promise<unknown>>(),
  mockUseSendAgenticAppPrompt:
    vi.fn<(conversationId: string | undefined) => (prompt: string) => Promise<unknown>>(),
  mockSendAgenticAppPrompt: vi.fn<(prompt: string) => Promise<unknown>>(),
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

import { OutputPanel, RunDetailsPanel } from "./coworker-info-panels";

const outputFile = {
  fileId: "file-1",
  path: "/app/output.html",
  filename: "output.html",
  mimeType: "text/html",
  sizeBytes: 128,
};
const runningRun = { status: "running" } as const;
const emptyMessages: Message[] = [];

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OutputPanel Agentic-App prompts", () => {
  it("sends inline iframe prompts through the selected run conversation", async () => {
    render(<OutputPanel outputFile={outputFile} conversationId="conv-run-1" />);

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
    render(<OutputPanel outputFile={outputFile} conversationId="conv-run-2" />);

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
  it("keeps the chat tab shrinkable inside the split workspace", () => {
    const { container } = render(
      <RunDetailsPanel
        activeTab="chat"
        onTabChange={vi.fn<() => void>()}
        isFetchingConversation={false}
        run={runningRun}
        messages={emptyMessages}
        conversationId="conv-run-1"
      />,
    );

    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(screen.getByTestId("chat-area").parentElement?.className).toContain("min-w-0");
  });
});

describe("OutputPanel empty states", () => {
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
});
