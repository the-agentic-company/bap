// @vitest-environment jsdom

import React from "react";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptSegment } from "@/lib/prompt-segments";
import { useChatDraftStore } from "@/components/chat/chat-draft-store";
import { PromptBar } from "./prompt-bar";

void jestDomVitest;

const heroRichAnimatedPlaceholders: PromptSegment[][] = [
  [
    { type: "text", content: "Every hour, triage new " },
    { type: "brand", name: "Zendesk", icon: "/zendesk.svg" },
  ],
];

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
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
    const onSubmit = vi.fn().mockResolvedValue(true);

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

  it("keeps the composer text when submit returns false", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);

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
    const onSubmit = vi.fn().mockResolvedValue(true);

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
        onSubmit={vi.fn()}
        onStartRecording={vi.fn()}
        onStopRecording={vi.fn()}
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
        onSubmit={vi.fn()}
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
