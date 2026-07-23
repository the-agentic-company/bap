// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTIC_APP_PROMPT_RESULT_TYPE, AGENTIC_APP_PROMPT_TYPE } from "./agentic-app-protocol";

const { mockUseAgenticAppHtml, mockDownloadSandboxFile, mockPosthogCapture } = vi.hoisted(() => ({
  mockUseAgenticAppHtml: vi.fn<() => unknown>(),
  mockDownloadSandboxFile: vi.fn<() => Promise<unknown>>(),
  mockPosthogCapture: vi.fn<(event: string, props?: unknown) => void>(),
}));

vi.mock("@/orpc/hooks/conversation", () => ({
  useAgenticAppHtml: mockUseAgenticAppHtml,
  useDownloadSandboxFile: () => ({ mutateAsync: mockDownloadSandboxFile, isPending: false }),
}));

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (text: string) => text,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockPosthogCapture }),
}));

import { AgenticAppPanel } from "./agentic-app-panel";

const outputFile = {
  fileId: "file-1",
  path: "/app/output.html",
  filename: "output.html",
  mimeType: "text/html",
  sizeBytes: 128,
};

let now = 10_000_000;

function renderPanel(
  onSendPrompt = vi.fn<(prompt: string) => Promise<unknown>>().mockResolvedValue(true),
) {
  const view = render(
    <AgenticAppPanel
      outputFile={outputFile}
      onClose={vi.fn<() => void>()}
      onSendPrompt={onSendPrompt}
    />,
  );
  const iframe = screen.getByTitle("output.html Agentic-App") as HTMLIFrameElement;
  const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
  return { view, iframe, postMessageSpy, onSendPrompt };
}

function focusIframe(iframe: HTMLIFrameElement) {
  vi.spyOn(document, "activeElement", "get").mockReturnValue(iframe);
}

// Simulate a genuine user click landing inside the iframe: a real pointer gesture over
// the panel, immediately followed by focus entering the iframe (window blur).
function engageViaClick(iframe: HTMLIFrameElement) {
  fireEvent.pointerDown(iframe);
  focusIframe(iframe);
  fireEvent.blur(window);
}

// Simulate a genuine tablet tap: the touch lands inside the cross-origin iframe, so the parent
// never sees a pointer gesture — only a `touchstart` on the iframe element — immediately
// followed by focus entering the iframe (window blur).
function engageViaTouch(iframe: HTMLIFrameElement) {
  fireEvent.touchStart(iframe);
  focusIframe(iframe);
  fireEvent.blur(window);
}

function dispatchPrompt(source: Window | null, prompt: unknown = "Send the weekly email") {
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
    data: { html: "<button>send</button>", filename: "output.html", sizeBytes: 128 },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn<() => void>(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("AgenticAppPanel prompt listener", () => {
  it("ignores messages whose source is not the panel iframe", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    engageViaClick(iframe);
    dispatchPrompt(window);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("rejects with no_user_activation when the user never engaged", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    focusIframe(iframe);
    dispatchPrompt(iframe.contentWindow);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: AGENTIC_APP_PROMPT_RESULT_TYPE,
        version: 1,
        status: "rejected",
        reason: "no_user_activation",
      },
      "*",
    );
  });

  it("rejects programmatic focus with no preceding gesture (autofocus bypass)", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    // Focus enters the iframe via script (blur fires) but no pointer/key gesture happened.
    focusIframe(iframe);
    fireEvent.blur(window);
    dispatchPrompt(iframe.contentWindow);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: AGENTIC_APP_PROMPT_RESULT_TYPE,
        version: 1,
        status: "rejected",
        reason: "no_user_activation",
      },
      "*",
    );
  });

  it("ignores focus entry within the load grace window (autofocus at load)", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    fireEvent.load(iframe); // loadedAt = now
    fireEvent.pointerDown(iframe); // even with a gesture...
    focusIframe(iframe);
    fireEvent.blur(window); // ...focus entry inside the grace window is ignored
    dispatchPrompt(iframe.contentWindow);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: AGENTIC_APP_PROMPT_RESULT_TYPE,
        version: 1,
        status: "rejected",
        reason: "no_user_activation",
      },
      "*",
    );
  });

  it("sends an engaged, focused prompt and acks sent", async () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "sent" },
        "*",
      );
    });
    expect(onSendPrompt).toHaveBeenCalledExactlyOnceWith("Send the weekly email");
    expect(mockPosthogCapture).toHaveBeenCalledWith("agentic_app_prompt", {
      status: "sent",
      reason: null,
      file_id: "file-1",
    });
  });

  it("sends an engaged, focused prompt after a touch tap and acks sent", async () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    engageViaTouch(iframe);
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "sent" },
        "*",
      );
    });
    expect(onSendPrompt).toHaveBeenCalledExactlyOnceWith("Send the weekly email");
  });

  it("rejects a malformed version 1 envelope as invalid", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow, 42);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "rejected", reason: "invalid" },
      "*",
    );
  });

  it("silently ignores unknown envelope versions", () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel();
    engageViaClick(iframe);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: AGENTIC_APP_PROMPT_TYPE, version: 2, prompt: "hi" },
        source: iframe.contentWindow,
      }),
    );
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("rate-limits a second prompt arriving immediately after an accepted one", async () => {
    const { postMessageSpy, iframe } = renderPanel();
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "sent" },
        "*",
      );
    });
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: AGENTIC_APP_PROMPT_RESULT_TYPE,
          version: 1,
          status: "rejected",
          reason: "rate_limited",
        },
        "*",
      );
    });
  });

  it("acks rejected without a reason when sending fails", async () => {
    const { postMessageSpy, iframe } = renderPanel(
      vi.fn<(prompt: string) => Promise<unknown>>().mockRejectedValue(new Error("boom")),
    );
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "rejected" },
        "*",
      );
    });
  });

  it("acks rejected without a reason when the send path returns falsy", async () => {
    const { postMessageSpy, onSendPrompt, iframe } = renderPanel(
      vi.fn<(prompt: string) => Promise<unknown>>().mockResolvedValue(undefined),
    );
    engageViaClick(iframe);
    dispatchPrompt(iframe.contentWindow);
    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: AGENTIC_APP_PROMPT_RESULT_TYPE, version: 1, status: "rejected" },
        "*",
      );
    });
    expect(onSendPrompt).toHaveBeenCalledOnce();
  });

  it("stops handling prompts after the panel unmounts", () => {
    const { view, postMessageSpy, onSendPrompt, iframe } = renderPanel();
    const contentWindow = iframe.contentWindow;
    engageViaClick(iframe);
    view.unmount();
    dispatchPrompt(contentWindow);
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
