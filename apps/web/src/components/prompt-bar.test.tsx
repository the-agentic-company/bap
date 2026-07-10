// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import type { PromptSegment } from "@/lib/prompt-segments";
import { useChatDraftStore } from "@/components/chat/chat-draft-store";
import { PromptBar } from "./prompt-bar";

void jestDomVitest;

const uploadFileAssetMock =
  vi.fn<
    (
      file: File,
      options?: {
        onProgress?: (progress: { loaded: number; total: number; percent: number }) => void;
      },
    ) => Promise<unknown>
  >();

const heroRichAnimatedPlaceholders: PromptSegment[][] = [
  [
    { type: "text", content: "Every hour, triage new " },
    { type: "brand", name: "Zendesk", icon: "/zendesk.svg" },
  ],
];

vi.mock("@/components/app-image", () => ({
  AppImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <span data-next-image={props.alt ?? ""} />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/orpc/hooks/file-assets", () => ({
  uploadFileAsset: (
    file: File,
    options?: {
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void;
    },
  ) => uploadFileAssetMock(file, options),
}));

describe("PromptBar", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    useChatDraftStore.setState({ drafts: {}, hasHydrated: true });
  });

  afterEach(() => {
    cleanup();
    uploadFileAssetMock.mockReset();
  });

  it("clears the composer after a successful async submit", async () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    render(<PromptBar onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Queue this follow-up" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Queue this follow-up", undefined);
    });
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("can submit on plain Enter when enabled", async () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    render(<PromptBar onSubmit={onSubmit} submitOnEnter />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Build this coworker" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Build this coworker", undefined);
    });
  });

  it("keeps Shift+Enter available when plain Enter submit is enabled", () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    render(<PromptBar onSubmit={onSubmit} submitOnEnter />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep editing" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the composer text when submit returns false", async () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(false);

    render(<PromptBar onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Keep this draft", undefined);
    });
    expect(input).toHaveValue("Keep this draft");
  });

  it("exposes a labeled send button that submits on click", async () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    render(<PromptBar onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox", { name: "Message" });
    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(sendButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "hi" } });
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("hi", undefined);
    });
  });

  it("renders injected debug controls beside the voice button", () => {
    const debugControls = React.createElement("button", { type: "button" }, "Debug tools");

    render(
      <PromptBar
        onSubmit={vi.fn<VitestProcedure>()}
        onStartRecording={vi.fn<VitestProcedure>()}
        onStopRecording={vi.fn<VitestProcedure>()}
        renderDebugControls={debugControls}
      />,
    );

    const controls = screen
      .getByRole("button", { name: "Debug tools" })
      .parentElement?.querySelectorAll("button");
    expect(
      Array.from(controls ?? []).map(
        (button) => button.textContent || button.getAttribute("aria-label"),
      ),
    ).toEqual(["Debug tools", "Start voice recording", "Send message"]);
  });

  it("reserves two lines of height for the hero rich placeholder", () => {
    const { container } = render(
      <PromptBar
        onSubmit={vi.fn<VitestProcedure>()}
        variant="hero"
        richAnimatedPlaceholders={heroRichAnimatedPlaceholders}
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveClass("min-h-[4.6rem]");
    expect(input).toHaveClass("max-h-[min(40dvh,18rem)]");
    expect(input).toHaveClass("overflow-y-auto");

    const measurer = container.querySelector("div[aria-hidden='true'].invisible");
    expect(measurer).toHaveClass("min-h-[4.6rem]");
    expect(measurer).toHaveClass("max-h-[min(40dvh,18rem)]");
    expect(measurer).toHaveClass("overflow-hidden");
    expect(measurer).toHaveTextContent("Every hour, triage new");
    expect(measurer).toHaveTextContent("Zendesk");
  });

  it("keeps upload progress visible even when the file name is truncated", async () => {
    uploadFileAssetMock.mockImplementation(
      async (
        _file: File,
        options?: {
          onProgress?: (progress: { loaded: number; total: number; percent: number }) => void;
        },
      ) => {
        options?.onProgress?.({ loaded: 42, total: 100, percent: 42 });
        return new Promise(() => {});
      },
    );

    render(<PromptBar onSubmit={vi.fn<VitestProcedure>()} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["content"], "Ecole Primaire tres long nom.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("42%")).toBeInTheDocument();
    });
  });
});
