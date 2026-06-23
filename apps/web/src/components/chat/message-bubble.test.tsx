// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import type { SandboxFileData } from "./message-list";
import { MessageBubble } from "./message-bubble";

void jestDomVitest;

const sandboxFileFixture: SandboxFileData = {
  fileId: "file-1",
  path: "/app/report.pdf",
  filename: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
};
const sandboxFilesFixture = [sandboxFileFixture];

describe("MessageBubble", () => {
  it("renders user messages in the user bubble", () => {
    const { container } = render(<MessageBubble messageRole="user" content="Hello from user" />);

    expect(screen.getByTestId("chat-bubble-user")).toHaveClass("min-w-0");
    expect(container.querySelector("[data-testid='chat-bubble-user'] > div")).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
    expect(screen.getByText("Hello from user")).toBeInTheDocument();
  });

  it("constrains assistant markdown so narrow panes can shrink around it", () => {
    const { container } = render(
      <MessageBubble
        messageRole="assistant"
        content="A very-long-unbroken-token-that-must-not-force-the-chat-pane-to-overlap-output"
      />,
    );

    const root = screen.getByTestId("chat-bubble-assistant");
    const markdown = container.querySelector("[data-testid='chat-bubble-assistant'] > div");

    expect(root).toHaveClass("min-w-0");
    expect(markdown).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "break-words",
      "[overflow-wrap:anywhere]",
      "prose-pre:max-w-full",
      "prose-pre:whitespace-pre-wrap",
    );
  });

  it("renders assistant messages with clickable sandbox file paths", () => {
    const onFileClick = vi.fn<VitestProcedure>();
    render(
      <MessageBubble
        messageRole="assistant"
        content="Saved output to /app/report.pdf"
        sandboxFiles={sandboxFilesFixture}
        onFileClick={onFileClick}
      />,
    );

    const fileButton = screen.getByRole("button", {
      name: /\/app\/report\.pdf/i,
    });
    fireEvent.click(fileButton);

    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick).toHaveBeenCalledWith(sandboxFileFixture);
  });

  it("renders GFM tables for assistant messages", () => {
    render(
      <MessageBubble
        messageRole="assistant"
        content={`| Name | Age |\n| --- | --- |\n| Alice | 28 |\n| Bob | 34 |`}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
  });

  it("opens assistant markdown links in a new tab", () => {
    render(<MessageBubble messageRole="assistant" content="[Google](https://google.com)" />);

    const link = screen.getByRole("link", { name: "Google" });
    expect(link).toHaveAttribute("href", "https://google.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
