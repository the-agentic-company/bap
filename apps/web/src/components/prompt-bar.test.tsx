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

const VOICE_FINAL_PREFILL = {
  id: "voice-final-1",
  text: "hello world.",
  mode: "append" as const,
};

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

describe("PromptBar", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    useChatDraftStore.setState({ drafts: {}, hasHydrated: true });
  });

  afterEach(() => {
    cleanup();
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

  it("toggles voice recording on click when voiceInteractionMode is toggle", () => {
    const onStartRecording = vi.fn<VitestProcedure>();
    const onStopRecording = vi.fn<VitestProcedure>();

    const { rerender } = render(
      <PromptBar
        onSubmit={vi.fn<VitestProcedure>()}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        voiceInteractionMode="toggle"
      />,
    );

    const micButton = screen.getByRole("button", { name: "Start voice recording" });
    expect(micButton).toHaveAttribute("aria-pressed", "false");

    // First click starts recording (no need to hold).
    fireEvent.click(micButton);
    expect(onStartRecording).toHaveBeenCalledTimes(1);
    expect(onStopRecording).not.toHaveBeenCalled();

    // Parent flips isRecording; the same button becomes a stop control.
    rerender(
      <PromptBar
        onSubmit={vi.fn<VitestProcedure>()}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        voiceInteractionMode="toggle"
        isRecording
      />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop voice recording" });
    expect(stopButton).toHaveAttribute("aria-pressed", "true");

    // Second click stops recording.
    fireEvent.click(stopButton);
    expect(onStopRecording).toHaveBeenCalledTimes(1);
    expect(onStartRecording).toHaveBeenCalledTimes(1);
  });

  it("streams the interim transcript into the composer and commits the final", () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    const { rerender } = render(
      <PromptBar onSubmit={onSubmit} isRecording interimTranscript="" />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");

    // Interim previews grow and replace the prior interim (not append).
    rerender(<PromptBar onSubmit={onSubmit} isRecording interimTranscript="hello" />);
    expect(input).toHaveValue("hello");
    rerender(<PromptBar onSubmit={onSubmit} isRecording interimTranscript="hello world" />);
    expect(input).toHaveValue("hello world");

    // Recording stops: interim clears and the final transcript commits via
    // prefillRequest, replacing the interim rather than doubling it.
    rerender(
      <PromptBar
        onSubmit={onSubmit}
        isRecording={false}
        interimTranscript=""
        prefillRequest={VOICE_FINAL_PREFILL}
      />,
    );
    expect(input).toHaveValue("hello world.");
  });

  it("keeps pre-existing composer text when an interim transcript arrives", () => {
    const onSubmit = vi.fn<VitestProcedure>().mockResolvedValue(true);

    const { rerender } = render(<PromptBar onSubmit={onSubmit} isRecording interimTranscript="" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Note:" } });

    rerender(<PromptBar onSubmit={onSubmit} isRecording interimTranscript="call the client" />);
    expect(input).toHaveValue("Note: call the client");
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
});
