// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    render(<MessageBubble role="user" content="Hello from user" />);

    expect(screen.getByTestId("chat-bubble-user")).toBeInTheDocument();
    expect(screen.getByText("Hello from user")).toBeInTheDocument();
  });

  it("renders assistant messages with clickable sandbox file paths", () => {
    const onFileClick = vi.fn();
    render(
      <MessageBubble
        role="assistant"
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
        role="assistant"
        content={`| Name | Age |\n| --- | --- |\n| Alice | 28 |\n| Bob | 34 |`}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
  });

  it("opens assistant markdown links in a new tab", () => {
    render(<MessageBubble role="assistant" content="[Google](https://google.com)" />);

    const link = screen.getByRole("link", { name: "Google" });
    expect(link).toHaveAttribute("href", "https://google.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
